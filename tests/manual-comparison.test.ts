import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listBoard } from "../src/core/db/repo.ts";
import { ensureCandidate } from "../src/core/candidate.ts";
import { application, job, jobScore, source } from "../src/core/db/schema.ts";
import {
  addManualDescriptionJob,
  ensureImportSource,
  upsertRawJob,
} from "../src/core/ingest/manual.ts";
import { enqueueVerify } from "../src/core/ingest/verify-queue.ts";
import { verifyJobs } from "../src/core/ingest/verify.ts";
import { buildReport } from "../src/core/report/markdown.ts";
import { scoreOne } from "../src/core/scoring/apply.ts";
import { SCORER_VERSION, WEIGHTS } from "../src/core/scoring/score.ts";
import { enqueuePending } from "../src/core/scrape/queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const DESCRIPTION =
  "We need a Senior AI Software Architect to lead TypeScript and Python systems, distributed architecture, LLM products, observability, and cloud delivery. This is a fully remote role open to LATAM and Brazil.";

describe("manual comparison job", () => {
  let db: Awaited<ReturnType<typeof useTestDb>>;
  let candidateId: number;

  beforeEach(async () => {
    db = await useTestDb();
    candidateId = await ensureCandidate({ name: "Comparison Candidate" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseTestDb();
  });

  it("stores uploaded provenance without creating an application", async () => {
    const result = await addManualDescriptionJob({
      title: "Senior AI Software Architect",
      companyName: "Example Labs",
      description: DESCRIPTION,
      location: "Remote · LATAM",
      inputMethod: "file",
      sourceFilename: "job.md",
      documentFormat: "markdown",
      pages: null,
      extractionWarnings: ["review reading order"],
    });

    expect(result.created).toBe(true);
    const [stored] = await db.select().from(job).where(eq(job.id, result.jobId));
    expect(stored?.url).toMatch(/^manual:\/\/local\//);
    expect(stored?.descriptionText).toBe(DESCRIPTION);
    expect(stored?.sourceId).toBe("manual:local");
    expect(stored?.raw).toMatchObject({
      manual: true,
      inputMethod: "file",
      sourceFilename: "job.md",
      documentFormat: "markdown",
      extractionWarnings: ["review reading order"],
    });

    const sources = await db.select().from(source).where(eq(source.id, "manual:local"));
    expect(sources[0]?.enabled).toBe(false);
    expect(await db.select().from(application)).toEqual([]);
  });

  it("deduplicates by job identity and reopens instead of duplicating", async () => {
    const first = await addManualDescriptionJob({
      title: "Senior AI Software Architect",
      companyName: "Example Labs",
      description: DESCRIPTION,
      location: "Remote · LATAM",
      inputMethod: "paste",
    });
    await db
      .update(job)
      .set({ closedAt: "2026-08-01T00:00:00.000Z" })
      .where(eq(job.id, first.jobId));

    const updatedDescription = `${DESCRIPTION}\nThe updated posting also asks for Kubernetes.`;
    const second = await addManualDescriptionJob({
      title: " Senior AI Software Architect ",
      companyName: "Example Labs",
      description: updatedDescription,
      location: "Remote · LATAM",
      inputMethod: "paste",
    });

    expect(second).toMatchObject({ jobId: first.jobId, created: false });
    const rows = await db.select().from(job);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.closedAt).toBeNull();
    expect(rows[0]?.descriptionText).toBe(updatedDescription);
  });

  it("keeps the public ATS observation immutable and creates an isolated comparison", async () => {
    await ensureImportSource("ashby:example", "ashby", "example", "Example Labs");
    const publicUrl = "https://jobs.ashbyhq.com/example/architect-1";
    const original = await upsertRawJob(
      {
        externalId: "architect-1",
        companyName: "Example Labs",
        title: "Senior AI Software Architect",
        locationRaw: "Remote · LATAM",
        descriptionText: "Original ATS description with enough context to identify the posting.",
        url: publicUrl,
        applyUrl: `${publicUrl}/application`,
        raw: { sourcePayload: true },
      },
      "ashby:example",
    );
    await db
      .update(job)
      .set({
        checkedAt: "2026-08-01T00:00:00.000Z",
        checkStatus: "gone",
        checkCode: 410,
        closedAt: "2026-08-01T00:00:00.000Z",
      })
      .where(eq(job.id, original.jobId));
    const [before] = await db.select().from(job).where(eq(job.id, original.jobId));

    const compared = await addManualDescriptionJob({
      title: "Senior AI Software Architect",
      companyName: "Example Labs",
      location: "Remote · LATAM",
      description: DESCRIPTION,
      inputMethod: "paste",
    });

    expect(compared).toMatchObject({ created: true });
    expect(compared.jobId).not.toBe(original.jobId);

    const [after] = await db.select().from(job).where(eq(job.id, original.jobId));
    expect(after).toEqual(before);
    const [manual] = await db.select().from(job).where(eq(job.id, compared.jobId));
    expect(manual).toMatchObject({
      sourceId: "manual:local",
      descriptionText: DESCRIPTION,
      closedAt: null,
      raw: { manual: true, inputMethod: "paste" },
    });
    expect(await db.select().from(job)).toHaveLength(2);
  });

  it("persists the canonical score and makes the description readable on the board", async () => {
    const added = await addManualDescriptionJob({
      title: "Senior AI Software Architect",
      companyName: "Manual Score Co",
      description: DESCRIPTION,
      location: "Remote · Brazil",
      inputMethod: "paste",
    });

    const result = await scoreOne(candidateId, added.jobId);
    expect(result).not.toBeNull();
    expect(result?.fit).toBeGreaterThan(0);
    expect(result?.freshnessScore).toBe(WEIGHTS.freshness * 0.5);
    expect(result?.ageDays).toBeNull();

    const [storedScore] = await db
      .select()
      .from(jobScore)
      .where(and(eq(jobScore.candidateId, candidateId), eq(jobScore.jobId, added.jobId)));
    expect(storedScore?.fit).toBe(result?.fit);
    expect(storedScore?.scorerVersion).toBe(SCORER_VERSION);

    const board = await listBoard(candidateId, { q: "Manual Score Co" });
    expect(board).toHaveLength(1);
    expect(board[0]?.pageText).toContain("Senior AI Software Architect");
    expect(board[0]?.pageTextLength).toBe(DESCRIPTION.length);

    expect(await enqueueVerify(added.jobId)).toEqual({
      queued: false,
      reason: "unsupported-url",
    });
    expect(await enqueuePending({ minFit: 0 })).toMatchObject({ queued: 0 });

    const report = await buildReport(candidateId, { minFit: 0 });
    expect(report.markdown).not.toContain("manual://");
  });

  it("legacy verification skips synthetic jobs before applying its limit", async () => {
    const manual = await addManualDescriptionJob({
      title: "Senior AI Software Architect",
      companyName: "Manual First Co",
      description: DESCRIPTION,
      location: "Remote · Brazil",
      inputMethod: "paste",
    });
    await scoreOne(candidateId, manual.jobId);
    await db
      .update(jobScore)
      .set({ fit: 100 })
      .where(and(eq(jobScore.candidateId, candidateId), eq(jobScore.jobId, manual.jobId)));

    await ensureImportSource("ashby:verify", "ashby", "verify", "Public Verify Co");
    const publicUrl = "https://jobs.ashbyhq.com/verify/public-role";
    const publicJob = await upsertRawJob(
      {
        externalId: "public-role",
        companyName: "Public Verify Co",
        title: "Backend Engineer",
        locationRaw: "Remote",
        descriptionText: DESCRIPTION,
        url: publicUrl,
        raw: {},
      },
      "ashby:verify",
    );
    await scoreOne(candidateId, publicJob.jobId);
    await db
      .update(jobScore)
      .set({ fit: 1 })
      .where(and(eq(jobScore.candidateId, candidateId), eq(jobScore.jobId, publicJob.jobId)));

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await verifyJobs({
      minFit: 0,
      limit: 1,
      concurrency: 1,
      delayMs: 0,
      dryRun: true,
      fetchImpl: fetchMock as typeof fetch,
      lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    expect(result).toMatchObject({ checked: 1, alive: 1, inconclusive: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(publicUrl);
  });
});
