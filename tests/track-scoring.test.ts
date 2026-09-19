import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveTrack,
  createTrack,
  effectiveProfile,
  isRelevant,
  setMatchingProfile,
  setPrimaryTrack,
  suggestTrack,
  targetOf,
  trackScoringProfiles,
  updateTrack,
  type Track,
  type TrackTarget,
} from "../src/contexts/matching/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidate, company, job, jobScore, scoreTask, source } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import { scoreAll, scoreOne } from "../src/core/scoring/apply.ts";
import { claimScore, enqueueScore, finishScoreTask, runScoreQueue } from "../src/core/scoring/queue.ts";
import { containsTerm, SCORER_VERSION, scoreJob, type ScoreResult } from "../src/core/scoring/score.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const LARAVEL = { slug: "laravel", name: "Laravel", category: "framework" as const, aliases: [] };
const AS_OF = Date.parse("2026-09-01T00:00:00Z");

let base: Profile;

/** O alvo da trilha PHP: títulos Laravel e as duas palavras que a nomeiam. */
function phpTarget(primary: TrackTarget): TrackTarget {
  const target = suggestTrack({ term: "Laravel", catalog: [LARAVEL], primary }).target;
  target.keywords.critical.push({ term: "php", weight: 8 });
  return target;
}

function score(input: Parameters<typeof scoreJob>[0], target: TrackTarget): ScoreResult {
  return scoreJob(input, { profile: effectiveProfile(base, target), fx: null, asOf: AS_OF });
}

/** Os componentes que não são `name`, para comparar "só este mudou". */
function componentsExcept(result: ScoreResult, name: keyof ScoreResult) {
  const components = {
    titleScore: result.titleScore,
    keywordScore: result.keywordScore,
    seniorityScore: result.seniorityScore,
    geoScore: result.geoScore,
    compScore: result.compScore,
    freshnessScore: result.freshnessScore,
    benefitScore: result.benefitScore,
    penalty: result.penalty,
  };
  delete (components as Record<string, unknown>)[name];
  return components;
}

describe("per-track effective profile (pure scorer)", () => {
  beforeEach(async () => {
    base = await loadProfile(true);
  });

  it("UT-071 a PHP job fits the PHP track better, with the same blockers", () => {
    const primary = targetOf(base);
    const input = {
      title: "Senior Laravel Developer",
      companyName: "Acme",
      locationRaw: "Remote — LATAM",
      remote: true,
      descriptionText: "We build our platform on PHP and Laravel. Remote across LATAM.",
    };
    const onPrimary = score(input, primary);
    const onPhp = score(input, phpTarget(primary));
    expect(onPhp.fit).toBeGreaterThan(onPrimary.fit);
    expect(onPhp.blockers).toEqual(onPrimary.blockers);
  });

  it("UT-072 the track's pay ranges change only the comp component", () => {
    const high = targetOf(base);
    const low = structuredClone(high);
    const monthly = (target: TrackTarget) =>
      target.compensation.ranges.find((r) => r.currency === "USD" && r.period === "month")!;
    Object.assign(monthly(high), { floor: 7_500, target: 12_500, ideal: 18_000 });
    Object.assign(monthly(low), { floor: 4_000, target: 5_000, ideal: 6_000 });
    const input = {
      title: "Staff AI Engineer",
      companyName: "Acme",
      remote: true,
      compMin: 5_000,
      compMax: 5_000,
      compCurrency: "USD",
      compPeriod: "month",
    };
    const a = score(input, high);
    const b = score(input, low);
    expect(a.compScore).not.toBe(b.compScore);
    expect(componentsExcept(a, "compScore")).toEqual(componentsExcept(b, "compScore"));
  });

  it("UT-073 a negative keyword of the primary penalizes only the primary", () => {
    const primary = targetOf(base);
    expect(primary.keywords.negative.some((k) => k.term === "wordpress")).toBe(true);
    const php = phpTarget(primary);
    expect(php.keywords.negative.some((k) => k.term === "wordpress")).toBe(false);
    const input = {
      title: "Laravel Developer",
      companyName: "Acme",
      remote: true,
      descriptionText: "PHP, Laravel and some WordPress maintenance.",
    };
    const withoutWordpress = { ...input, descriptionText: "PHP and Laravel." };
    const primaryDelta = score(withoutWordpress, primary).fit - score(input, primary).fit;
    const phpDelta = score(withoutWordpress, php).fit - score(input, php).fit;
    expect(primaryDelta).toBeGreaterThan(0);
    expect(score(input, primary).penalty).toBeGreaterThan(score(withoutWordpress, primary).penalty);
    expect(phpDelta).toBe(0);
    expect(score(input, php).penalty).toBe(score(withoutWordpress, php).penalty);
  });

  it("UT-074 the track's seniority changes only the seniority component", () => {
    const strict = targetOf(base);
    const relaxed = structuredClone(strict);
    strict.seniority = { min_years_expected: 7, reject_below_years: 3 };
    relaxed.seniority = { min_years_expected: 3, reject_below_years: 2 };
    const input = {
      title: "Staff AI Engineer",
      companyName: "Acme",
      remote: true,
      descriptionText: "You bring 5+ years of experience with LLM systems.",
    };
    const a = score(input, strict);
    const b = score(input, relaxed);
    expect(a.seniorityScore).toBeLessThan(b.seniorityScore);
    expect(componentsExcept(a, "seniorityScore")).toEqual(componentsExcept(b, "seniorityScore"));
  });

  it("UT-075 undisclosed pay is neutral on every track", () => {
    const primary = targetOf(base);
    const input = { title: "Laravel Developer", companyName: "Acme", remote: true };
    expect(score(input, primary).compScore).toBe(4);
    expect(score(input, phpTarget(primary)).compScore).toBe(4);
  });

  it("UT-076 scorer 1.4.0 matches terms on the shared boundary", () => {
    expect(SCORER_VERSION).toBe("1.4.1");
    expect(containsTerm("C# developer", "c#")).toBe(true);
    expect(containsTerm("C# developer", "c")).toBe(false);
  });
});

describe("per-track persistence", () => {
  let db: DB;

  beforeEach(async () => {
    db = await useTestDb();
    base = await loadProfile(true);
  });

  afterEach(async () => {
    await releaseTestDb();
  });

  async function owner(): Promise<{ id: number; primary: TrackTarget }> {
    const [row] = await db
      .insert(candidate)
      .values({ slug: "owner", name: "Owner", isDefault: true })
      .returning({ id: candidate.id });
    await setMatchingProfile(row!.id, base);
    return { id: row!.id, primary: targetOf(base) };
  }

  async function track(candidateId: number, name: string, target: TrackTarget): Promise<Track> {
    const result = await createTrack(candidateId, { name, target });
    if (!result.ok) throw new Error(result.code);
    return result.track;
  }

  async function seedJobs(rows: Array<{ title: string; description: string | null }>): Promise<number[]> {
    await db.insert(source).values({ id: "manual:tracks", kind: "manual", handle: "tracks", label: "Tracks" });
    const [employer] = await db
      .insert(company)
      .values({ slug: "tracks-co", name: "Tracks Co" })
      .returning({ id: company.id });
    const inserted = await db
      .insert(job)
      .values(rows.map((row, n) => ({
        sourceId: "manual:tracks",
        companyId: employer!.id,
        companyName: "Tracks Co",
        externalId: `job-${n}`,
        title: row.title,
        descriptionText: row.description,
        url: `manual://tracks/${n}`,
        fingerprint: `tracks-fp-${n}`,
        contentHash: `tracks-hash-${n}`,
        raw: {},
      })))
      .returning({ id: job.id });
    return inserted.map((row) => row.id);
  }

  async function rowsOf(candidateId: number, trackId: number) {
    return db
      .select({ jobId: jobScore.jobId, hash: jobScore.profileHash, version: jobScore.scorerVersion })
      .from(jobScore)
      .where(and(eq(jobScore.candidateId, candidateId), eq(jobScore.trackId, trackId)));
  }

  async function primaryIdOf(candidateId: number): Promise<number> {
    const profiles = await trackScoringProfiles(candidateId);
    return profiles!.find((p) => p.track.isPrimary)!.track.id;
  }

  const OTHERS = [
    "Staff AI Engineer", "Java Engineer", "React Developer", "Data Scientist",
    "Go Engineer", "DevOps Engineer", "Product Designer",
  ];

  it("IT-023 primary scores every open job; the PHP track only the relevant ones", async () => {
    const { id, primary } = await owner();
    const php = await track(id, "Dev PHP", phpTarget(primary));
    const relevant = [
      { title: "Laravel Developer", description: null },
      { title: "Senior Laravel Developer", description: "Queues and Horizon." },
      { title: "Backend Engineer", description: "Our API is PHP 8.3." },
      { title: "Platform Engineer", description: "Legacy PHP monolith." },
      { title: "Full Stack Engineer", description: "Vue front, Laravel back." },
      { title: "Tech Lead", description: "Lead a PHP squad." },
    ];
    const other = Array.from({ length: 14 }, (_, n) => ({
      title: OTHERS[n % OTHERS.length]!,
      description: "Python, TypeScript and Kubernetes.",
    }));
    await seedJobs([...relevant, ...other]);

    await scoreAll(id);

    expect(await rowsOf(id, await primaryIdOf(id))).toHaveLength(20);
    expect(await rowsOf(id, php.id)).toHaveLength(6);
  });

  it("IT-024 a keyword change moves the accepted rows and leaves the primary untouched", async () => {
    const { id, primary } = await owner();
    const target = suggestTrack({ term: "Backend", catalog: [], primary }).target;
    target.targets.clusters = { backend: { weight: 1, titles: ["Laravel Developer"], cv_variant: "backend" } };
    target.keywords.critical = [{ term: "laravel", weight: 10 }];
    const php = await track(id, "Dev PHP", target);
    const [laravelJob, symfonyJob] = await seedJobs([
      { title: "Backend Engineer", description: "We use Laravel." },
      { title: "Backend Engineer", description: "We use Symfony." },
      { title: "Staff AI Engineer", description: "LLM platform." },
    ]);
    await scoreAll(id);
    const primaryId = await primaryIdOf(id);
    const primaryBefore = await rowsOf(id, primaryId);
    expect((await rowsOf(id, php.id)).map((r) => r.jobId)).toEqual([laravelJob]);

    const next = structuredClone(target);
    next.targets.clusters = { backend: { weight: 1, titles: ["Symfony Developer"], cv_variant: "backend" } };
    next.keywords.critical = [{ term: "symfony", weight: 10 }];
    const updated = await updateTrack(id, php.id, { target: next, expectedUpdatedAt: php.updatedAt });
    expect(updated.ok).toBe(true);
    await scoreAll(id);

    expect((await rowsOf(id, php.id)).map((r) => r.jobId)).toEqual([symfonyJob]);
    const primaryAfter = await rowsOf(id, primaryId);
    expect(primaryAfter.map((r) => r.hash).sort()).toEqual(primaryBefore.map((r) => r.hash).sort());
  });

  it("a primary swap re-applies the relevance gate to the demoted track on the next incremental run", async () => {
    const { id, primary } = await owner();
    const php = await track(id, "Dev PHP", phpTarget(primary));
    const jobs = [
      { title: "Laravel Developer", description: null },
      { title: "Platform Engineer", description: "Legacy PHP monolith." },
      { title: "Florist", description: "Arranges flowers for weddings." },
      { title: "Staff AI Engineer", description: "LLM platform in Python and TypeScript." },
    ];
    const ids = await seedJobs(jobs);
    await scoreAll(id);
    const oldPrimaryId = await primaryIdOf(id);
    expect(await rowsOf(id, oldPrimaryId)).toHaveLength(jobs.length);

    expect((await setPrimaryTrack(id, php.id)).ok).toBe(true);
    await scoreAll(id);

    const expected = ids.filter((_, n) => isRelevant(primary, jobs[n]!)).sort();
    expect(expected.length).toBeLessThan(jobs.length);
    expect((await rowsOf(id, oldPrimaryId)).map((r) => r.jobId).sort()).toEqual(expected);
    expect(await rowsOf(id, php.id)).toHaveLength(jobs.length);
  });

  it("IT-025 a pending primary writes no score through any path", async () => {
    const [row] = await db
      .insert(candidate)
      .values({ slug: "guest", name: "Guest", isDefault: false })
      .returning({ id: candidate.id });
    const [jobId] = await seedJobs([{ title: "Laravel Developer", description: null }]);

    expect(await scoreAll(row!.id)).toMatchObject({ scored: 0 });
    expect(await scoreOne(row!.id, jobId!)).toBeNull();
    await enqueueScore(row!.id);
    await runScoreQueue();

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobScore) as [{ n: number }];
    expect(n).toBe(0);
  });

  it("IT-026 a scorer version change rescores every track", async () => {
    const { id, primary } = await owner();
    const php = await track(id, "Dev PHP", phpTarget(primary));
    await seedJobs([
      { title: "Laravel Developer", description: null },
      { title: "Staff AI Engineer", description: "LLM platform." },
    ]);
    await scoreAll(id);
    await db.update(jobScore).set({ scorerVersion: "1.3.0" });

    await scoreAll(id);

    const all = await db.select({ version: jobScore.scorerVersion, trackId: jobScore.trackId }).from(jobScore);
    expect(all).toHaveLength(3);
    expect(all.every((r) => r.version === SCORER_VERSION)).toBe(true);
    expect(all.some((r) => r.trackId === php.id)).toBe(true);
  });

  it("IT-027 an edit during a running recalculation wins after the queue re-runs", async () => {
    const { id, primary } = await owner();
    const php = await track(id, "Dev PHP", phpTarget(primary));
    await seedJobs([
      { title: "Laravel Developer", description: "PHP 8." },
      { title: "Backend Engineer", description: "Laravel and PHP." },
    ]);
    const claimed = await claimScore("worker-a");
    expect(claimed?.candidateId).toBe(id);
    // O trabalhador pontua com o alvo que existia quando pegou a tarefa.
    await scoreAll(id);

    const next = phpTarget(primary);
    next.seniority = { min_years_expected: 4, reject_below_years: 2 };
    const updated = await updateTrack(id, php.id, { target: next, expectedUpdatedAt: php.updatedAt });
    expect(updated.ok).toBe(true);
    await finishScoreTask(claimed!.id, 2, null);
    const [task] = await db.select().from(scoreTask).where(eq(scoreTask.candidateId, id));
    expect(task!.status).toBe("pending");

    await runScoreQueue();

    const latest = (await trackScoringProfiles(id))!.find((p) => p.track.id === php.id)!.hash;
    const rows = await rowsOf(id, php.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.hash === latest)).toBe(true);
  });

  it("IT-028 an archived accepted track gets no rows", async () => {
    const { id, primary } = await owner();
    const php = await track(id, "Dev PHP", phpTarget(primary));
    expect(await archiveTrack(id, php.id)).toMatchObject({ ok: true });
    await seedJobs([{ title: "Laravel Developer", description: "PHP." }]);

    await scoreAll(id);

    expect(await rowsOf(id, php.id)).toHaveLength(0);
    expect(await rowsOf(id, await primaryIdOf(id))).toHaveLength(1);
  });

  it("IT-029 six tracks over 10,000 jobs keep the relevance gate exact", async () => {
    const { id, primary } = await owner();
    const accepted: Track[] = [];
    for (const term of ["Laravel", "Java", "React", "Go", "Ruby"]) {
      accepted.push(await track(id, term, suggestTrack({ term, catalog: [], primary }).target));
    }
    await db.insert(source).values({ id: "manual:bulk", kind: "manual", handle: "bulk", label: "Bulk" });
    const [employer] = await db
      .insert(company)
      .values({ slug: "bulk-co", name: "Bulk Co" })
      .returning({ id: company.id });
    await db.execute(sql.raw(`
      with recursive n(x) as (values(1) union all select x + 1 from n where x < 10000)
      insert into production.job (
        source_id, company_id, company_name, external_id, title, description_text,
        url, fingerprint, content_hash, raw
      )
      select
        'manual:bulk', ${employer!.id}, 'Bulk Co', 'bulk-' || x,
        (array['Laravel Developer','Java Engineer','React Developer','Senior Go Engineer',
               'Ruby on Rails Developer','Staff AI Engineer','Data Scientist',
               'Python Backend Engineer','DevOps Engineer','JavaScript Engineer'])[1 + x % 10],
        case when x % 3 = 0 then null
             else 'Stack: ' || (array['php','kotlin','typescript','rust','golang'])[1 + x % 5] end,
        'manual://bulk/' || x, 'bulk-fp-' || x, 'bulk-hash-' || x, '{}'
      from n
    `));

    await scoreAll(id);

    const jobs = await db.select({ id: job.id, title: job.title, description: job.descriptionText }).from(job);
    expect(await rowsOf(id, await primaryIdOf(id))).toHaveLength(10_000);
    for (const t of accepted) {
      const expected = jobs.filter((j) => isRelevant(t.target!, j)).map((j) => j.id).sort((a, b) => a - b);
      const actual = (await rowsOf(id, t.id)).map((r) => r.jobId).sort((a, b) => a - b);
      expect(actual, t.name).toEqual(expected);
      expect(actual.length, t.name).toBeGreaterThan(0);
    }
  }, 300_000);

  it("IT-031 without a description, the accepted track decides by title alone", async () => {
    const { id, primary } = await owner();
    const php = await track(id, "Dev PHP", phpTarget(primary));
    const [laravelJob] = await seedJobs([
      { title: "Laravel Developer", description: null },
      { title: "Backend Engineer", description: null },
    ]);

    await scoreAll(id);

    expect(await rowsOf(id, await primaryIdOf(id))).toHaveLength(2);
    expect((await rowsOf(id, php.id)).map((r) => r.jobId)).toEqual([laravelJob]);
  });
});
