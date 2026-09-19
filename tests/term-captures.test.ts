import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureHealthReport,
  requestCaptures,
  runCaptures,
  type CaptureDeps,
} from "../src/contexts/sourcing/app/captures.ts";
import { captureHealth, platformQuota as quota } from "../src/contexts/sourcing/index.ts";
import {
  captureRecords,
  drizzleCaptureQueue,
  ensureTermSource,
  recordAttribution,
} from "../src/contexts/sourcing/infra/drizzle-captures.ts";
import { quotaUsage } from "../src/contexts/sourcing/infra/drizzle-quota.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidate, job, source, termAttribution, termCapture } from "../src/core/db/schema.ts";
import { observeRawJob } from "../src/core/ingest/observe.ts";
import { syncAll } from "../src/core/ingest/run.ts";
import { himalayas, remoteok, remotive } from "../src/core/sources/aggregators.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import { ADAPTERS } from "../src/core/sources/registry.ts";
import type { RawJob, SourceAdapter, SourceConfig, TermSearch } from "../src/core/sources/types.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const TODAY = "2026-09-19";
const NOW = new Date(`${TODAY}T10:00:00.000Z`);
const REMOTIVE_CONFIG: SourceConfig = { kind: "remotive", handle: "architect", label: "Remotive" };
const REMOTEOK_CONFIG: SourceConfig = { kind: "remoteok", handle: "", label: "RemoteOK" };
const HIMALAYAS_CONFIG: SourceConfig = { kind: "himalayas", handle: "", label: "Himalayas" };

type RemotiveBody = { jobs: Array<Record<string, unknown>>; [key: string]: unknown };

function fixture<T = object>(name: string): T {
  return JSON.parse(readFileSync(`tests/fixtures/term-search/${name}`, "utf8")) as T;
}

/** A plataforma com a busca validada, como ficaria depois do probe. */
function validated(adapter: SourceAdapter, termSearch: Partial<TermSearch> = {}): SourceAdapter {
  return { ...adapter, termSearch: { ...adapter.termSearch!, validatedOn: TODAY, ...termSearch } };
}

/** Busca por termo sem limite de cota, para testes sobre a fila. */
function unbudgeted(adapter: SourceAdapter, search?: TermSearch["search"]): SourceAdapter {
  return validated(adapter, {
    budget: { pageSize: 100, maxRequestsPerRun: 1 },
    ...(search ? { search } : {}),
  });
}

function rawSearch(jobs: RawJob[]): TermSearch["search"] {
  return async () => ({ jobs, warnings: [], totalHint: jobs.length, stoppedByQuota: false });
}

function deps(overrides: Partial<CaptureDeps> = {}): CaptureDeps {
  return {
    queue: drizzleCaptureQueue,
    quota,
    adapters: [remotive],
    sources: async () => [REMOTIVE_CONFIG],
    termSource: ensureTermSource,
    attribute: recordAttribution,
    ...overrides,
  };
}

function request(termKey: string, query = termKey, extra: Partial<CaptureDeps> = {}) {
  return requestCaptures({ termKey, query, origin: "web", now: NOW }, deps(extra));
}

let db: DB;
let clock: ReturnType<typeof fixedClock>;
const env = { ...process.env };

beforeEach(async () => {
  db = await useTestDb();
  clock = fixedClock(NOW.toISOString());
  setClock(clock);
});

afterEach(async () => {
  process.env = { ...env };
  resetClock();
  resetHttpPort();
  await releaseTestDb();
});

async function captures() {
  return db.select().from(termCapture).orderBy(termCapture.id);
}

async function remotiveRaws(): Promise<RawJob[]> {
  setHttpPort(fixtureHttp({ "remotive.com": fixture("remotive-laravel.json") }));
  const result = await remotive.termSearch!.search("Laravel", { limit: 100, reserve: async () => true });
  resetHttpPort();
  return result.jobs;
}

async function addSource(id: string, enabled = true) {
  const [kind, handle] = id.split(":") as [string, string];
  await db.insert(source).values({ id, kind, handle, label: id, enabled }).onConflictDoNothing();
}

describe("term capture ingestion (ADR-011)", () => {
  it("IT-042 a capture refreshes a job another source owns without taking it", async () => {
    await addSource("greenhouse:stackblitz");
    const [raw] = await remotiveRaws();
    const first = await observeRawJob(
      { ...raw!, externalId: "gh-1", url: "https://boards.greenhouse.io/stackblitz/1", applyUrl: "https://apply.test/1" },
      "greenhouse:stackblitz",
      { observedAt: "2026-09-01T00:00:00.000Z" },
    );
    await ensureTermSource("remotive");

    await observeRawJob(raw!, "remotive:~terms", { keepExistingSource: true, observedAt: "2026-09-19T10:00:00.000Z" });

    const [row] = await db.select().from(job).where(eq(job.id, first.jobId));
    expect(row).toMatchObject({
      sourceId: "greenhouse:stackblitz",
      externalId: "gh-1",
      url: "https://boards.greenhouse.io/stackblitz/1",
      applyUrl: "https://apply.test/1",
      lastSeenAt: "2026-09-19T10:00:00.000Z",
    });
  });

  it("IT-043 a job first seen by a capture belongs to the disabled ~terms source", async () => {
    setHttpPort(fixtureHttp({ "remotive.com": fixture("remotive-laravel.json") }));
    await request("laravel", "Laravel");

    await runCaptures({ worker: "test" }, deps());

    const jobs = await db.select({ sourceId: job.sourceId }).from(job);
    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map((row) => row.sourceId))).toEqual(new Set(["remotive:~terms"]));
    const [termSource] = await db.select().from(source).where(eq(source.id, "remotive:~terms"));
    expect(termSource).toMatchObject({ enabled: false, handle: "~terms", label: "Remotive — termos" });
  });

  it("IT-044 both a capture and the sync reopen a closed and archived job", async () => {
    await addSource("remotive:architect");
    const [raw] = await remotiveRaws();
    const seen = await observeRawJob(raw!, "remotive:architect");
    const bury = () =>
      db.update(job).set({ closedAt: "2026-08-01T00:00:00.000Z", archivedAt: "2026-09-01T00:00:00.000Z" }).where(eq(job.id, seen.jobId));

    await bury();
    await ensureTermSource("remotive");
    const reopened = await observeRawJob(raw!, "remotive:~terms", { keepExistingSource: true });
    expect(reopened.outcome).toBe("reopened");
    expect(await db.select({ c: job.closedAt, a: job.archivedAt }).from(job)).toEqual([{ c: null, a: null }]);

    await bury();
    setHttpPort(fixtureHttp({ "remotive.com": fixture("remotive-laravel.json") }));
    await syncAll([REMOTIVE_CONFIG]);
    const [row] = await db.select({ c: job.closedAt, a: job.archivedAt }).from(job).where(eq(job.id, seen.jobId));
    expect(row).toEqual({ c: null, a: null });
  });

  it("IT-045 the sync never closes a job only a capture brought", async () => {
    await ensureTermSource("remotive");
    const [termJob] = await remotiveRaws();
    const captured = await observeRawJob(termJob!, "remotive:~terms");
    const other = fixture<RemotiveBody>("remotive-laravel.json");
    setHttpPort(fixtureHttp({ "remotive.com": { ...other, jobs: other.jobs.slice(2) } }));

    const result = await syncAll([REMOTIVE_CONFIG]);

    expect(result.sources[0]!.ok).toBe(true);
    const [row] = await db.select({ closedAt: job.closedAt }).from(job).where(eq(job.id, captured.jobId));
    expect(row!.closedAt).toBeNull();
  });

  it("IT-046 a capture and the sync on the same posting keep one job row", async () => {
    setHttpPort(fixtureHttp({ "remotive.com": fixture("remotive-laravel.json") }));
    await request("laravel", "Laravel");

    await Promise.all([runCaptures({ worker: "test" }, deps()), syncAll([REMOTIVE_CONFIG])]);

    const rows = await db.select({ fingerprint: job.fingerprint }).from(job);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.fingerprint)).size).toBe(3);
  });

  it("IT-047 the same posting in two locations is two jobs, both attributed", async () => {
    const body = fixture<RemotiveBody>("remotive-laravel.json");
    const posting = body.jobs[0]!;
    const twice = [
      { ...posting, id: 1, candidate_required_location: "Brazil" },
      { ...posting, id: 2, candidate_required_location: "Mexico" },
    ];
    setHttpPort(fixtureHttp({ "remotive.com": { ...body, jobs: twice } }));
    await request("laravel", "Laravel");

    await runCaptures({ worker: "test" }, deps());

    expect(await db.select().from(job)).toHaveLength(2);
    expect(await db.select().from(termAttribution)).toHaveLength(2);
  });
});

describe("capture requests", () => {
  const both = { adapters: [remotive, validated(remoteok)], sources: async () => [REMOTIVE_CONFIG, REMOTEOK_CONFIG] };

  it("IT-056 one row per platform per day, however often it is asked", async () => {
    expect(await request("laravel", "Laravel", both)).toEqual({ enqueued: 2, existing: 0, skipped: null });
    expect(await request("laravel", "laravel", both)).toEqual({ enqueued: 0, existing: 2, skipped: null });
    expect(await captures()).toHaveLength(2);
  });

  it("IT-057 where ingestion is not allowed nothing is enqueued", async () => {
    process.env.JHO_ENV = "preview";

    expect(await request("laravel", "Laravel", both)).toEqual({ enqueued: 0, existing: 0, skipped: "ingestion_blocked" });
    expect(await captures()).toHaveLength(0);
  });

  it("IT-070 a platform switched off after the term was saved is skipped", async () => {
    await request("laravel", "Laravel");
    const off = { sources: async () => [] as SourceConfig[] };

    expect(await request("php", "PHP", off)).toMatchObject({ enqueued: 0, skipped: "no_platform" });
    const [queued, skipped] = await captures();
    expect(skipped).toMatchObject({ termKey: "php", status: "skipped", reasonCode: "platform_disabled" });

    await runCaptures({ worker: "test" }, deps(off));
    expect((await db.select().from(termCapture).where(eq(termCapture.id, queued!.id)))[0]).toMatchObject({
      status: "skipped",
      reasonCode: "platform_disabled",
    });
  });

  it("IT-072 an unvalidated platform never gets a capture row", async () => {
    const unvalidated = { ...himalayas, termSearch: { ...himalayas.termSearch!, validatedOn: null } };
    const adapters = [...Object.values(ADAPTERS).filter((adapter) => adapter.kind !== "himalayas"), unvalidated];
    const all = { adapters, sources: async () => [REMOTIVE_CONFIG, REMOTEOK_CONFIG, HIMALAYAS_CONFIG] };

    await request("laravel", "Laravel", all);

    expect((await captures()).map((row) => row.platform).sort()).toEqual(["remoteok", "remotive"]);
  });
});

describe("capture runner", () => {
  it("IT-058 a capture observes everything and attributes what cites the term", async () => {
    setHttpPort(fixtureHttp({ "remotive.com": fixture("remotive-laravel.json") }));
    await request("laravel", "Laravel");

    const summary = await runCaptures({ worker: "test" }, deps());

    expect(summary.remotive).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0, created: 3, known: 0 });
    expect((await captures())[0]).toMatchObject({ status: "succeeded", fetched: 3, created: 3, known: 0, attributed: 2 });
    expect(await db.select().from(termAttribution)).toHaveLength(2);
  });

  it("IT-059 a 429 on one platform waits for tomorrow; the other still runs", async () => {
    setHttpPort(
      fixtureHttp({
        "remotive.com": { status: 429 },
        "remoteok.com": fixture("remoteok-tech-lead.json"),
      }),
    );
    const both = { adapters: [remotive, validated(remoteok)], sources: async () => [REMOTIVE_CONFIG, REMOTEOK_CONFIG] };
    await request("techlead", "Tech Lead", both);

    await runCaptures({ worker: "test" }, deps(both));

    const byPlatform = Object.fromEntries((await captures()).map((row) => [row.platform, row]));
    expect(byPlatform.remotive).toMatchObject({ status: "waiting_quota", runAfter: "2026-09-20T00:00:00.000Z" });
    expect(byPlatform.remoteok).toMatchObject({ status: "succeeded" });
    expect(await quotaUsage("remotive", NOW)).toMatchObject({ exhausted: true });
  });

  it("IT-061 a gone search endpoint fails for good and turns the platform red", async () => {
    setHttpPort(fixtureHttp({ "himalayas.app": { status: 404 } }));
    const only = { adapters: [validated(himalayas)], sources: async () => [HIMALAYAS_CONFIG] };
    await request("laravel", "Laravel", only);

    await runCaptures({ worker: "test" }, deps(only));

    expect((await captures())[0]).toMatchObject({ status: "failed", reasonCode: "endpoint_gone" });
    const [health] = await captureHealthReport(NOW, { ...only, records: captureRecords, usage: quotaUsage });
    expect(health).toMatchObject({ platform: "himalayas", red: true, lastErrorCode: "endpoint_gone" });
  });

  it("IT-062 a big answer keeps the 100 newest and the total", async () => {
    const body = fixture<RemotiveBody>("remotive-laravel.json");
    const base = body.jobs[1]!;
    const many = Array.from({ length: 130 }, (_, n) => ({
      ...base,
      id: 10_000 + n,
      title: `Engineer ${n}`,
      publication_date: new Date(Date.UTC(2026, 6, 1) + n * 3_600_000).toISOString().slice(0, 19),
    }));
    setHttpPort(fixtureHttp({ "remotive.com": { ...body, "total-job-count": 130, jobs: many } }));
    await request("laravel", "Laravel");

    await runCaptures({ worker: "test" }, deps());

    expect((await captures())[0]).toMatchObject({ status: "succeeded", fetched: 130, created: 100, totalHint: 130 });
    const titles = (await db.select({ title: job.title }).from(job)).map((row) => row.title);
    expect(titles).toContain("Engineer 129");
    expect(titles).not.toContain("Engineer 29");
  });

  it("IT-063 an empty answer succeeds with every count at zero", async () => {
    setHttpPort(fixtureHttp({ "remotive.com": { jobs: [], "total-job-count": 0 } }));
    await request("cobol", "COBOL");

    await runCaptures({ worker: "test" }, deps());

    expect((await captures())[0]).toMatchObject({
      status: "succeeded", fetched: 0, created: 0, known: 0, attributed: 0, totalHint: 0,
    });
  });

  it("IT-064 an expired lease is reclaimed; a finished capture never runs again", async () => {
    const port = fixtureHttp({ "remotive.com": fixture("remotive-laravel.json") });
    setHttpPort(port);
    const six = new Date(NOW.getTime() - 6 * 60_000).toISOString();
    await db.insert(termCapture).values([
      { platform: "remotive", termKey: "laravel", query: "Laravel", windowDay: TODAY, origin: "web", status: "running", claimedAt: six, claimedBy: "dead" },
      { platform: "remotive", termKey: "php", query: "PHP", windowDay: TODAY, origin: "web", status: "succeeded" },
    ]);

    await runCaptures({ worker: "test" }, deps());

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]).toContain("search=Laravel");
    expect((await captures()).map((row) => row.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("IT-065 two concurrent drains process each capture exactly once", async () => {
    const port = fixtureHttp({ "remotive.com": { jobs: [] } });
    setHttpPort(port);
    const open = { adapters: [unbudgeted(remotive)] };
    for (const key of ["a1", "b2", "c3", "d4", "e5", "f6"]) await request(key, key, open);

    await Promise.all([runCaptures({ worker: "w1" }, deps(open)), runCaptures({ worker: "w2" }, deps(open))]);

    expect(port.calls).toHaveLength(6);
    expect((await captures()).every((row) => row.status === "succeeded" && row.attempts === 1)).toBe(true);
  });

  it("IT-066 the drain stops before a capture that would not fit the budget", async () => {
    const slow = unbudgeted(remotive, async () => {
      clock.advance(21_000);
      return { jobs: [], warnings: [], totalHint: 0, stoppedByQuota: false };
    });
    for (const key of ["a1", "b2", "c3"]) await request(key, key, { adapters: [slow] });

    await runCaptures({ worker: "web", budgetMs: 25_000 }, deps({ adapters: [slow] }));

    expect((await captures()).map((row) => row.status)).toEqual(["succeeded", "queued", "queued"]);
  });

  it("IT-067 jobs of the regular source missing from a capture stay open", async () => {
    await addSource("remotive:architect");
    const raws = await remotiveRaws();
    const regular = await observeRawJob({ ...raws[0]!, title: "Staff Platform Engineer" }, "remotive:architect");
    setHttpPort(fixtureHttp({ "remotive.com": fixture("remotive-laravel.json") }));
    await request("laravel", "Laravel");

    await runCaptures({ worker: "test" }, deps());

    const [row] = await db.select().from(job).where(eq(job.id, regular.jobId));
    expect(row).toMatchObject({ sourceId: "remotive:architect", closedAt: null, archivedAt: null });
  });

  it("IT-068 a known job keeps its source and is attributed", async () => {
    await addSource("remotive:architect");
    const [raw] = await remotiveRaws();
    const known = await observeRawJob(raw!, "remotive:architect");
    setHttpPort(fixtureHttp({ "remotive.com": fixture("remotive-laravel.json") }));
    await request("laravel", "Laravel");

    await runCaptures({ worker: "test" }, deps());

    expect((await db.select().from(job).where(eq(job.id, known.jobId)))[0]!.sourceId).toBe("remotive:architect");
    expect(await db.select().from(termAttribution).where(eq(termAttribution.jobId, known.jobId))).toHaveLength(1);
    expect((await captures())[0]).toMatchObject({ created: 2, known: 1 });
  });

  it("IT-069 without a description, tags decide the attribution", async () => {
    const bare = (id: string, tags: string[] | null): RawJob => ({
      externalId: id,
      companyName: "Acme",
      title: `Backend Engineer ${id}`,
      url: `https://acme.test/${id}`,
      descriptionText: null,
      tags,
      raw: {},
    });
    const tagged = unbudgeted(remotive, rawSearch([bare("1", ["laravel", "php"]), bare("2", null)]));
    await request("laravel", "Laravel", { adapters: [tagged] });

    await runCaptures({ worker: "test" }, deps({ adapters: [tagged] }));

    expect(await db.select().from(job)).toHaveLength(2);
    const attributed = await db.select({ title: job.title }).from(termAttribution).innerJoin(job, eq(job.id, termAttribution.jobId));
    expect(attributed).toEqual([{ title: "Backend Engineer 1" }]);
  });
});

describe("aggregate health", () => {
  it("IT-124 names no term, query or candidate", async () => {
    const [person] = await db.insert(candidate).values({ slug: "owner", name: "Owner", isDefault: true }).returning();
    setHttpPort(fixtureHttp({ "remotive.com": fixture("remotive-laravel.json") }));
    await request("laravel", "Laravel");
    await runCaptures({ worker: "test" }, deps());

    const health = await captureHealth(NOW);

    const keys: string[] = [];
    const values: string[] = [];
    const walk = (value: unknown): void => {
      if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          keys.push(key);
          walk(inner);
        }
      } else values.push(String(value));
    };
    walk(health);
    expect(health.find((entry) => entry.platform === "remotive")).toMatchObject({ activeTerms: 1 });
    expect(keys.filter((key) => /^(term|termKey|term_key|query|candidate|candidateId|candidate_id)$/i.test(key))).toEqual([]);
    expect(values.filter((value) => /laravel/i.test(value))).toEqual([]);
    expect(JSON.stringify(health)).not.toContain(`"${person!.slug}"`);
  });
});
