import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchingProfile, setMatchingProfile } from "../src/contexts/matching/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidate, company, job, jobScore, source } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { scoreAll, scoreOne } from "../src/core/scoring/apply.ts";
import { SCORER_VERSION, scoreJob } from "../src/core/scoring/score.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

async function seedCandidatesAndJob() {
  const [first, second] = await db
    .insert(candidate)
    .values([
      { slug: "first", name: "First", isDefault: true },
      { slug: "second", name: "Second" },
    ])
    .returning({ id: candidate.id });
  await db.insert(source).values({
    id: "manual:matching",
    kind: "manual",
    handle: "matching",
    label: "Matching",
  });
  const [employer] = await db
    .insert(company)
    .values({ slug: "matching", name: "Matching" })
    .returning({ id: company.id });
  const [posting] = await db
    .insert(job)
    .values({
      sourceId: "manual:matching",
      companyId: employer!.id,
      companyName: "Matching",
      externalId: "same-job",
      title: "AI Solutions Architect",
      descriptionText: "Remote LATAM role designing distributed systems and RAG platforms.",
      locationRaw: "Remote LATAM",
      url: "manual://matching",
      fingerprint: "matching",
      contentHash: "matching",
      raw: "{}",
    })
    .returning({ id: job.id });
  return { first: first!.id, second: second!.id, jobId: posting!.id };
}

describe("candidate-owned matching context", () => {
  it("persists independent profiles and scores for the same job", async () => {
    const seeded = await seedCandidatesAndJob();
    const base = await loadProfile(true);
    const firstProfile = structuredClone(base);
    const secondProfile = structuredClone(base);
    secondProfile.targets.clusters.architect!.weight = 0;

    await setMatchingProfile(seeded.first, firstProfile);
    await setMatchingProfile(seeded.second, secondProfile);
    const [firstResult, secondResult] = await Promise.all([
      scoreOne(seeded.first, seeded.jobId),
      scoreOne(seeded.second, seeded.jobId),
    ]);

    expect(firstResult!.fit).toBeGreaterThan(secondResult!.fit);
    const rows = await db.select().from(jobScore).where(eq(jobScore.jobId, seeded.jobId));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.profileHash)).size).toBe(2);
  });

  it("is reproducible for a fixed asOf and changes only when time input changes", async () => {
    const profile = await loadProfile(true);
    const input = {
      title: "AI Solutions Architect",
      companyName: "Acme",
      locationRaw: "Remote LATAM",
      postedAt: "2026-08-01T00:00:00.000Z",
    };
    const context = { profile, fx: null, asOf: Date.parse("2026-08-20T00:00:00.000Z") };
    expect(scoreJob(input, context)).toEqual(scoreJob(input, context));
    expect(scoreJob(input, { ...context, asOf: context.asOf + 30 * 86_400_000 }).freshnessScore)
      .toBeLessThan(scoreJob(input, context).freshnessScore);
  });

  it("reprocesses current-version scores after the freshness window", async () => {
    const seeded = await seedCandidatesAndJob();
    const selected = await matchingProfile(seeded.first);
    await db.insert(jobScore).values({
      candidateId: seeded.first,
      jobId: seeded.jobId,
      fit: 1,
      titleScore: 0,
      keywordScore: 0,
      seniorityScore: 0,
      geoScore: 0,
      compScore: 0,
      freshnessScore: 0,
      benefitScore: 0,
      penalty: 0,
      cluster: "other",
      matchedKeywords: [],
      missingKeywords: [],
      detectedBenefits: [],
      ageDays: null,
      reasons: [],
      blockers: [],
      scorerVersion: SCORER_VERSION,
      profileHash: selected.hash,
      scoredAt: "2020-01-01T00:00:00.000Z",
    });

    await expect(scoreAll(seeded.first)).resolves.toMatchObject({ scored: 1 });
    const [updated] = await db.select().from(jobScore);
    expect(updated!.fit).not.toBe(1);
  });
});
