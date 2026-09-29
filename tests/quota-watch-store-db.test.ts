import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drizzleQuotaWatch, recentQuotaWatch } from "../src/contexts/operations/infra/drizzle-quota-watch.ts";
import type { QuotaWatchRow } from "../src/contexts/operations/ports.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * `drizzleQuotaWatch` contra PostgreSQL de verdade: a linha grava e volta
 * exatamente como foi escrita — inclusive `null` nas métricas que a coleta
 * não conseguiu ler (F3-02), nunca um "0" inventado pelo driver.
 */

beforeEach(async () => {
  await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

const row = (over: Partial<QuotaWatchRow> = {}): QuotaWatchRow => ({
  checkedAt: "2026-09-29T12:00:00.000Z",
  vercelDeploys24h: 10,
  actionsQueueMaxWaitS: 30,
  actionsStatus: "none",
  decision: "ok",
  actionTaken: null,
  reversalCommand: null,
  note: null,
  ...over,
});

describe("drizzleQuotaWatch", () => {
  it("grava e lê de volta, com as métricas nulas preservadas", async () => {
    await drizzleQuotaWatch.record(
      row({ vercelDeploys24h: null, actionsQueueMaxWaitS: null, actionsStatus: null, decision: "amostra-indisponivel", note: "amostra indisponível: vercel, actions" }),
    );
    const [latest] = await recentQuotaWatch(1);
    expect(latest).toMatchObject({
      vercelDeploys24h: null,
      actionsQueueMaxWaitS: null,
      actionsStatus: null,
      decision: "amostra-indisponivel",
    });
  });

  it("grava ação e reversão quando a decisão é acao-automatica", async () => {
    await drizzleQuotaWatch.record(
      row({ decision: "acao-automatica", actionTaken: "recomendar X", reversalCommand: "gh variable set X" }),
    );
    const [latest] = await recentQuotaWatch(1);
    expect(latest).toMatchObject({ decision: "acao-automatica", actionTaken: "recomendar X", reversalCommand: "gh variable set X" });
  });

  it("recentQuotaWatch devolve a mais recente primeiro, respeitando o limite", async () => {
    await drizzleQuotaWatch.record(row({ checkedAt: "2026-09-29T10:00:00.000Z" }));
    await drizzleQuotaWatch.record(row({ checkedAt: "2026-09-29T11:00:00.000Z" }));
    await drizzleQuotaWatch.record(row({ checkedAt: "2026-09-29T12:00:00.000Z" }));
    const rows = await recentQuotaWatch(2);
    expect(rows.map((r) => r.checkedAt)).toEqual(["2026-09-29T12:00:00.000Z", "2026-09-29T11:00:00.000Z"]);
  });
});
