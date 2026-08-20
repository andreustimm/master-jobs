/**
 * Checking that a posting still exists where it says it does.
 *
 * The problem this solves, measured on the live corpus: 5 of 26 sampled
 * Jobgether links return 404 while the source's API still lists them as open.
 * That is ~19%, which lines up with the 18–27% "ghost job" rate the competitor
 * benchmark found across the market. A board where one in five links is dead
 * is a board you stop trusting, and the cost of that is not the wasted click —
 * it is that you start doubting the ranking too.
 *
 * The discipline here is knowing what a status code proves:
 *
 *   404, 410  -> gone. Safe to close.
 *   403, 429  -> the site is blocking a bot, NOT evidence the job is gone.
 *                Himalayas does this on every request. Closing on a 403 would
 *                delete live jobs.
 *   5xx, timeout, network error -> proves nothing. Try again another day.
 *
 * > **Invariante:** only 404 and 410 close a posting. Anything else leaves it
 * > alone. A false close is unrecoverable from the user's point of view, since
 * > the job silently disappears from the board.
 */
import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { job } from "../db/schema.ts";
import { publicApplyUrl } from "../job-url.ts";
import type { LookupHost } from "../remote-url.ts";
import { probe } from "./probe.ts";

export type VerifyResult = {
  checked: number;
  gone: number;
  alive: number;
  /** Blocked, rate-limited or errored — status unknown, left untouched. */
  inconclusive: number;
  bySource: Record<string, { gone: number; alive: number; inconclusive: number }>;
};

export async function verifyJobs(
  opts: {
    minFit?: number;
    limit?: number;
    concurrency?: number;
    delayMs?: number;
    dryRun?: boolean;
    fetchImpl?: typeof fetch;
    lookupHost?: LookupHost;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<VerifyResult> {
  const db = getDb();
  const limit = opts.limit ?? 200;
  const minFit = opts.minFit ?? 55;

  // Verify what the user might actually click. Checking 6.000 links to police
  // rows nobody will ever see would be rude to the boards and pointless here.
  const candidates = await db
    .select({
      id: job.id,
      url: job.url,
      applyUrl: job.applyUrl,
      sourceId: job.sourceId,
    })
    .from(job)
    .where(
      and(
        isNull(job.closedAt),
        sql`coalesce((select max(fit) from job_score where job_id = ${job.id}), 0) >= ${minFit}`,
        or(
          like(job.applyUrl, "http://%"),
          like(job.applyUrl, "https://%"),
          like(job.url, "http://%"),
          like(job.url, "https://%"),
        ),
      ),
    )
    .orderBy(
      sql`coalesce((select max(fit) from job_score where job_id = ${job.id}), 0) desc`,
    );

  // Parse after the coarse SQL prefix filter so malformed values cannot
  // consume the requested limit or reach fetch().
  const rows = candidates
    .flatMap((candidate) => {
      const url = publicApplyUrl(candidate);
      return url ? [{ id: candidate.id, sourceId: candidate.sourceId, url }] : [];
    })
    .slice(0, limit);

  const result: VerifyResult = {
    checked: 0,
    gone: 0,
    alive: 0,
    inconclusive: 0,
    bySource: {},
  };

  const bump = (sourceId: string, key: "gone" | "alive" | "inconclusive") => {
    const kind = sourceId.split(":")[0] ?? sourceId;
    result.bySource[kind] ??= { gone: 0, alive: 0, inconclusive: 0 };
    result.bySource[kind][key]++;
  };

  const queue = [...rows];
  const stamp = new Date().toISOString();

  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;

      const { verdict, status } = await probe(next.url, {
        timeoutMs: 15_000,
        fetchImpl: opts.fetchImpl,
        lookupHost: opts.lookupHost,
      });
      result.checked++;

      if (verdict === "gone") {
        result.gone++;
        bump(next.sourceId, "gone");
        if (!opts.dryRun) {
          // Closed, not deleted — ADR 0005: an application may point at it.
          await db.update(job).set({ closedAt: stamp }).where(eq(job.id, next.id));
        }
      } else if (verdict === "alive") {
        result.alive++;
        bump(next.sourceId, "alive");
      } else {
        result.inconclusive++;
        bump(next.sourceId, "inconclusive");
      }

      opts.onProgress?.(result.checked, rows.length);
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 250));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency ?? 4, queue.length) }, worker),
  );

  return result;
}
