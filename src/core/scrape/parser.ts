/**
 * Stage two, wired: read captured HTML, extract, store.
 *
 * The extraction itself is pure (`extract.ts`). This file only moves data, and
 * observes one rule that matters: it fills `job.descriptionText` when the job
 * has none, and never overwrites text that came from a source adapter. The
 * adapter got its text from the employer's own API; a scraped page is a good
 * fallback, not an upgrade.
 */
import { eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { job, jobPage, jobScore } from "../db/schema.ts";
import { extractPage } from "./extract.ts";
import { dbQueue, type QueuePort } from "./queue.ts";

export type ParseOutcome =
  | { kind: "parsed"; chars: number; fields: number }
  | { kind: "failed"; reason: string };

export async function parseStored(jobId: number): Promise<ParseOutcome> {
  const db = getDb();
  const [page] = await db.select().from(jobPage).where(eq(jobPage.jobId, jobId)).limit(1);

  if (!page) return { kind: "failed", reason: "sem página capturada" };
  if (!page.html) return { kind: "failed", reason: "página vazia" };

  const extracted = extractPage(page.html);
  if (!extracted.text) {
    return { kind: "failed", reason: "nenhum texto utilizável na página" };
  }

  const now = new Date().toISOString();

  await db
    .update(jobPage)
    .set({
      text: extracted.text,
      extracted: {
        title: extracted.title,
        fields: extracted.fields,
        requirements: extracted.requirements,
      },
      parsedAt: now,
    })
    .where(eq(jobPage.jobId, jobId));

  // Only fill a gap. Text from the employer's own API beats anything scraped
  // off the rendered page, so it is never replaced.
  const filled = await db
    .update(job)
    .set({ descriptionText: extracted.text })
    .where(
      sql`${job.id} = ${jobId} and (${job.descriptionText} is null or length(${job.descriptionText}) < 200)`,
    )
    .returning({ id: job.id });

  // A job that just gained a description has a stale score: the keyword
  // component was computed against nothing.
  if (filled.length > 0) {
    await db.delete(jobScore).where(eq(jobScore.jobId, jobId));
  }

  return {
    kind: "parsed",
    chars: extracted.text.length,
    fields: Object.keys(extracted.fields).length,
  };
}

export type ParseStageResult = { processed: number; parsed: number; failed: number; rescored: number };

export async function runParseStage(
  opts: { concurrency?: number; limit?: number; queue?: QueuePort } = {},
): Promise<ParseStageResult> {
  const queue = opts.queue ?? dbQueue;
  // Parsing is CPU-bound and local; more workers than cores buys nothing.
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const limit = opts.limit ?? Infinity;

  const result: ParseStageResult = { processed: 0, parsed: 0, failed: 0, rescored: 0 };

  async function worker(name: string): Promise<void> {
    for (;;) {
      if (result.processed >= limit) return;
      const task = await queue.claim("fetched", name);
      if (!task) return;

      result.processed++;
      const outcome = await parseStored(task.jobId);

      if (outcome.kind === "parsed") {
        result.parsed++;
        await queue.complete(task.id, "done");
      } else {
        result.failed++;
        // Re-parsing a page that yielded nothing will yield nothing again until
        // the extractor changes — which is what `scrape retry` is for.
        await queue.fail(task.id, outcome.reason, false);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(`parse-${i}`)));

  const db = getDb();
  const [pending] = await db
    .select({ n: sql<number>`count(*)` })
    .from(job)
    .leftJoin(jobScore, eq(jobScore.jobId, job.id))
    .where(isNull(jobScore.jobId));
  result.rescored = Number(pending?.n ?? 0);

  return result;
}

/** Re-runs extraction over every captured page, without re-fetching. */
export async function reparseAll(): Promise<ParseStageResult> {
  const db = getDb();
  const pages = await db.select({ jobId: jobPage.jobId }).from(jobPage);

  const result: ParseStageResult = { processed: 0, parsed: 0, failed: 0, rescored: 0 };
  for (const page of pages) {
    result.processed++;
    const outcome = await parseStored(page.jobId);
    if (outcome.kind === "parsed") result.parsed++;
    else result.failed++;
  }
  return result;
}
