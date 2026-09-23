import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db/client.ts";
import { source, sweepLease, sweepRun } from "../src/core/db/schema.ts";
import { runSweepSlice, type SweepDeps } from "../src/contexts/operations/app/sweep.ts";
import {
  drizzleSweepLease,
  drizzleSweepRuns,
  lastSyncedBySource,
} from "../src/contexts/operations/infra/drizzle-sweep.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * A reserva de verdade, em PostgreSQL: é ela que impede duas chamadas da
 * Vercel — o `pg_cron` não espera a anterior terminar — de sincronizar a mesma
 * fonte ao mesmo tempo.
 */

const T0 = Date.parse("2026-09-23T12:00:00.000Z");
const MIN = 60_000;

beforeEach(async () => {
  await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

describe("reserva por upsert condicional", () => {
  it("oito chamadas disputando a mesma fonte: exatamente uma vence", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => drizzleSweepLease(`w${i}`).claim("sync:greenhouse:acme", { now: T0, notBefore: T0 - 45 * MIN })),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("depois de liberada, não é reservada de novo antes do intervalo — nem por quem leu a lista antes", async () => {
    const a = drizzleSweepLease("a");
    const b = drizzleSweepLease("b");
    expect(await a.claim("sync:x", { now: T0, notBefore: T0 - 45 * MIN })).toBe(true);
    await a.release("sync:x", T0 + 5_000);

    expect(await b.claim("sync:x", { now: T0 + 10_000, notBefore: T0 + 10_000 - 45 * MIN })).toBe(false);
    const later = T0 + 46 * MIN;
    expect(await b.claim("sync:x", { now: later, notBefore: later - 45 * MIN })).toBe(true);
  });

  it("reserva de função morta é retomada; viva, não", async () => {
    const morta = drizzleSweepLease("morta");
    const outra = drizzleSweepLease("outra");
    expect(await morta.claim("pontuar:1", { now: T0, notBefore: T0 })).toBe(true);

    expect(await outra.claim("pontuar:1", { now: T0 + MIN, notBefore: T0 + MIN })).toBe(false);
    expect(await outra.claim("pontuar:1", { now: T0 + 6 * MIN, notBefore: T0 + 6 * MIN })).toBe(true);

    const [row] = await getDb().select().from(sweepLease);
    expect(row).toMatchObject({ claimedBy: "outra", lastFinishedAt: null });
  });

  it("liberar só solta a própria reserva", async () => {
    const dona = drizzleSweepLease("dona");
    expect(await dona.claim("sync:y", { now: T0, notBefore: T0 })).toBe(true);
    await drizzleSweepLease("intrusa").release("sync:y", T0 + 1_000);

    const [row] = await getDb().select().from(sweepLease);
    expect(row).toMatchObject({ claimedBy: "dona", lastFinishedAt: null });
  });

  it("métrica: grava e poda pelo início", async () => {
    await drizzleSweepRuns.record([
      { slice: "sync", unit: null, startedAt: "2026-09-01T00:00:00.000Z", durationMs: 10, items: 1, errors: 0, error: null },
      { slice: "sync", unit: "sync:a", startedAt: "2026-09-23T00:00:00.000Z", durationMs: 10, items: 1, errors: 0, error: null },
    ]);
    await drizzleSweepRuns.prune(Date.parse("2026-09-10T00:00:00.000Z"));
    const rows = await getDb().select({ unit: sweepRun.unit }).from(sweepRun);
    expect(rows).toEqual([{ unit: "sync:a" }]);
  });
});

describe("fatia sync contra o banco", () => {
  it("duas chamadas simultâneas repartem as fontes sem repetir nenhuma", async () => {
    const ids = ["a:1", "b:2", "c:3", "d:4"];
    await getDb()
      .insert(source)
      .values(ids.map((id) => ({ id, kind: id.split(":")[0]!, handle: id.split(":")[1]!, label: id })));

    const synced: string[] = [];
    const deps = (worker: string): SweepDeps => ({
      now: () => T0,
      lease: drizzleSweepLease(worker),
      runs: drizzleSweepRuns,
      sync: {
        sources: async () => ids.map((id) => ({ id })),
        lastSynced: lastSyncedBySource,
        async run(id) {
          synced.push(id);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { ok: true, items: 1 };
        },
      },
      score: { candidates: async () => [], run: async () => ({ ok: true, items: 0 }) },
      terms: async () => ({ items: 0, errors: 0, detail: {} }),
      capture: async () => ({ items: 0, errors: 0, detail: {} }),
      recheck: async () => ({ items: 0, errors: 0, detail: {} }),
      alarm: async () => {},
    });

    await Promise.all([runSweepSlice("sync", deps("w1")), runSweepSlice("sync", deps("w2"))]);

    expect([...synced].sort()).toEqual(ids);
    const perCall = await getDb().select().from(sweepRun);
    expect(perCall.filter((row) => row.unit === null)).toHaveLength(2);
    expect(perCall.filter((row) => row.unit !== null)).toHaveLength(4);
  });
});
