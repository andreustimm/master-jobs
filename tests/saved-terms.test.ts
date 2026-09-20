import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consoleMailer } from "../src/contexts/auth/index.ts";
import {
  activeTermKeys,
  archiveTrack,
  createTrack,
  deleteTerm,
  listBoard,
  moveTerm,
  newCount,
  rerunTerm,
  saveTerm,
  setMatchingProfile,
  setTermStatus,
  suggestTrack,
  targetOf,
  termOverview,
  trackScope,
  type ActionContext,
  type Track,
} from "../src/contexts/matching/index.ts";
import {
  requestTermCaptures,
  runTermCaptures,
} from "../src/contexts/sourcing/index.ts";
import { drizzleCaptureQueue } from "../src/contexts/sourcing/infra/drizzle-captures.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { setApplicationStatus } from "../src/core/db/repo.ts";
import {
  application,
  candidate,
  company,
  job,
  savedTerm,
  source,
  termAttribution,
  termCapture,
} from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const START = "2026-09-19T10:00:00.000Z";
const HOUR = 3_600_000;

function fixture(name: string): object {
  return JSON.parse(readFileSync(`tests/fixtures/term-search/${name}`, "utf8")) as object;
}

let db: DB;
let clock: ReturnType<typeof fixedClock>;
let port: ReturnType<typeof fixtureHttp>;
const env = { ...process.env };

beforeEach(async () => {
  db = await useTestDb();
  clock = fixedClock(START);
  setClock(clock);
  port = fixtureHttp({
    "remotive.com": fixture("remotive-laravel.json"),
    "remoteok.com": fixture("remoteok-tech-lead.json"),
    "himalayas.app": fixture("himalayas-laravel-page1.json"),
  });
  setHttpPort(port);
  process.env.JHO_SOURCES_PATH = "tests/fixtures/term-search/sources-three-platforms.yaml";
});

afterEach(async () => {
  process.env = { ...env };
  vi.restoreAllMocks();
  resetClock();
  resetHttpPort();
  await releaseTestDb();
});

const now = () => new Date(clock.now());
const ctx = (overrides: Partial<ActionContext> = {}): ActionContext => ({ now: now(), impersonated: false, ...overrides });
const day = (offsetDays = 0) => new Date(Date.parse(START) + offsetDays * 24 * HOUR).toISOString().slice(0, 10);

async function person(slug: string, owner: boolean): Promise<number> {
  const [row] = await db.insert(candidate).values({ slug, name: slug, isDefault: owner }).returning({ id: candidate.id });
  await setMatchingProfile(row!.id, await loadProfile(true));
  return row!.id;
}

async function track(candidateId: number, term: string): Promise<Track> {
  const primary = targetOf(await loadProfile(true));
  const result = await createTrack(candidateId, { name: term, target: suggestTrack({ term, catalog: [], primary }).target });
  if (!result.ok) throw new Error(result.code);
  return result.track;
}

async function saved(candidateId: number, term: string, trackId: number): Promise<number> {
  const result = await saveTerm({ candidateId }, { term, trackId }, ctx());
  if (!result.ok) throw new Error(result.code);
  return result.termId;
}

/** O que `jho terms run` faz: cada chave ativa uma vez, depois drena a fila. */
async function sweep() {
  for (const { termKey, query } of await activeTermKeys()) {
    await requestTermCaptures({ termKey, query, origin: "sweep", now: now() });
  }
  return runTermCaptures({ worker: "cli" });
}

/**
 * The platforms with HTTP fixtures here. Every other validated platform is off
 * in the pinned `sources.yaml` and gets a `skipped` row, which another test
 * covers; the lifecycle under test is these three.
 */
const FIXTURE_PLATFORMS = ["himalayas", "remoteok", "remotive"];

async function captures(termKey?: string) {
  return db
    .select()
    .from(termCapture)
    .where(and(inArray(termCapture.platform, FIXTURE_PLATFORMS), termKey ? eq(termCapture.termKey, termKey) : undefined))
    .orderBy(termCapture.platform, termCapture.windowDay);
}

describe("saving a term", () => {
  it("IT-074 stores the term and enqueues one capture per reachable platform", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");

    const result = await saveTerm({ candidateId: id }, { term: "Laravel", trackId: php.id }, ctx());

    expect(result).toMatchObject({ ok: true, run: "started" });
    expect(await db.select().from(savedTerm)).toMatchObject([{ term: "Laravel", termKey: "laravel", trackId: php.id }]);
    expect((await captures()).map((row) => [row.platform, row.status])).toEqual([
      ["himalayas", "queued"],
      ["remoteok", "queued"],
      ["remotive", "queued"],
    ]);
  });

  it("IT-075 needs a track, and not an archived one", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");
    await archiveTrack(id, php.id);

    expect(await saveTerm({ candidateId: id }, { term: "Laravel", trackId: null }, ctx())).toEqual({
      ok: false,
      code: "track_required",
    });
    expect(await saveTerm({ candidateId: id }, { term: "Laravel", trackId: php.id }, ctx())).toEqual({
      ok: false,
      code: "track_archived",
    });
  });

  it("IT-076 refuses a 21st active term", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");
    await db.insert(savedTerm).values(
      Array.from({ length: 20 }, (_, n) => ({ candidateId: id, trackId: php.id, term: `t${n}x`, termKey: `t${n}x` })),
    );

    expect(await saveTerm({ candidateId: id }, { term: "Laravel", trackId: php.id }, ctx())).toEqual({
      ok: false,
      code: "term_limit",
    });
  });

  it("IT-077 treats spacing and case as the same term", async () => {
    const id = await person("owner", true);
    const lead = await track(id, "Lead");
    const first = await saved(id, "techlead", lead.id);

    expect(await saveTerm({ candidateId: id }, { term: "Tech Lead", trackId: lead.id }, ctx())).toEqual({
      ok: false,
      code: "term_duplicate",
      termId: first,
    });
  });

  it("IT-079 a failed enqueue leaves neither the term nor a capture", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");
    await db.execute(sql`alter table production.term_capture add constraint refuse_all check (false) not valid`);

    await expect(saveTerm({ candidateId: id }, { term: "Laravel", trackId: php.id }, ctx())).rejects.toThrow();

    expect(await db.select().from(savedTerm)).toHaveLength(0);
    expect(await db.select().from(termCapture)).toHaveLength(0);
  });

  it("IT-080 a candidate with a pending primary cannot save a term", async () => {
    const [row] = await db.insert(candidate).values({ slug: "guest", name: "Guest", isDefault: false }).returning();

    expect(await saveTerm({ candidateId: row!.id }, { term: "Laravel", trackId: 1 }, ctx())).toEqual({
      ok: false,
      code: "primary_pending",
    });
  });

  it("IT-082 where ingestion is off the term is saved and nothing is fetched", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");
    process.env.JHO_ENV = "preview";

    expect(await saveTerm({ candidateId: id }, { term: "Laravel", trackId: php.id }, ctx())).toMatchObject({
      ok: true,
      run: "captures_off",
    });
    expect(await db.select().from(savedTerm)).toHaveLength(1);
    expect(await db.select().from(termCapture)).toHaveLength(0);
    expect((await termOverview({ candidateId: id }, now())).terms[0]).toMatchObject({ run: "captures_off" });
  });
});

describe("running a term again", () => {
  it("IT-084 cooldown, running and a new run after 24 hours", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    await runTermCaptures({ worker: "test" });

    clock.advance(2 * HOUR);
    expect(await rerunTerm({ candidateId: id }, termId, ctx())).toEqual({
      ok: false,
      code: "cooldown",
      availableAt: "2026-09-20T10:00:00.000Z",
    });

    const [remotive] = await captures("laravel").then((rows) => rows.filter((row) => row.platform === "remotive"));
    await db.update(termCapture).set({ status: "running" }).where(eq(termCapture.id, remotive!.id));
    expect(await rerunTerm({ candidateId: id }, termId, ctx())).toEqual({ ok: false, code: "running" });
    await db.update(termCapture).set({ status: "succeeded" }).where(eq(termCapture.id, remotive!.id));

    clock.advance(23 * HOUR);
    expect(await rerunTerm({ candidateId: id }, termId, ctx())).toEqual({ ok: true, run: "started" });
    expect((await captures("laravel")).filter((row) => row.windowDay === day(1))).toHaveLength(3);
  });

  it("IT-085 the daily sweep reuses a capture done today without calling again", async () => {
    const id = await person("owner", true);
    await saved(id, "Laravel", (await track(id, "PHP")).id);
    await runTermCaptures({ worker: "test" });
    const calls = port.calls.length;

    clock.advance(HOUR);
    await sweep();

    expect(port.calls).toHaveLength(calls);
    const [term] = (await termOverview({ candidateId: id }, now())).terms;
    expect(term).toMatchObject({ run: "succeeded", reused: true });
  });

  it("IT-086 inside the cooldown only the failed platform is tried again", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    await runTermCaptures({ worker: "test" });
    await db
      .update(termCapture)
      .set({ status: "failed", reasonCode: "http_error" })
      .where(eq(termCapture.platform, "remoteok"));

    clock.advance(2 * HOUR);
    expect(await rerunTerm({ candidateId: id }, termId, ctx())).toEqual({ ok: true, run: "started" });

    expect((await captures("laravel")).map((row) => [row.platform, row.status])).toEqual([
      ["himalayas", "succeeded"],
      ["remoteok", "queued"],
      ["remotive", "succeeded"],
    ]);
  });

  it("IT-087 two simultaneous re-runs after the cooldown enqueue once", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    await runTermCaptures({ worker: "test" });
    clock.advance(25 * HOUR);

    const results = await Promise.all([
      rerunTerm({ candidateId: id }, termId, ctx()),
      rerunTerm({ candidateId: id }, termId, ctx()),
    ]);

    // Um pede a busca; o outro vê a busca pedida — já enfileirada ("running"),
    // com a âncora movida depois de ele lê-la ("started") ou antes ("cooldown",
    // que diz quando pode buscar de novo). Nunca uma segunda busca.
    const outcomes = results.map((result) => (result.ok ? result.run : result.code));
    expect(outcomes).toContain("started");
    expect(outcomes.every((outcome) => ["started", "running", "cooldown"].includes(outcome))).toBe(true);
    expect((await captures("laravel")).filter((row) => row.windowDay === day(1))).toHaveLength(3);
    const [row] = await db.select().from(savedTerm);
    expect(row!.lastRunRequestedAt).toBe(now().toISOString());
  });

  it("IT-089 where ingestion is off a re-run says captures are off", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    process.env.JHO_ENV = "preview";

    expect(await rerunTerm({ candidateId: id }, termId, ctx())).toEqual({ ok: true, run: "captures_off" });
  });
});

describe("pause, resume, move, delete", () => {
  it("IT-090 a paused term leaves the daily sweep until it is resumed", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    await db.delete(termCapture);
    await setTermStatus({ candidateId: id }, termId, "paused");

    await sweep();
    expect(await captures("laravel")).toHaveLength(0);

    await setTermStatus({ candidateId: id }, termId, "active");
    await sweep();
    expect(await captures("laravel")).toHaveLength(3);
  });

  it("IT-091 moving a term keeps its jobs under the new track", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    const java = await track(id, "Java");
    await runTermCaptures({ worker: "test" });

    expect(await moveTerm({ candidateId: id }, termId, java.id)).toEqual({ ok: true });

    expect((await db.select().from(savedTerm))[0]!.trackId).toBe(java.id);
    const scope = (await trackScope(id, { kind: "track", trackId: java.id }))!;
    const rows = await listBoard(id, { track: scope, broughtBy: { termKey: "laravel" } });
    const attributed = await db.select({ jobId: termAttribution.jobId }).from(termAttribution);
    expect(rows.map((row) => row.jobId).sort()).toEqual(attributed.map((row) => row.jobId).sort());
    expect(rows.length).toBeGreaterThan(0);
  });

  it("IT-092 cannot move a term to an archived track", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    const java = await track(id, "Java");
    await archiveTrack(id, java.id);

    expect(await moveTerm({ candidateId: id }, termId, java.id)).toEqual({ ok: false, code: "track_archived" });
  });

  it("IT-093 deleting a term never touches its jobs, attributions or applications", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    await runTermCaptures({ worker: "test" });
    const [attributed] = await db.select().from(termAttribution);
    await setApplicationStatus(id, attributed!.jobId, "applied");
    const [inFlight] = await captures("laravel");
    await db
      .update(termCapture)
      .set({ status: "running", claimedAt: now().toISOString(), claimedBy: "test" })
      .where(eq(termCapture.id, inFlight!.id));

    expect(await deleteTerm({ candidateId: id }, termId)).toEqual({ ok: true });
    await drizzleCaptureQueue.finish(
      inFlight!.id,
      "test",
      { status: "succeeded", fetched: 1, created: 0, known: 1, attributed: 1, totalHint: 1 },
      now(),
    );

    expect((await db.select().from(termCapture).where(eq(termCapture.id, inFlight!.id)))[0]!.status).toBe("succeeded");
    expect((await db.select().from(termAttribution)).length).toBeGreaterThan(0);
    expect(await db.select().from(savedTerm)).toHaveLength(0);
    expect((await db.select().from(application))[0]).toMatchObject({ jobId: attributed!.jobId, status: "applied" });
    expect(await deleteTerm({ candidateId: id }, termId)).toEqual({ ok: true });
  });
});

describe("counts, sharing and the daily sweep", () => {
  async function attributedJob(termKey: string, n: number, firstSeenAt: string, closedAt: string | null = null) {
    await db.insert(source).values({ id: "remotive:~terms", kind: "remotive", handle: "~terms", label: "R", enabled: false }).onConflictDoNothing();
    const [employer] = await db.insert(company).values({ slug: `co-${n}`, name: `Co ${n}` }).returning();
    const [row] = await db
      .insert(job)
      .values({
        sourceId: "remotive:~terms", companyId: employer!.id, companyName: `Co ${n}`, externalId: `x${n}`,
        title: `Job ${n}`, url: `https://x.test/${n}`, fingerprint: `fp${n}`, contentHash: `h${n}`, raw: {},
        firstSeenAt, closedAt,
      })
      .returning();
    await db.insert(termAttribution).values({ termKey, jobId: row!.id, platform: "remotive" });
  }

  it("IT-094 new means open and first seen after the last visit", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    const visit = "2026-09-10T00:00:00.000Z";
    await attributedJob("laravel", 1, "2026-09-11T00:00:00.000Z");
    await attributedJob("laravel", 2, "2026-09-12T00:00:00.000Z");
    await attributedJob("laravel", 3, "2026-09-01T00:00:00.000Z");
    await attributedJob("laravel", 4, "2026-09-02T00:00:00.000Z");
    await attributedJob("laravel", 5, "2026-09-13T00:00:00.000Z", "2026-09-14T00:00:00.000Z");

    await db.update(savedTerm).set({ lastVisitAt: visit });
    expect(await newCount({ candidateId: id }, termId)).toBe(2);
    await db.update(savedTerm).set({ lastVisitAt: null });
    expect(await newCount({ candidateId: id }, termId)).toBe(4);
  });

  it("IT-096 two candidates share the capture, never each other's term", async () => {
    const a = await person("a", true);
    const b = await person("b", false);
    const [trackA, trackB] = [await track(a, "PHP"), await track(b, "PHP")];

    const [savedA, savedB] = await Promise.all([
      saveTerm({ candidateId: a }, { term: "laravel", trackId: trackA.id }, ctx()),
      saveTerm({ candidateId: b }, { term: "Laravel", trackId: trackB.id }, ctx()),
    ]);

    expect(savedA.ok && savedB.ok).toBe(true);
    expect(await captures("laravel")).toHaveLength(3);
    const overview = await termOverview({ candidateId: a }, now());
    expect(overview.terms).toHaveLength(1);
    expect(overview.terms[0]!.id).toBe(savedA.ok ? savedA.termId : 0);
    expect(await rerunTerm({ candidateId: a }, savedB.ok ? savedB.termId : 0, ctx())).toEqual({ ok: false, code: "not_found" });
    expect(await newCount({ candidateId: a }, savedB.ok ? savedB.termId : 0)).toBeNull();
  });

  it("IT-097 each active key once; paused and archived-track terms left out", async () => {
    const a = await person("a", true);
    const b = await person("b", false);
    const php = await track(a, "PHP");
    await saved(a, "Laravel", php.id);
    await saved(b, "laravel", (await track(b, "PHP")).id);
    const paused = await saved(a, "Symfony", php.id);
    await setTermStatus({ candidateId: a }, paused, "paused");
    const java = await track(a, "Java");
    await saved(a, "Kotlin", java.id);
    await archiveTrack(a, java.id);

    expect(await activeTermKeys()).toEqual([{ termKey: "laravel", query: "Laravel" }]);
  });

  it("IT-098 after days without a run, the sweep asks only for today", async () => {
    const id = await person("owner", true);
    await saved(id, "Laravel", (await track(id, "PHP")).id);
    await runTermCaptures({ worker: "test" });

    clock.advance(3 * 24 * HOUR);
    await sweep();

    const rows = await captures("laravel");
    expect(rows.filter((row) => row.windowDay === day(3))).toHaveLength(3);
    expect(rows.filter((row) => row.windowDay === day(1) || row.windowDay === day(2))).toHaveLength(0);
  });

  it("IT-099 the overview is a pure read", async () => {
    const id = await person("owner", true);
    await saved(id, "Laravel", (await track(id, "PHP")).id);
    const rows = await captures("laravel");
    const states = ["succeeded", "failed", "waiting_quota"] as const;
    for (const [n, row] of rows.entries()) {
      await db.update(termCapture).set({ status: states[n]!, reasonCode: n === 1 ? "http_error" : null }).where(eq(termCapture.id, row.id));
    }

    const first = await termOverview({ candidateId: id }, now());
    const second = await termOverview({ candidateId: id }, now());

    expect(second).toEqual(first);
    const tested = first.terms[0]!.platforms.filter((p) => FIXTURE_PLATFORMS.includes(p.platform));
    expect(tested.map((p) => p.status).sort()).toEqual(["failed", "succeeded", "waiting_quota"]);
  });

  it("IT-100 fourteen empty days show a notice and keep the term active", async () => {
    const id = await person("owner", true);
    await saved(id, "Laravel", (await track(id, "PHP")).id);
    await db.delete(termCapture);
    await db.insert(termCapture).values(
      Array.from({ length: 14 }, (_, n) => ({
        platform: "remotive", termKey: "laravel", query: "Laravel", windowDay: day(-n), origin: "sweep",
        status: "succeeded", fetched: 0, finishedAt: START,
      })),
    );

    const [term] = (await termOverview({ candidateId: id }, now())).terms;
    expect(term).toMatchObject({ notice: "no_results_14d", status: "active" });
  });

  it("o carimbo da captura vem do relógio da aplicação, não do banco", async () => {
    // `dailyRepeatPaused` compara 36 horas contra `created_at`. Enquanto esse
    // carimbo vinha do `clock_timestamp()` do PostgreSQL, a conta misturava dois
    // relógios: a mesma suíte passava às 05:07 e reprovava às 13:42 no MESMO
    // commit, porque a diferença dependia da hora real do dia.
    const id = await person("owner", true);
    await saved(id, "Laravel", (await track(id, "PHP")).id);
    clock.advance(24 * HOUR);
    await sweep();

    const [captura] = await db
      .select({ createdAt: termCapture.createdAt })
      .from(termCapture)
      .where(eq(termCapture.origin, "sweep"))
      .limit(1);
    expect(captura?.createdAt).toBe(clock.iso());
  });

  it("IT-101 36 hours without a sweep capture shows the daily repeat as paused", async () => {
    const id = await person("owner", true);
    await saved(id, "Laravel", (await track(id, "PHP")).id);
    expect((await termOverview({ candidateId: id }, now())).dailyRepeatPaused).toBe(true);

    clock.advance(24 * HOUR);
    await sweep();
    expect((await termOverview({ candidateId: id }, now())).dailyRepeatPaused).toBe(false);
    clock.advance(37 * HOUR);
    expect((await termOverview({ candidateId: id }, now())).dailyRepeatPaused).toBe(true);
  });

  it("IT-102 terms saved while captures were off run with the next sweep", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");
    process.env.JHO_ENV = "preview";
    await saved(id, "Laravel", php.id);
    expect(await db.select().from(termCapture)).toHaveLength(0);

    process.env = { ...env };
    await sweep();

    const rows = await captures("laravel");
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status !== "queued")).toBe(true);
  });

  it("IT-104 nothing in saving, re-running or capturing sends mail", async () => {
    const send = vi.spyOn(consoleMailer, "send");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    await runTermCaptures({ worker: "test" });
    clock.advance(25 * HOUR);
    await rerunTerm({ candidateId: id }, termId, ctx());
    await runTermCaptures({ worker: "test" });

    expect(send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await captures("laravel")).toHaveLength(6);
  });
});

describe("rules a paused term or an archived track must keep", () => {
  it("a paused term is refused a manual run and nothing is enqueued", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    await runTermCaptures({ worker: "test" });
    await setTermStatus({ candidateId: id }, termId, "paused");
    clock.advance(25 * HOUR);
    const before = (await captures("laravel")).length;

    expect(await rerunTerm({ candidateId: id }, termId, ctx())).toEqual({ ok: false, code: "paused" });
    expect(await captures("laravel")).toHaveLength(before);
  });

  it("a re-run outside the cooldown also retries a platform that failed today", async () => {
    const id = await person("owner", true);
    const termId = await saved(id, "Laravel", (await track(id, "PHP")).id);
    await runTermCaptures({ worker: "test" });
    clock.advance(25 * HOUR);
    await sweep();
    await db
      .update(termCapture)
      .set({ status: "failed", reasonCode: "http_error" })
      .where(and(eq(termCapture.platform, "remoteok"), eq(termCapture.windowDay, day(1))));

    expect(await rerunTerm({ candidateId: id }, termId, ctx())).toEqual({ ok: true, run: "started" });

    const today = (await captures("laravel")).filter((row) => row.windowDay === day(1));
    expect(today.find((row) => row.platform === "remoteok")?.status).toBe("queued");
  });

  it("resuming a term of an archived track is refused and the term keeps its archive pause", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");
    const termId = await saved(id, "Laravel", php.id);
    await archiveTrack(id, php.id);

    expect(await setTermStatus({ candidateId: id }, termId, "active")).toEqual({ ok: false, code: "track_archived" });
    expect((await db.select().from(savedTerm).where(eq(savedTerm.id, termId)))[0]).toMatchObject({
      status: "paused",
      pausedReason: "track_archived",
    });
  });
});

describe("the capture queue under per-minute budgets and leftovers", () => {
  it("the sweep waits for per-minute windows instead of leaving later terms parked", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");
    await saved(id, "Laravel", php.id);
    await saved(id, "Symfony", php.id);

    await runTermCaptures({ worker: "cli", waitMs: 10 * 60_000, sleep: async (ms) => clock.advance(ms) });

    const rows = await captures();
    expect(rows.filter((row) => row.platform === "remoteok").map((row) => row.status)).toEqual(["succeeded", "succeeded"]);
    expect(rows.every((row) => row.status === "succeeded")).toBe(true);
  });

  it("without a wait budget the drain still stops at the first empty claim (web after())", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");
    await saved(id, "Laravel", php.id);
    await saved(id, "Symfony", php.id);

    await runTermCaptures({ worker: "web" });

    expect((await captures()).filter((row) => row.status === "waiting_quota").length).toBeGreaterThan(0);
  });

  it("a Himalayas capture pages past the first 20 with the real ledger", async () => {
    const id = await person("owner", true);
    await saved(id, "Laravel", (await track(id, "PHP")).id);

    await runTermCaptures({ worker: "test" });

    expect(port.calls.filter((url) => url.includes("himalayas.app")).length).toBeGreaterThan(1);
    const himalayas = (await captures("laravel")).find((row) => row.platform === "himalayas");
    expect(himalayas?.status).toBe("succeeded");
  });

  it("a row left from an earlier day is retired, never claimed next to today's", async () => {
    await db.insert(termCapture).values({
      platform: "remotive",
      termKey: "laravel",
      query: "Laravel",
      windowDay: day(-1),
      origin: "web",
      priority: 10,
      status: "queued",
    });

    expect(await drizzleCaptureQueue.claim("test", now())).toBeNull();
    expect((await captures("laravel"))[0]).toMatchObject({ windowDay: day(-1), status: "skipped", reasonCode: "stale" });
  });

  it("a worker whose lease was taken over cannot overwrite the new holder's result", async () => {
    const id = await person("owner", true);
    await saved(id, "Laravel", (await track(id, "PHP")).id);
    const first = await drizzleCaptureQueue.claim("worker-a", now());
    clock.advance(6 * 60_000);
    const second = await drizzleCaptureQueue.claim("worker-b", now());
    expect(second?.id).toBe(first?.id);

    await drizzleCaptureQueue.finish(first!.id, "worker-a", { status: "failed", code: "network", retryable: true }, now());
    await drizzleCaptureQueue.finish(
      first!.id,
      "worker-b",
      { status: "succeeded", fetched: 3, created: 3, known: 0, attributed: 3, totalHint: 3 },
      now(),
    );

    expect((await db.select().from(termCapture).where(eq(termCapture.id, first!.id)))[0]).toMatchObject({
      status: "succeeded",
      fetched: 3,
    });
  });
});

describe("the daily ceiling on screen-started searches", () => {
  it("deleting and saving again cannot pass 40 searches a day; the 41st waits for the sweep", async () => {
    const id = await person("owner", true);
    const php = await track(id, "PHP");
    for (let n = 1; n <= 40; n++) {
      const result = await saveTerm({ candidateId: id }, { term: `stack${n}`, trackId: php.id }, ctx());
      if (!result.ok) throw new Error(result.code);
      await deleteTerm({ candidateId: id }, result.termId);
    }

    const over = await saveTerm({ candidateId: id }, { term: "Laravel", trackId: php.id }, ctx());

    expect(over).toMatchObject({ ok: true, run: "daily_limit" });
    expect(await captures("laravel")).toHaveLength(0);
    expect(await rerunTerm({ candidateId: id }, over.ok ? over.termId : 0, ctx())).toEqual({
      ok: false,
      code: "request_limit",
    });

    clock.advance(24 * HOUR);
    expect(await rerunTerm({ candidateId: id }, over.ok ? over.termId : 0, ctx())).toMatchObject({ ok: true, run: "started" });
  });
});
