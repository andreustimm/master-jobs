/**
 * The scraping queue.
 *
 * A table, not Redis or RabbitMQ. The reasoning is in ADR 0009; the short
 * version is that this system runs locally against a database it already has,
 * the throughput is hundreds of pages a day rather than thousands a second, and
 * SQLite gives a correct atomic claim in one statement. Adding a broker would
 * mean a second server to run before the dashboard works offline, which is a
 * real cost paid for throughput nobody needs.
 *
 * The interface is a port (`QueuePort`) precisely so that stays a decision and
 * not an assumption: an Upstash adapter drops in for a serverless deployment
 * without the workers noticing.
 *
 * The part that is easy to get wrong is the claim. Two workers reading
 * "pending" and then writing "fetching" both believe they own the task. The
 * `UPDATE ... WHERE status='pending' ... RETURNING` below is a single statement,
 * so exactly one worker gets the row.
 */
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { clock } from "../clock.ts";
import { getDb } from "../db/client.ts";
import { job, jobPage, jobScore, scrapeTask, type ScrapeStatus } from "../db/schema.ts";

/** A task a worker may act on. */
export type ClaimedTask = {
  id: number;
  jobId: number;
  url: string;
  attempts: number;
};

export type QueuePort = {
  claim(status: "pending" | "fetched", worker: string): Promise<ClaimedTask | null>;
  complete(id: number, next: ScrapeStatus): Promise<void>;
  fail(id: number, error: string, retryable: boolean): Promise<void>;
  stats(): Promise<Record<string, number>>;
};

/** Give up after this many attempts; a page that fails 4 times is not coming. */
export const MAX_ATTEMPTS = 4;

/** Backoff in minutes, indexed by attempt. Long enough to outlast a rate limit. */
const BACKOFF_MINUTES = [1, 5, 20, 60];

function isoIn(minutes: number, now = clock().now()): string {
  return new Date(now + minutes * 60_000).toISOString();
}

/**
 * A claim older than this is treated as abandoned.
 *
 * Without this, a worker killed mid-fetch leaves its task in `fetching`
 * forever, and the queue silently shrinks every time someone hits Ctrl-C.
 */
const STALE_CLAIM_MINUTES = 15;

export const dbQueue: QueuePort = {
  async claim(status, worker) {
    const db = getDb();
    const nowIso = clock().iso();
    const staleBefore = isoIn(-STALE_CLAIM_MINUTES);
    const working: ScrapeStatus = status === "pending" ? "fetching" : "parsing";

    // One statement: the WHERE re-checks the status the UPDATE is predicated on,
    // so a racing worker's update finds no row and returns nothing.
    const rows = await db
      .update(scrapeTask)
      .set({ status: working, claimedAt: nowIso, claimedBy: worker, updatedAt: nowIso })
      .where(
        sql`${scrapeTask.id} = (
          select id from scrape_task
          where (
            status = ${status}
            or (status = ${working} and claimed_at < ${staleBefore})
          )
          and (run_after is null or run_after <= ${nowIso})
          order by priority desc, id asc
          limit 1
        )`,
      )
      .returning({
        id: scrapeTask.id,
        jobId: scrapeTask.jobId,
        url: scrapeTask.url,
        attempts: scrapeTask.attempts,
      });

    return rows[0] ?? null;
  },

  async complete(id, next) {
    const db = getDb();
    await db
      .update(scrapeTask)
      .set({
        status: next,
        claimedAt: null,
        claimedBy: null,
        lastError: null,
        updatedAt: clock().iso(),
      })
      .where(eq(scrapeTask.id, id));
  },

  async fail(id, error, retryable) {
    const db = getDb();
    const [current] = await db
      .select({ attempts: scrapeTask.attempts })
      .from(scrapeTask)
      .where(eq(scrapeTask.id, id))
      .limit(1);

    const attempts = (current?.attempts ?? 0) + 1;
    const exhausted = !retryable || attempts >= MAX_ATTEMPTS;

    await db
      .update(scrapeTask)
      .set({
        // A non-retryable failure is terminal: retrying a 404 four times just
        // annoys the server and delays everything behind it.
        status: exhausted ? "failed" : "pending",
        attempts,
        lastError: error.slice(0, 500),
        claimedAt: null,
        claimedBy: null,
        runAfter: exhausted
          ? null
          : isoIn(BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]!),
        updatedAt: clock().iso(),
      })
      .where(eq(scrapeTask.id, id));
  },

  async stats() {
    const db = getDb();
    const rows = await db
      .select({ status: scrapeTask.status, n: sql<number>`count(*)` })
      .from(scrapeTask)
      .groupBy(scrapeTask.status);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  },
};

export type EnqueueOptions = {
  /** Only jobs at or above this fit. Pages for jobs nobody will read are waste. */
  minFit?: number;
  limit?: number;
  /** Re-queue jobs whose page was already captured. */
  refresh?: boolean;
};

export type EnqueueResult = { queued: number; skipped: number };

/**
 * Fills the queue from the corpus.
 *
 * Ordered by fit, because capture is the expensive step and the top of the
 * ranking is what the user actually opens. Jobs that already have a page are
 * skipped unless `refresh` is set.
 */
export async function enqueuePending(opts: EnqueueOptions = {}): Promise<EnqueueResult> {
  const db = getDb();
  const minFit = opts.minFit ?? 45;
  const limit = opts.limit ?? 500;

  const candidates = await db
    .select({ id: job.id, url: job.url, fit: jobScore.fit })
    .from(job)
    .leftJoin(jobScore, eq(jobScore.jobId, job.id))
    .leftJoin(jobPage, eq(jobPage.jobId, job.id))
    .leftJoin(scrapeTask, eq(scrapeTask.jobId, job.id))
    .where(
      and(
        isNull(job.closedAt),
        sql`coalesce(${jobScore.fit}, 0) >= ${minFit}`,
        isNull(scrapeTask.id),
        opts.refresh ? sql`1 = 1` : isNull(jobPage.jobId),
      ),
    )
    .orderBy(desc(jobScore.fit))
    .limit(limit);

  let queued = 0;
  for (const candidate of candidates) {
    await db
      .insert(scrapeTask)
      .values({ jobId: candidate.id, url: candidate.url, priority: Number(candidate.fit ?? 0) })
      // A job already queued is not an error; the run is idempotent.
      .onConflictDoNothing();
    queued++;
  }

  return { queued, skipped: candidates.length - queued };
}

/** Puts failed tasks back in line, e.g. after fixing the parser. */
export async function retryFailed(): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(scrapeTask)
    .set({ status: "pending", attempts: 0, runAfter: null, lastError: null })
    .where(eq(scrapeTask.status, "failed"))
    .returning({ id: scrapeTask.id });
  return rows.length;
}
