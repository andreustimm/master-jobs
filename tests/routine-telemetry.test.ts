/**
 * Telemetria diária por rotina (#291): a consulta que mede o baseline.
 *
 * O que se afirma é a agregação — chamadas separadas de unidades, erros e
 * durações só das chamadas — e a janela de dias. Só números saem daqui.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { requestBudget, sweepRun } from "../src/core/db/schema.ts";
import { routineTelemetry } from "../src/contexts/operations/index.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
beforeEach(async () => {
  db = await useTestDb();
});
afterEach(async () => {
  await releaseTestDb();
});

const now = Date.parse("2026-09-23T12:00:00.000Z");

describe("routineTelemetry", () => {
  it("agrega requisições por rotina e chamadas por fatia, dentro da janela", async () => {
    await db.insert(requestBudget).values([
      { routine: "reconferencia", day: "2026-09-23", used: 40, refused: 2 },
      { routine: "sync", day: "2026-09-22", used: 90, refused: 0 },
      { routine: "sync", day: "2026-09-01", used: 99, refused: 0 },
    ]);
    await db.insert(sweepRun).values([
      { slice: "sync", unit: null, startedAt: "2026-09-23T10:00:00.000Z", durationMs: 1_000, items: 2, errors: 0 },
      { slice: "sync", unit: "sync:greenhouse:acme", startedAt: "2026-09-23T10:00:00.000Z", durationMs: 600, items: 30, errors: 0 },
      { slice: "sync", unit: "sync:lever:acme", startedAt: "2026-09-23T10:00:00.000Z", durationMs: 400, items: 0, errors: 1 },
      { slice: "sync", unit: null, startedAt: "2026-09-23T10:02:00.000Z", durationMs: 3_000, items: 1, errors: 1 },
      { slice: "sync", unit: null, startedAt: "2026-09-10T10:00:00.000Z", durationMs: 9_000, items: 9, errors: 9 },
    ]);

    const telemetry = await routineTelemetry({ days: 7, now });

    expect(telemetry.since).toBe("2026-09-16");
    expect(telemetry.requests).toEqual([
      { day: "2026-09-22", routine: "sync", used: 90, refused: 0 },
      { day: "2026-09-23", routine: "reconferencia", used: 40, refused: 2 },
    ]);
    expect(telemetry.sweep).toEqual([
      { day: "2026-09-23", slice: "sync", calls: 2, units: 2, items: 3, errors: 1, totalMs: 4_000, p95Ms: 3_000, maxMs: 3_000 },
    ]);
  });
});
