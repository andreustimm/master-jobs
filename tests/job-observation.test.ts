// Suite: canonical RawJob observation
// Invariant: every ingestion channel reports the same persistence outcomes and
// invalidates every candidate-scoped score when scoring content changes.
// Boundary IN: real migrated libSQL plus public sync/manual/import/mail services
// Boundary OUT: payload and MIME parsing details, covered by their own suites
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidate, company, job, jobScore } from "../src/core/db/schema.ts";
import { importJobs, parsePayload } from "../src/core/ingest/import.ts";
import { addJob, ensureImportSource } from "../src/core/ingest/manual.ts";
import { observeRawJob } from "../src/core/ingest/observe.ts";
import { syncAll } from "../src/core/ingest/run.ts";
import { importMail } from "../src/core/mail/run.ts";
import {
  fixtureHttp,
  resetHttpPort,
  setHttpPort,
} from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import type { RawJob } from "../src/core/sources/types.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
const tempDirs: string[] = [];

function rawJob(overrides: Partial<RawJob> = {}): RawJob {
  return {
    externalId: "staff-ai-1",
    companyName: "Acme Technologies",
    title: "Staff AI Engineer",
    url: "https://jobs.example.test/staff-ai-1",
    applyUrl: "",
    locationRaw: "Remote - LATAM",
    remote: true,
    descriptionText: "Build reliable AI platforms.",
    postedAt: "2026-08-10T12:00:00Z",
    raw: { fixture: true },
    ...overrides,
  };
}

async function seedCandidateScores(jobId: number): Promise<number[]> {
  const people = await db
    .insert(candidate)
    .values([
      { slug: "observer-one", name: "Observer One" },
      { slug: "observer-two", name: "Observer Two" },
    ])
    .returning({ id: candidate.id });

  await db.insert(jobScore).values(
    people.map((person, index) => ({
      candidateId: person.id,
      jobId,
      fit: 70 + index,
      titleScore: 70,
      keywordScore: 70,
      seniorityScore: 70,
      geoScore: 70,
      compScore: 70,
      freshnessScore: 70,
      benefitScore: 70,
      penalty: 0,
      cluster: "architect",
      matchedKeywords: [],
      missingKeywords: [],
      detectedBenefits: [],
      ageDays: 1,
      reasons: [],
      blockers: [],
      scorerVersion: "observer-test",
    })),
  );
  return people.map((person) => person.id);
}

function greenhouseFixture(description: string): void {
  setHttpPort(
    fixtureHttp({
      "boards-api.greenhouse.io": {
        jobs: [
          {
            id: 42,
            title: "Staff AI Engineer",
            absolute_url: "https://boards.greenhouse.io/observe/jobs/42",
            location: { name: "Remote - LATAM" },
            company_name: "Sync Company",
            content: `<p>${description}</p>`,
            first_published: "2026-08-10T12:00:00Z",
          },
        ],
      },
    }),
  );
}

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  resetHttpPort();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  releaseTestDb();
});

describe("observeRawJob", () => {
  it("reports inserted, unchanged, changed and reopened while invalidating every candidate score", async () => {
    await ensureImportSource("manual:observer", "manual", "observer", "Observer");

    const inserted = await observeRawJob(rawJob(), "manual:observer");
    expect(inserted).toMatchObject({ outcome: "inserted", invalidatedScores: 0 });

    const [stored] = await db.select().from(job).where(eq(job.id, inserted.jobId));
    const employers = await db.select().from(company);
    expect(stored).toMatchObject({
      applyUrl: "https://jobs.example.test/staff-ai-1",
      companyId: employers[0]!.id,
    });

    // The suffix is intentionally ignored by company resolution and identity.
    const unchanged = await observeRawJob(
      rawJob({ companyName: "Acme" }),
      "manual:observer",
    );
    expect(unchanged).toMatchObject({
      jobId: inserted.jobId,
      outcome: "unchanged",
      invalidatedScores: 0,
    });
    expect(await db.select().from(company)).toHaveLength(1);

    await seedCandidateScores(inserted.jobId);
    const changedRaw = rawJob({
      companyName: "Acme",
      descriptionText: "Build reliable AI platforms and production RAG systems.",
    });
    const changed = await observeRawJob(changedRaw, "manual:observer");
    expect(changed).toMatchObject({
      jobId: inserted.jobId,
      outcome: "changed",
      contentChanged: true,
      invalidatedScores: 2,
    });
    expect(await db.select().from(jobScore)).toEqual([]);

    await db
      .update(job)
      .set({ closedAt: "2026-08-19T12:00:00.000Z" })
      .where(eq(job.id, inserted.jobId));
    const reopened = await observeRawJob(changedRaw, "manual:observer");
    expect(reopened).toMatchObject({
      jobId: inserted.jobId,
      outcome: "reopened",
      contentChanged: false,
      invalidatedScores: 0,
    });
    const [openAgain] = await db.select().from(job).where(eq(job.id, inserted.jobId));
    expect(openAgain!.closedAt).toBeNull();
  });

  it("updates an application URL without invalidating unchanged scoring content", async () => {
    await ensureImportSource("manual:metadata", "manual", "metadata", "Metadata");
    const inserted = await observeRawJob(rawJob(), "manual:metadata");
    await seedCandidateScores(inserted.jobId);

    const observed = await observeRawJob(
      rawJob({ applyUrl: "https://apply.example.test/staff-ai-1" }),
      "manual:metadata",
    );

    expect(observed).toMatchObject({ outcome: "unchanged", invalidatedScores: 0 });
    expect(await db.select().from(jobScore)).toHaveLength(2);
    const [stored] = await db.select().from(job).where(eq(job.id, inserted.jobId));
    expect(stored!.applyUrl).toBe("https://apply.example.test/staff-ai-1");
  });

  it("elects one insert when two sources observe the same fingerprint concurrently", async () => {
    await ensureImportSource("manual:race-one", "manual", "race-one", "Race One");
    await ensureImportSource("manual:race-two", "manual", "race-two", "Race Two");

    const observations = await Promise.all([
      observeRawJob(rawJob(), "manual:race-one"),
      observeRawJob(rawJob(), "manual:race-two"),
    ]);

    expect(observations.map((item) => item.outcome).sort()).toEqual([
      "inserted",
      "unchanged",
    ]);
    expect(new Set(observations.map((item) => item.jobId)).size).toBe(1);
    expect(await db.select().from(job)).toHaveLength(1);
  });
});

describe("ingestion channels", () => {
  it("uses the canonical outcomes for automated sync", async () => {
    const config = {
      kind: "greenhouse" as const,
      handle: "observe",
      label: "Sync Company",
    };

    greenhouseFixture("Build reliable AI platforms.");
    expect((await syncAll([config])).totals).toMatchObject({ inserted: 1 });

    greenhouseFixture("Build reliable AI platforms.");
    expect((await syncAll([config])).totals).toMatchObject({ unchanged: 1 });

    greenhouseFixture("Build reliable AI platforms and production RAG systems.");
    const changed = await syncAll([config]);
    expect(changed.totals).toMatchObject({ changed: 1, updated: 1 });

    const [posting] = await db.select({ id: job.id }).from(job);
    await db
      .update(job)
      .set({ closedAt: "2026-08-19T12:00:00.000Z" })
      .where(eq(job.id, posting!.id));
    greenhouseFixture("Build reliable AI platforms and production RAG systems.");
    expect((await syncAll([config])).totals).toMatchObject({ reopened: 1 });

    const [stored] = await db.select().from(job).where(eq(job.id, posting!.id));
    expect(stored!.applyUrl).toBe("https://boards.greenhouse.io/observe/jobs/42");
  });

  it("uses the canonical outcomes for a manually entered posting", async () => {
    const input = {
      url: "https://manual.example.test/jobs/staff-ai-1",
      title: "Staff AI Engineer",
      companyName: "Manual Company",
      description: "Build reliable AI platforms.",
    };

    expect(await addJob(input)).toMatchObject({ outcome: "inserted", created: true });
    expect(await addJob(input)).toMatchObject({ outcome: "unchanged", created: false });
    expect(
      await addJob({
        ...input,
        description: "Build reliable AI platforms and production RAG systems.",
      }),
    ).toMatchObject({ outcome: "changed", created: false });
  });

  it("uses the canonical outcomes for a captured JSON import", async () => {
    const parsed = parsePayload([
      {
        id: "json-1",
        title: "Staff AI Engineer",
        companyName: "Import Company",
        url: "https://import.example.test/jobs/json-1",
        description: "Build reliable AI platforms.",
      },
    ]);
    const options = { sourceKey: "observer-json", label: "Observer JSON" };

    expect(await importJobs(parsed, options)).toMatchObject({ inserted: 1 });
    expect(await importJobs(parsed, options)).toMatchObject({ unchanged: 1, updated: 1 });

    const changed = parsePayload([
      {
        id: "json-1",
        title: "Staff AI Engineer",
        companyName: "Import Company",
        url: "https://import.example.test/jobs/json-1",
        description: "Build reliable AI platforms and production RAG systems.",
      },
    ]);
    expect(await importJobs(changed, options)).toMatchObject({ changed: 1, updated: 1 });
  });

  it("deduplicates the same posting observed in two separate alert emails", async () => {
    const [person] = await db
      .insert(candidate)
      .values({ slug: "mail-observer", name: "Mail Observer" })
      .returning({ id: candidate.id });
    const dir = mkdtempSync(join(tmpdir(), "jho-mail-observer-"));
    tempDirs.push(dir);
    const html = [
      "<div>",
      '<a href="https://www.linkedin.com/jobs/view/4231234567">Senior AI Solutions Architect</a>',
      "<span>Nubank</span> | <span>Remote - LATAM</span>",
      "</div>",
    ].join("");
    const message = (id: string) => [
      "From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
      "Subject: New jobs for you",
      "Date: Wed, 19 Aug 2026 09:15:00 -0300",
      `Message-ID: <${id}@linkedin.com>`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
    ].join("\n");
    writeFileSync(join(dir, "alert-1.eml"), message("alert-1"));
    writeFileSync(join(dir, "alert-2.eml"), message("alert-2"));

    const result = await importMail(dir, { candidateId: person!.id });

    expect(result).toMatchObject({
      jobsCreated: 1,
      jobsUnchanged: 1,
      jobsChanged: 0,
      jobsReopened: 0,
    });
    const postings = await db.select().from(job);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      companyName: "Nubank",
      applyUrl: "https://www.linkedin.com/jobs/view/4231234567",
    });
  });
});
