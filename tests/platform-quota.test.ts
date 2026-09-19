import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCaptures, type CaptureDeps } from "../src/contexts/sourcing/app/captures.ts";
import { platformQuota as quota } from "../src/contexts/sourcing/index.ts";
import {
  drizzleCaptureQueue,
  ensureTermSource,
  recordAttribution,
} from "../src/contexts/sourcing/infra/drizzle-captures.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { platformQuota, source, termCapture } from "../src/core/db/schema.ts";
import { syncAll } from "../src/core/ingest/run.ts";
import { remoteok, remotive } from "../src/core/sources/aggregators.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import type { PlatformBudget } from "../src/core/sources/types.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const REMOTIVE: PlatformBudget = remotive.termSearch!.budget;
const REMOTEOK: PlatformBudget = remoteok.termSearch!.budget;
const REMOTIVE_CONFIG = { kind: "remotive" as const, handle: "architect", label: "Remotive" };

let db: DB;
let clock: ReturnType<typeof fixedClock>;

beforeEach(async () => {
  db = await useTestDb();
  clock = fixedClock("2026-09-19T10:00:00.000Z");
  setClock(clock);
});

afterEach(async () => {
  resetClock();
  resetHttpPort();
  await releaseTestDb();
});

const at = (iso: string) => new Date(iso);

async function used(platform: string, kind: string, start: string): Promise<number | undefined> {
  const [row] = await db
    .select({ used: platformQuota.used })
    .from(platformQuota)
    .where(and(eq(platformQuota.platform, platform), eq(platformQuota.windowKind, kind), eq(platformQuota.windowStart, start)));
  return row?.used;
}

function remotiveFixture(): object {
  return JSON.parse(readFileSync("tests/fixtures/term-search/remotive-laravel.json", "utf8")) as object;
}

describe("platform quota ledger", () => {
  it("IT-048 the fifth call of a four-call day waits for UTC midnight", async () => {
    const times = [
      "2026-09-19T10:00:00Z",
      "2026-09-19T10:00:30Z",
      "2026-09-19T10:01:00Z",
      "2026-09-19T10:01:10Z",
      "2026-09-19T10:02:00Z",
    ];
    const results = [];
    for (const time of times) results.push(await quota.reserve("remotive", REMOTIVE, at(time)));

    expect(results.slice(0, 4).every((r) => r.ok)).toBe(true);
    expect(results[4]).toEqual({ ok: false, retryAt: "2026-09-20T00:00:00.000Z" });
  });

  it("IT-049 a full minute refuses and gives the day unit back", async () => {
    const minute = [0, 10, 20].map((s) => at(`2026-09-19T10:00:${String(s).padStart(2, "0")}Z`));
    const results = [];
    for (const time of minute) results.push(await quota.reserve("remotive", REMOTIVE, time));

    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(results[2]).toEqual({ ok: false, retryAt: "2026-09-19T10:01:00.000Z" });
    expect(await used("remotive", "day", "2026-09-19")).toBe(2);
  });

  it("IT-050 ten concurrent reservations never pass the day budget", async () => {
    const budget: PlatformBudget = { perDay: 4, pageSize: 100, maxRequestsPerRun: 1 };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => quota.reserve("remotive", budget, at("2026-09-19T10:00:00Z"))),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(await used("remotive", "day", "2026-09-19")).toBe(4);
  });

  it("IT-051 the sync makes no call with the day window full and records quota", async () => {
    await db.insert(platformQuota).values({ platform: "remotive", windowKind: "day", windowStart: "2026-09-19", used: 4 });
    const port = fixtureHttp({ "remotive.com": remotiveFixture() });
    setHttpPort(port);

    const result = await syncAll([REMOTIVE_CONFIG]);

    expect(port.calls).toEqual([]);
    expect(result.sources[0]).toMatchObject({ ok: false, error: "quota" });
    const [row] = await db.select().from(source).where(eq(source.id, "remotive:architect"));
    expect(row).toMatchObject({ lastStatus: "error", lastError: "quota" });
  });

  it("IT-052 a 429 closes the platform's day", async () => {
    setHttpPort(fixtureHttp({ "remotive.com": { status: 429 } }));

    await syncAll([REMOTIVE_CONFIG]);

    expect(await quota.reserve("remotive", REMOTIVE, at("2026-09-19T15:00:00Z"))).toEqual({
      ok: false,
      retryAt: "2026-09-20T00:00:00.000Z",
    });
    await quota.exhaustDay("remoteok", at("2026-09-19T15:00:00Z"));
    expect((await quota.reserve("remoteok", REMOTEOK, at("2026-09-19T15:30:00Z"))).ok).toBe(false);
    expect((await quota.reserve("remotive", REMOTIVE, at("2026-09-20T00:00:01Z"))).ok).toBe(true);
  });

  it("IT-053 reservations either side of midnight land on different days", async () => {
    await quota.reserve("remotive", REMOTIVE, at("2026-09-19T23:59:59Z"));
    await quota.reserve("remotive", REMOTIVE, at("2026-09-20T00:00:00Z"));

    expect(await used("remotive", "day", "2026-09-19")).toBe(1);
    expect(await used("remotive", "day", "2026-09-20")).toBe(1);
  });

  it("IT-054 RemoteOK allows one call a minute", async () => {
    expect((await quota.reserve("remoteok", REMOTEOK, at("2026-09-19T10:00:00Z"))).ok).toBe(true);
    expect(await quota.reserve("remoteok", REMOTEOK, at("2026-09-19T10:00:40Z"))).toEqual({
      ok: false,
      retryAt: "2026-09-19T10:01:00.000Z",
    });
  });

  it("IT-055 term captures share the day with the sync", async () => {
    await db.insert(platformQuota).values({ platform: "remotive", windowKind: "day", windowStart: "2026-09-19", used: 2 });
    setHttpPort(fixtureHttp({ "remotive.com": remotiveFixture() }));
    await drizzleCaptureQueue.enqueue(
      ["laravel", "php", "symfony", "react", "java"].map((termKey) => ({
        platform: "remotive" as const,
        termKey,
        query: termKey,
        windowDay: "2026-09-19",
        origin: "sweep" as const,
        priority: 0,
      })),
    );
    const deps: CaptureDeps = {
      queue: drizzleCaptureQueue,
      quota,
      adapters: [remotive],
      sources: async () => [REMOTIVE_CONFIG],
      termSource: ensureTermSource,
      attribute: recordAttribution,
    };

    await runCaptures({ worker: "test" }, deps);

    const rows = await db.select().from(termCapture);
    expect(rows.filter((row) => row.status === "succeeded")).toHaveLength(2);
    const waiting = rows.filter((row) => row.status === "waiting_quota");
    expect(waiting).toHaveLength(3);
    expect(waiting.every((row) => row.runAfter === "2026-09-20T00:00:00.000Z")).toBe(true);
  });
});
