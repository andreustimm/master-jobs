// Suite: Drizzle scraping queue adapter
// Invariant: candidate-scoped scores produce one job-level queue task at max priority.
// Boundary IN: real migrated libSQL schema and the Drizzle queue adapter
// Boundary OUT: HTTP capture/parser workers, covered by their own suites
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import {
  candidate,
  company,
  job,
  jobScore,
  scrapeTask,
  source,
} from "../src/core/db/schema.ts";
import {
  drizzleQueue,
  drizzleQueueAdmin,
} from "../src/core/scrape/infra/drizzle-queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

async function seedPosting(
  externalId: string,
  options: { descriptionText?: string; queued?: boolean } = {},
): Promise<{ jobId: number; taskId: number | null }> {
  await db
    .insert(source)
    .values({
      id: "greenhouse:queue-adapter",
      kind: "greenhouse",
      handle: "queue-adapter",
      label: "Queue Adapter",
    })
    .onConflictDoNothing({ target: source.id });
  await db
    .insert(company)
    .values({ slug: "queue-adapter", name: "Queue Adapter" })
    .onConflictDoNothing({ target: company.slug });
  const [employer] = await db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.slug, "queue-adapter"));
  const [posting] = await db
    .insert(job)
    .values({
      sourceId: "greenhouse:queue-adapter",
      companyId: employer!.id,
      companyName: "Queue Adapter",
      externalId,
      title: "Staff Engineer",
      descriptionText: options.descriptionText ?? null,
      url: `https://example.test/${externalId}`,
      fingerprint: `queue-adapter-${externalId}`,
      contentHash: `queue-adapter-content-${externalId}`,
      raw: "{}",
    })
    .returning({ id: job.id });
  if (options.queued === false) return { jobId: posting!.id, taskId: null };
  const [task] = await db
    .insert(scrapeTask)
    .values({
      jobId: posting!.id,
      url: `https://example.test/${externalId}`,
      priority: 80,
    })
    .returning({ id: scrapeTask.id });
  return { jobId: posting!.id, taskId: task!.id };
}

async function seedScore(candidateId: number, jobId: number, fit: number): Promise<void> {
  await db.insert(jobScore).values({
    candidateId,
    jobId,
    fit,
    titleScore: fit,
    keywordScore: 0,
    seniorityScore: 0,
    geoScore: 0,
    compScore: 0,
    freshnessScore: 0,
    benefitScore: 0,
    penalty: 0,
    cluster: "architect",
    matchedKeywords: [],
    missingKeywords: [],
    detectedBenefits: [],
    ageDays: null,
    reasons: [],
    blockers: [],
    scorerVersion: "test",
  });
}

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => releaseTestDb());

describe("Drizzle queue adapter", () => {
  it("claims one task for exactly one competing worker", async () => {
    await seedPosting("claim");

    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        drizzleQueue.claim("pending", `worker-${index}`),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("persists the pure retry decision and releases the claim", async () => {
    const { taskId } = await seedPosting("retry");
    const claimed = await drizzleQueue.claim("pending", "worker-1");
    await drizzleQueue.fail(claimed!.id, "HTTP 503", true);

    const [stored] = await db
      .select()
      .from(scrapeTask)
      .where(eq(scrapeTask.id, taskId!));
    expect(stored).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "HTTP 503",
      claimedAt: null,
      claimedBy: null,
    });
    expect(stored!.runAfter).toBeTruthy();
  });

  it("queues each job once at its maximum candidate fit without inflating counts", async () => {
    const eligible = await seedPosting("eligible", {
      descriptionText: "short",
      queued: false,
    });
    const described = await seedPosting("described", {
      descriptionText: "x".repeat(2_100),
      queued: false,
    });
    const candidates = await db
      .insert(candidate)
      .values([
        { slug: "candidate-one", name: "Candidate One" },
        { slug: "candidate-two", name: "Candidate Two" },
      ])
      .returning({ id: candidate.id });

    await seedScore(candidates[0]!.id, eligible.jobId, 55);
    await seedScore(candidates[1]!.id, eligible.jobId, 91);
    await seedScore(candidates[0]!.id, described.jobId, 60);
    await seedScore(candidates[1]!.id, described.jobId, 80);

    const result = await drizzleQueueAdmin.enqueueEligible({
      minFit: 45,
      limit: 10,
      refresh: false,
      minExistingChars: 2_000,
    });

    expect(result).toEqual({ queued: 1, skipped: 0, alreadyDescribed: 1 });
    const tasks = await db.select().from(scrapeTask);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ jobId: eligible.jobId, priority: 91 });
  });
});
