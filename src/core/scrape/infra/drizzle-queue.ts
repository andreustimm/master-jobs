/**
 * Drizzle implementation of the scraping queue ports.
 *
 * SQLite is the right local adapter for the measured workload (ADR 0009).
 * Atomic claiming stays here because it is a persistence mechanism; retry
 * policy and queue vocabulary live in the pure domain layer.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { clock } from "../../clock.ts";
import { getDb } from "../../db/client.ts";
import { job, jobPage, jobScore, scrapeTask } from "../../db/schema.ts";
import { decideQueueFailure } from "../domain/retry-policy.ts";
import type { ScrapeStatus } from "../domain/status.ts";
import type { QueueAdminPort, QueuePort } from "../ports.ts";

function isoIn(minutes: number, now = clock().now()): string {
  return new Date(now + minutes * 60_000).toISOString();
}

/** A claim older than this is treated as abandoned after a killed worker. */
const STALE_CLAIM_MINUTES = 15;

export const drizzleQueue: QueuePort = {
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
    await getDb()
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

    const decision = decideQueueFailure(current?.attempts ?? 0, retryable);

    await db
      .update(scrapeTask)
      .set({
        status: decision.status,
        attempts: decision.attempts,
        lastError: error.slice(0, 500),
        claimedAt: null,
        claimedBy: null,
        runAfter: decision.delayMinutes === null ? null : isoIn(decision.delayMinutes),
        updatedAt: clock().iso(),
      })
      .where(eq(scrapeTask.id, id));
  },

  async stats() {
    const rows = await getDb()
      .select({ status: scrapeTask.status, n: sql<number>`count(*)` })
      .from(scrapeTask)
      .groupBy(scrapeTask.status);
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
  },
};

export const drizzleQueueAdmin: QueueAdminPort = {
  async enqueueEligible(criteria) {
    const db = getDb();
    // Scores are candidate-scoped, while the captured page belongs to the job.
    // Collapse them before joining or one posting appears once per candidate,
    // consuming the limit and inflating both queue and description counts.
    const bestScore = db
      .select({
        jobId: jobScore.jobId,
        fit: sql<number>`max(${jobScore.fit})`.as("fit"),
      })
      .from(jobScore)
      .groupBy(jobScore.jobId)
      .as("best_job_score");

    const candidates = await db
      .select({ id: job.id, url: job.url, fit: bestScore.fit })
      .from(job)
      .leftJoin(bestScore, eq(bestScore.jobId, job.id))
      .leftJoin(jobPage, eq(jobPage.jobId, job.id))
      .leftJoin(scrapeTask, eq(scrapeTask.jobId, job.id))
      .where(
        and(
          isNull(job.closedAt),
          // Synthetic manual origins are already local text, not fetchable URLs.
          sql`(${job.url} like 'http://%' or ${job.url} like 'https://%')`,
          sql`coalesce(${bestScore.fit}, 0) >= ${criteria.minFit}`,
          isNull(scrapeTask.id),
          criteria.refresh ? sql`1 = 1` : isNull(jobPage.jobId),
          criteria.refresh
            ? sql`1 = 1`
            : sql`length(coalesce(${job.descriptionText}, '')) < ${criteria.minExistingChars}`,
        ),
      )
      .orderBy(desc(bestScore.fit))
      .limit(criteria.limit);

    // Reported so a small queue does not look like a broken filter.
    const [described] = await db
      .select({ n: sql<number>`count(*)` })
      .from(job)
      .leftJoin(bestScore, eq(bestScore.jobId, job.id))
      .leftJoin(scrapeTask, eq(scrapeTask.jobId, job.id))
      .where(
        and(
          isNull(job.closedAt),
          sql`coalesce(${bestScore.fit}, 0) >= ${criteria.minFit}`,
          isNull(scrapeTask.id),
          sql`length(coalesce(${job.descriptionText}, '')) >= ${criteria.minExistingChars}`,
        ),
      );

    let queued = 0;
    for (const candidate of candidates) {
      const inserted = await db
        .insert(scrapeTask)
        .values({
          jobId: candidate.id,
          url: candidate.url,
          priority: Number(candidate.fit ?? 0),
        })
        // A job already queued is not an error; the run is idempotent.
        .onConflictDoNothing()
        .returning({ id: scrapeTask.id });
      queued += inserted.length;
    }

    return {
      queued,
      skipped: candidates.length - queued,
      alreadyDescribed: Number(described?.n ?? 0),
    };
  },

  async retryFailed() {
    const rows = await getDb()
      .update(scrapeTask)
      .set({ status: "pending", attempts: 0, runAfter: null, lastError: null })
      .where(eq(scrapeTask.status, "failed"))
      .returning({ id: scrapeTask.id });
    return rows.length;
  },
};
