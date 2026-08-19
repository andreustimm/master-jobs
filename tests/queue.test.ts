import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { company, job, jobScore, scrapeTask, source } from "../src/core/db/schema.ts";
import { MAX_ATTEMPTS, dbQueue, enqueuePending, retryFailed } from "../src/core/scrape/queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

async function seed(count: number, fit = 80): Promise<void> {
  await db.insert(source).values({ id: "greenhouse:acme", kind: "greenhouse", handle: "acme", label: "Acme" });
  const [c] = await db.insert(company).values({ slug: "acme", name: "Acme" }).returning({ id: company.id });
  for (let i = 0; i < count; i++) {
    const [j] = await db
      .insert(job)
      .values({
        sourceId: "greenhouse:acme",
        companyId: c!.id,
        companyName: "Acme",
        externalId: `job-${i}`,
        title: `Engineer ${i}`,
        url: `https://example.test/job-${i}`,
        fingerprint: `fp-${i}`,
        contentHash: `ch-${i}`,
        raw: "{}",
      })
      .returning({ id: job.id });
    await db.insert(jobScore).values({
      jobId: j!.id,
      fit: fit - i,
      titleScore: 0, keywordScore: 0, seniorityScore: 0, geoScore: 0, compScore: 0,
      penalty: 0, cluster: "architect",
      matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [],
      scorerVersion: "test",
    });
  }
}

beforeEach(async () => {
  db = await useTestDb();
});
afterEach(() => releaseTestDb());

describe("enqueuePending", () => {
  it("queues jobs above the fit floor, best first", async () => {
    // Capture is the expensive stage; spending it on jobs nobody opens is waste.
    await seed(5);
    const r = await enqueuePending({ minFit: 0 });
    expect(r.queued).toBe(5);

    const claimed = await dbQueue.claim("pending", "w1");
    expect(claimed!.url).toContain("job-0"); // highest fit
  });

  it("excludes jobs below the floor", async () => {
    await seed(3, 20);
    expect((await enqueuePending({ minFit: 45 })).queued).toBe(0);
  });

  it("is idempotent — running twice does not double the queue", async () => {
    await seed(3);
    await enqueuePending({ minFit: 0 });
    await enqueuePending({ minFit: 0 });
    const rows = await db.select().from(scrapeTask);
    expect(rows).toHaveLength(3);
  });
});

describe("claim", () => {
  it("hands a task to exactly one worker under concurrency", async () => {
    // The bug this prevents: two workers read "pending", both write "fetching",
    // both believe they own it, and the page is fetched twice.
    await seed(1);
    await enqueuePending({ minFit: 0 });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => dbQueue.claim("pending", `w${i}`)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("gives every task to someone, and none twice", async () => {
    await seed(10);
    await enqueuePending({ minFit: 0 });

    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, i) => dbQueue.claim("pending", `w${i}`)),
    );
    const ids = claims.filter(Boolean).map((t) => t!.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("returns null on an empty queue instead of blocking", async () => {
    expect(await dbQueue.claim("pending", "w1")).toBeNull();
  });

  it("does not hand a fetched task to the capture stage", async () => {
    // The two stages read different statuses; crossing them would re-download
    // everything already captured.
    await seed(1);
    await enqueuePending({ minFit: 0 });
    const task = await dbQueue.claim("pending", "w1");
    await dbQueue.complete(task!.id, "fetched");

    expect(await dbQueue.claim("pending", "w2")).toBeNull();
    expect(await dbQueue.claim("fetched", "w2")).not.toBeNull();
  });
});

describe("fail", () => {
  it("backs off and returns a retryable task to the queue", async () => {
    await seed(1);
    await enqueuePending({ minFit: 0 });
    const task = await dbQueue.claim("pending", "w1");
    await dbQueue.fail(task!.id, "HTTP 503", true);

    const [row] = await db.select().from(scrapeTask).where(eq(scrapeTask.id, task!.id));
    expect(row!.status).toBe("pending");
    expect(row!.attempts).toBe(1);
    // Backoff must actually hold it back, or the retry is a busy loop.
    expect(row!.runAfter).toBeTruthy();
    expect(await dbQueue.claim("pending", "w2")).toBeNull();
  });

  it("gives up immediately on a non-retryable failure", async () => {
    // Retrying a 404 four times only annoys the server.
    await seed(1);
    await enqueuePending({ minFit: 0 });
    const task = await dbQueue.claim("pending", "w1");
    await dbQueue.fail(task!.id, "HTTP 404", false);

    const [row] = await db.select().from(scrapeTask).where(eq(scrapeTask.id, task!.id));
    expect(row!.status).toBe("failed");
  });

  it("stops after MAX_ATTEMPTS", async () => {
    await seed(1);
    await enqueuePending({ minFit: 0 });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const [row] = await db.select().from(scrapeTask);
      await db.update(scrapeTask).set({ runAfter: null }).where(eq(scrapeTask.id, row!.id));
      const task = await dbQueue.claim("pending", "w1");
      expect(task, `tentativa ${i}`).not.toBeNull();
      await dbQueue.fail(task!.id, "timeout", true);
    }

    const [row] = await db.select().from(scrapeTask);
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(MAX_ATTEMPTS);
  });

  it("keeps the error message for diagnosis", async () => {
    await seed(1);
    await enqueuePending({ minFit: 0 });
    const task = await dbQueue.claim("pending", "w1");
    await dbQueue.fail(task!.id, "robots.txt não permite", false);
    const [row] = await db.select().from(scrapeTask);
    expect(row!.lastError).toContain("robots.txt");
  });
});

describe("retryFailed", () => {
  it("puts failures back with a clean slate", async () => {
    // The point: after improving the extractor, reprocess without re-fetching.
    await seed(2);
    await enqueuePending({ minFit: 0 });
    for (const worker of ["w1", "w2"]) {
      const task = await dbQueue.claim("pending", worker);
      await dbQueue.fail(task!.id, "erro", false);
    }

    expect(await retryFailed()).toBe(2);
    const rows = await db.select().from(scrapeTask);
    expect(rows.every((r) => r.status === "pending" && r.attempts === 0)).toBe(true);
  });
});

describe("stats", () => {
  it("counts by status", async () => {
    await seed(3);
    await enqueuePending({ minFit: 0 });
    const task = await dbQueue.claim("pending", "w1");
    await dbQueue.complete(task!.id, "done");

    const stats = await dbQueue.stats();
    expect(stats.done).toBe(1);
    expect(stats.pending).toBe(2);
  });
});
