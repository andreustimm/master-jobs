import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/contexts/auth/index.ts";
import {
  createTrack,
  resolveClusterFilter,
  setMatchingProfile,
  setPrimaryTrack,
  suggestTrack,
  targetOf,
  trackScope,
  updateTrack,
  type Track,
  type TrackChoice,
  type TrackTarget,
} from "../src/contexts/matching/index.ts";
import { drizzleTargetCorpus } from "../src/contexts/skills/infra/drizzle-adapters.ts";
import { funnelAnalysis, scorerDiagnostics } from "../src/core/analytics/index.ts";
import { buildDossier } from "../src/core/apply/dossier.ts";
import { analyseGap, saveDocument } from "../src/core/candidate.ts";
import { addContact, referralOpportunities } from "../src/core/contacts.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  boardFacets,
  clusterBreakdown,
  corpusStats,
  countBoard,
  listBoard,
  pipelineRows,
  setApplicationStatus,
} from "../src/core/db/repo.ts";
import { candidate, company, job, jobScore, scrapeTask, source, verifyTask } from "../src/core/db/schema.ts";
import { enqueueStale } from "../src/core/ingest/verify-queue.ts";
import { verifyJobs } from "../src/core/ingest/verify.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { buildReport } from "../src/core/report/markdown.ts";
import { scoreAll, trackFitsForJob } from "../src/core/scoring/apply.ts";
import { drizzleQueueAdmin } from "../src/core/scrape/infra/drizzle-queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const session = vi.hoisted(() => ({ current: null as unknown }));

// A rota lê sessão e idioma do Next; o teste fornece os dois e usa a regra de
// escopo real do contexto de autenticação.
vi.mock("../app/auth", async () => {
  const { candidateScope } = await import("../src/contexts/auth/index.ts");
  return { requirePage: async () => session.current, candidateScope };
});
vi.mock("../app/i18n", async () => {
  const { translator } = await import("../src/core/i18n/index.ts");
  return { getTranslator: async () => translator("pt-BR") };
});
vi.mock("../app/filters", () => ({ readFilters: () => ({}), toBoardFilters: () => ({}) }));

const { GET: exportCsv } = await import("../app/api/export/route.ts");

const LARAVEL = { slug: "laravel", name: "Laravel", category: "framework" as const, aliases: [] };
const LONG = "Laravel services, PHP 8 queues, Horizon workers and Postgres. ".repeat(10);

let db: DB;
let primaryTarget: TrackTarget;

beforeEach(async () => {
  db = await useTestDb();
  const base = await loadProfile(true);
  primaryTarget = targetOf(base);
  await db.insert(source).values({ id: "manual:readers", kind: "manual", handle: "readers", label: "Readers" });
  await db.insert(company).values({ slug: "tracks-co", name: "Tracks Co" });
});

afterEach(async () => {
  session.current = null;
  await releaseTestDb();
});

function phpTarget(): TrackTarget {
  const target = suggestTrack({ term: "Laravel", catalog: [LARAVEL], primary: primaryTarget }).target;
  target.keywords.critical.push({ term: "php", weight: 8 });
  return target;
}

async function person(slug: string, opts: { owner: boolean; profile: boolean }): Promise<number> {
  const [row] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: opts.owner })
    .returning({ id: candidate.id });
  if (opts.profile) await setMatchingProfile(row!.id, await loadProfile(true));
  return row!.id;
}

async function phpTrack(candidateId: number): Promise<Track> {
  const result = await createTrack(candidateId, { name: "Dev PHP", target: phpTarget() });
  if (!result.ok) throw new Error(result.code);
  return result.track;
}

async function primaryOf(candidateId: number): Promise<number> {
  return (await trackScope(candidateId, { kind: "primary" }))!.primaryTrackId;
}

let seq = 0;
async function addJob(title: string, description: string | null = LONG): Promise<number> {
  const [employer] = await db.select({ id: company.id }).from(company).limit(1);
  const n = ++seq;
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "manual:readers",
      companyId: employer!.id,
      companyName: "Tracks Co",
      externalId: `readers-${n}`,
      title,
      descriptionText: description,
      url: `https://exemplo.test/vaga-${n}`,
      fingerprint: `readers-fp-${n}`,
      contentHash: `readers-hash-${n}`,
      raw: {},
    })
    .returning({ id: job.id });
  return row!.id;
}

async function score(candidateId: number, trackId: number, jobId: number, fit: number, cluster: string) {
  await db
    .insert(jobScore)
    .values({
      candidateId, trackId, jobId, fit,
      titleScore: fit, keywordScore: 0, seniorityScore: 0, geoScore: 0, compScore: 0,
      freshnessScore: 0, benefitScore: 0, penalty: 0, cluster,
      matchedKeywords: [], missingKeywords: [], detectedBenefits: [], ageDays: null,
      reasons: [], blockers: [], scorerVersion: "1.4.1", profileHash: `hash-${trackId}`,
    })
    .onConflictDoUpdate({
      target: [jobScore.candidateId, jobScore.trackId, jobScore.jobId],
      set: { fit, cluster },
    });
}

/** Principal com fit 50 ("architect") e PHP com fit 90 ("laravel") na mesma vaga. */
async function twoTracks() {
  const id = await person("owner", { owner: true, profile: true });
  const php = await phpTrack(id);
  const primaryId = await primaryOf(id);
  const jobId = await addJob("Senior Laravel Developer");
  await score(id, primaryId, jobId, 50, "architect");
  await score(id, php.id, jobId, 90, "laravel");
  return { id, php, primaryId, jobId };
}

async function scope(candidateId: number, choice: TrackChoice) {
  return (await trackScope(candidateId, choice))!;
}

async function csv(sessionValue: Partial<Session>): Promise<string[][]> {
  session.current = { userId: 1, email: "x@exemplo.test", fullName: null, expiresAt: "2999-01-01", ...sessionValue };
  const response = await exportCsv(new Request("https://exemplo.test/api/export"));
  const text = (await response.text()).replace(/^﻿/, "");
  return text.split("\n").map((line) => line.split(",").map((c) => c.replace(/^"|"$/g, "")));
}

describe("board readers on a track scope", () => {
  it("IT-032 default is the primary; a track and 'all' change fit, label and the cut", async () => {
    const { id, php, primaryId, jobId } = await twoTracks();

    expect(await listBoard(id)).toMatchObject([{ jobId, fit: 50, trackId: primaryId }]);
    const single = await scope(id, { kind: "track", trackId: php.id });
    expect(await listBoard(id, { track: single })).toMatchObject([{ fit: 90, trackId: php.id }]);
    const all = await scope(id, { kind: "all" });
    expect(await listBoard(id, { track: all })).toMatchObject([{ fit: 90, trackId: php.id }]);

    expect(await listBoard(id, { minFit: 60 })).toHaveLength(0);
    expect(await countBoard(id, { minFit: 60 })).toBe(0);
    expect(await listBoard(id, { minFit: 60, track: single })).toHaveLength(1);
    expect(await countBoard(id, { minFit: 60, track: all })).toBe(1);

    await score(id, php.id, jobId, 50, "laravel");
    expect(await listBoard(id, { track: all })).toMatchObject([{ fit: 50, trackId: primaryId }]);
  });

  it("IT-033 facets list the chosen track's clusters and drop a foreign cluster", async () => {
    const { id, php } = await twoTracks();
    const single = await scope(id, { kind: "track", trackId: php.id });

    expect((await boardFacets(id, { track: single })).clusters).toEqual(["laravel"]);
    expect((await boardFacets(id)).clusters).toEqual(["architect"]);
    expect(await resolveClusterFilter(single, "architect")).toEqual({ notice: "cluster_unknown" });
    expect(await resolveClusterFilter(single, "laravel")).toEqual({ cluster: "laravel" });
  });

  it("IT-041 with only a primary track, 'all' equals the default", async () => {
    const id = await person("solo", { owner: true, profile: true });
    const primaryId = await primaryOf(id);
    for (const [title, fit] of [["Staff AI Engineer", 72], ["Data Scientist", 41]] as const) {
      await score(id, primaryId, await addJob(title), fit, "architect");
    }
    const all = await scope(id, { kind: "all" });

    const pick = (rows: Awaited<ReturnType<typeof listBoard>>) => rows.map((r) => [r.jobId, r.fit, r.trackId]);
    expect(pick(await listBoard(id, { track: all }))).toEqual(pick(await listBoard(id)));
  });

  it("IT-030 a track being recalculated keeps its previous rows on the board", async () => {
    const id = await person("owner", { owner: true, profile: true });
    const php = await phpTrack(id);
    await addJob("Laravel Developer", "PHP 8 and Laravel.");
    await scoreAll(id);
    const single = await scope(id, { kind: "track", trackId: php.id });
    const before = await listBoard(id, { track: single });
    expect(before).toHaveLength(1);

    const next = phpTarget();
    next.seniority = { min_years_expected: 4, reject_below_years: 2 };
    expect((await updateTrack(id, php.id, { target: next, expectedUpdatedAt: php.updatedAt })).ok).toBe(true);

    const during = await listBoard(id, { track: single });
    expect(during.map((r) => [r.jobId, r.fit])).toEqual(before.map((r) => [r.jobId, r.fit]));
  });
});

describe("single-fit readers use the primary track", () => {
  it("IT-034 dossier, export, report, analytics, gap, referrals, corpus and cockpit report fit 50", async () => {
    const { id, jobId } = await twoTracks();
    await saveDocument({ candidateId: id, kind: "cv", label: "CV", content: "Senior AI architect. Python, LLM systems." });
    await addContact({ name: "Ana", company: "Tracks Co", category: "peer" });

    expect(await buildDossier(id, jobId, null)).toMatchObject({ fit: 50, cluster: "architect" });

    const rows = await csv({ candidateId: id, roles: ["candidate"] });
    const header = rows[0]!;
    const line = rows.find((r) => r[0] === String(jobId))!;
    expect(line[header.indexOf("fit")]).toBe("50.0");
    expect(line[header.indexOf("cluster")]).toBe("architect");

    expect((await buildReport(id)).markdown).toContain("| 50 | architect |");

    const diagnostics = await scorerDiagnostics(id);
    expect(diagnostics.jobs).toBe(1);
    expect(diagnostics.fit.mean).toBe(50);

    expect(await analyseGap({ candidateId: id, minFit: 60 })).toMatchObject({ jobsAnalysed: 0 });
    expect(await analyseGap({ candidateId: id, minFit: 45 })).toMatchObject({ jobsAnalysed: 1 });

    expect(await referralOpportunities(id)).toMatchObject([{ fit: 50, cluster: "architect" }]);

    expect(await drizzleTargetCorpus.targetTexts({ candidateId: id, minFit: 60, limit: 10 })).toHaveLength(0);
    expect(await drizzleTargetCorpus.targetTexts({ candidateId: id, minFit: 45, limit: 10 })).toHaveLength(1);

    // A vaga do melhor fit é a da trilha principal, não a da trilha de 90.
    expect(await corpusStats(id)).toMatchObject({ above45: 1, above60: 0, above70: 0, best: 50, bestJobId: jobId });
    expect(await clusterBreakdown(id)).toMatchObject([{ cluster: "architect", n: 1, best: 50 }]);
  });

  it("IT-034 funnel analysis groups applications by the primary cluster", async () => {
    const { id, php, primaryId } = await twoTracks();
    // Grupos só aparecem a partir de 30 candidaturas: abaixo disso é ruído.
    for (let n = 0; n < 30; n++) {
      const jobId = await addJob(`Laravel Developer ${n}`);
      await score(id, primaryId, jobId, 50, "architect");
      await score(id, php.id, jobId, 90, "laravel");
      await setApplicationStatus(id, jobId, "applied");
    }

    const funnel = JSON.stringify((await funnelAnalysis(id)).byCluster);
    expect(funnel).toContain("architect");
    expect(funnel).not.toContain("laravel");
  });

  it("IT-035 verification and capture queues rank by the primary fit", async () => {
    const { id, php, primaryId, jobId: phpHeavy } = await twoTracks();
    await score(id, primaryId, phpHeavy, 30, "architect");
    await score(id, php.id, phpHeavy, 95, "laravel");
    const primaryHeavy = await addJob("Staff AI Engineer");
    await score(id, primaryId, primaryHeavy, 60, "architect");

    expect(await enqueueStale({ minFit: 55 })).toBe(1);
    expect((await db.select({ jobId: verifyTask.jobId }).from(verifyTask)).map((r) => r.jobId)).toEqual([primaryHeavy]);

    const visited: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      visited.push(String(input));
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await verifyJobs({
      minFit: 0,
      concurrency: 1,
      delayMs: 0,
      fetchImpl,
      lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const urls = new Map((await db.select({ id: job.id, url: job.url }).from(job)).map((r) => [r.id, r.url]));
    const order = [primaryHeavy, phpHeavy].map((jobId) => visited.indexOf(urls.get(jobId)!));
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[0]).toBeLessThan(order[1]!);

    const queued = await drizzleQueueAdmin.enqueueEligible({ minFit: 45, limit: 10, refresh: false, minExistingChars: 2_000 });
    expect(queued.queued).toBe(1);
    expect((await db.select({ jobId: scrapeTask.jobId }).from(scrapeTask)).map((r) => r.jobId)).toEqual([primaryHeavy]);
  });

  it("IT-036 the pipeline read carries the primary fit and nothing about tracks", async () => {
    const { id, jobId } = await twoTracks();
    await setApplicationStatus(id, jobId, "applied");

    const [row] = await pipelineRows(id);
    expect(row).toMatchObject({ jobId, fit: 50 });
    expect(Object.keys(row!).filter((key) => /track/i.test(key))).toEqual([]);
  });

  it("IT-038 changing the primary moves every single-fit reader to it", async () => {
    const { id, php, jobId } = await twoTracks();
    expect((await setPrimaryTrack(id, php.id)).ok).toBe(true);

    expect(await buildDossier(id, jobId, null)).toMatchObject({ fit: 90, cluster: "laravel" });
    expect((await buildReport(id)).markdown).toContain("| 90 | laravel |");
  });

  it("IT-039 a pending primary shows no fit anywhere", async () => {
    const guest = await person("guest", { owner: false, profile: false });
    expect(await trackScope(guest, { kind: "primary" })).toBeNull();
    const jobId = await addJob("Senior Laravel Developer");

    expect(await buildDossier(guest, jobId, null)).toMatchObject({ fit: null, cluster: null });
    expect(await listBoard(guest)).toMatchObject([{ jobId, fit: null, trackId: null }]);
    const markdown = (await buildReport(guest)).markdown;
    expect(markdown).not.toContain("Senior Laravel Developer");
    const rows = await csv({ candidateId: guest, roles: ["candidate"] });
    expect(rows.find((r) => r[0] === String(jobId))![rows[0]!.indexOf("fit")]).toBe("");
  });
});

describe("job detail fits", () => {
  it("IT-040 a track without a row gets its fit computed and nothing is written", async () => {
    const id = await person("owner", { owner: true, profile: true });
    const php = await phpTrack(id);
    const jobId = await addJob("Staff AI Engineer", "LLM platform, Python and Go.");
    await scoreAll(id);
    const count = async () => Number((await db.select({ n: sql<number>`count(*)` }).from(jobScore))[0]!.n);
    const before = await count();
    expect(
      await db.select().from(jobScore).where(and(eq(jobScore.trackId, php.id), eq(jobScore.jobId, jobId))),
    ).toHaveLength(0);

    const fits = (await trackFitsForJob(id, jobId))!;

    expect(fits.map((f) => [f.isPrimary, f.computed])).toEqual([[true, false], [false, true]]);
    const phpFit = fits.find((f) => f.trackId === php.id)!;
    expect(phpFit.fit).toBeGreaterThanOrEqual(0);
    expect(phpFit).toHaveProperty("titleScore");
    expect(phpFit).toHaveProperty("keywordScore");
    expect(await count()).toBe(before);
    expect(await trackFitsForJob(id, 999_999)).toBeNull();
  });
});

describe("CSV export without candidate scope", () => {
  it("IT-125 has no track column and no fit for a recruiter or a scope-less session", async () => {
    const { id, jobId } = await twoTracks();
    for (const who of [
      { candidateId: id, roles: ["recruiter"] },
      { candidateId: null, roles: ["admin"] },
    ] as Array<Partial<Session>>) {
      const rows = await csv(who);
      const header = rows[0]!;
      expect(header.filter((column) => /track|trilha/i.test(column))).toEqual([]);
      expect(rows.find((r) => r[0] === String(jobId))![header.indexOf("fit")]).toBe("");
    }
  });
});
