/**
 * Stage one: capture the page, verbatim, and stop.
 *
 * This worker does no interpretation at all. That separation is the whole point
 * of the two-stage design: fetching is slow, rate-limited, and can be refused by
 * the site, while parsing is free, offline and gets better over time. Keeping
 * them apart means improving the extractor reprocesses 6.000 pages without
 * re-downloading a byte, and a site that starts blocking us never costs us the
 * pages already captured.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { jobPage } from "../db/schema.ts";
import { mayFetch, robotsFor } from "./robots.ts";
import { dbQueue, type ClaimedTask, type QueuePort } from "./queue.ts";

/** Pages larger than this are not job descriptions; they are a mistake. */
const MAX_BYTES = 3_000_000;

const TIMEOUT_MS = 20_000;

/** Minimum gap between two requests to the same host, absent a Crawl-delay. */
const DEFAULT_HOST_DELAY_MS = 1_000;

const lastHit = new Map<string, number>();

/**
 * Politeness gate, per host.
 *
 * Concurrency is what makes the crawl quick, but concurrency aimed at one host
 * is what gets an IP banned. Workers run in parallel across hosts and serialise
 * within one.
 */
async function waitForHost(origin: string, delayMs: number): Promise<void> {
  const previous = lastHit.get(origin) ?? 0;
  const wait = previous + delayMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(origin, Date.now());
}

export function resetHostThrottle(): void {
  lastHit.clear();
}

export type FetchOutcome =
  | { kind: "stored"; bytes: number; status: number }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; reason: string; retryable: boolean };

/** Which HTTP failures are worth trying again. */
export function retryable(status: number): boolean {
  // 404/410 mean the posting is gone; 403 usually means bot detection, which a
  // retry will not charm. 429 and 5xx are temporary by definition.
  if (status === 429) return true;
  return status >= 500;
}

export async function capture(
  task: ClaimedTask,
  fetcher = fetch,
): Promise<FetchOutcome> {
  let url: URL;
  try {
    url = new URL(task.url);
  } catch {
    return { kind: "failed", reason: `URL inválida: ${task.url}`, retryable: false };
  }

  if (!(await mayFetch(task.url))) {
    // Not a failure. The site said no, and that is a final answer.
    return { kind: "blocked", reason: "robots.txt não permite" };
  }

  const rules = await robotsFor(url.origin);
  await waitForHost(url.origin, rules.crawlDelayMs ?? DEFAULT_HOST_DELAY_MS);

  let res: Response;
  try {
    res = await fetcher(task.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent": process.env.JHO_USER_AGENT ?? "jho/1.0 (job search; +local)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en,pt-BR;q=0.8",
      },
    });
  } catch (error) {
    return { kind: "failed", reason: (error as Error).message, retryable: true };
  }

  if (!res.ok) {
    return { kind: "failed", reason: `HTTP ${res.status}`, retryable: retryable(res.status) };
  }

  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) {
    return { kind: "failed", reason: `Página grande demais (${length}B)`, retryable: false };
  }

  const html = await res.text();
  if (html.length > MAX_BYTES) {
    return { kind: "failed", reason: `Página grande demais (${html.length}B)`, retryable: false };
  }

  const hash = createHash("sha256").update(html).digest("hex").slice(0, 32);
  const db = getDb();

  await db
    .insert(jobPage)
    .values({
      jobId: task.jobId,
      finalUrl: res.url || task.url,
      httpStatus: res.status,
      html,
      contentHash: hash,
      bytes: html.length,
      fetchedAt: new Date().toISOString(),
      // Null marks it as awaiting stage two.
      parsedAt: null,
      text: null,
    })
    .onConflictDoUpdate({
      target: jobPage.jobId,
      set: {
        finalUrl: res.url || task.url,
        httpStatus: res.status,
        html,
        contentHash: hash,
        bytes: html.length,
        fetchedAt: new Date().toISOString(),
        parsedAt: null,
        text: null,
      },
    });

  return { kind: "stored", bytes: html.length, status: res.status };
}

export type StageResult = { processed: number; stored: number; blocked: number; failed: number };

/**
 * Runs the capture stage until the queue is empty.
 *
 * `concurrency` is across hosts; the per-host gate above keeps any single
 * server seeing one request at a time.
 */
export async function runFetchStage(
  opts: { concurrency?: number; limit?: number; queue?: QueuePort; fetcher?: typeof fetch } = {},
): Promise<StageResult> {
  const queue = opts.queue ?? dbQueue;
  const fetcher = opts.fetcher ?? fetch;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const limit = opts.limit ?? Infinity;

  const result: StageResult = { processed: 0, stored: 0, blocked: 0, failed: 0 };

  async function worker(name: string): Promise<void> {
    for (;;) {
      if (result.processed >= limit) return;
      const task = await queue.claim("pending", name);
      if (!task) return;

      result.processed++;
      const outcome = await capture(task, fetcher);

      if (outcome.kind === "stored") {
        result.stored++;
        await queue.complete(task.id, "fetched");
      } else if (outcome.kind === "blocked") {
        result.blocked++;
        await queue.complete(task.id, "blocked");
      } else {
        result.failed++;
        await queue.fail(task.id, outcome.reason, outcome.retryable);
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => worker(`fetch-${i}`)),
  );
  return result;
}
