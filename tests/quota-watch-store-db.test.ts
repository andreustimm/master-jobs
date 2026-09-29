import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db/client.ts";
import { drizzleQuotaWatch, recentQuotaWatch } from "../src/contexts/operations/infra/drizzle-quota-watch.ts";
import type { QuotaWatchRow } from "../src/contexts/operations/ports.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * `drizzleQuotaWatch` contra PostgreSQL de verdade: a linha grava e volta
 * exatamente como foi escrita — inclusive `null` nas métricas que a coleta
 * não conseguiu ler (F3-02), nunca um "0" inventado pelo driver. `recent()`
 * é o que M1 (dedupe) e M4 (streak) leem antes de decidir.
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
  trigger: null,
  actionRecommended: null,
  reversalCommand: null,
  note: null,
  issueNumber: null,
  ...over,
});

describe("drizzleQuotaWatch", () => {
  it("grava e lê de volta, com as métricas nulas preservadas", async () => {
    await drizzleQuotaWatch.record(
      row({
        vercelDeploys24h: null,
        actionsQueueMaxWaitS: null,
        actionsStatus: null,
        decision: "amostra-indisponivel",
        note: "amostra indisponível: vercel, actions",
      }),
    );
    const [latest] = await recentQuotaWatch(1);
    expect(latest).toMatchObject({
      vercelDeploys24h: null,
      actionsQueueMaxWaitS: null,
      actionsStatus: null,
      decision: "amostra-indisponivel",
      trigger: null,
      issueNumber: null,
    });
  });

  it("grava recomendação, gatilho, reversão e issue quando a decisão é acao-recomendada", async () => {
    await drizzleQuotaWatch.record(
      row({ decision: "acao-recomendada", trigger: "vercel", actionRecommended: "recomendar X", reversalCommand: "gh workflow enable X", issueNumber: 42 }),
    );
    const [latest] = await recentQuotaWatch(1);
    expect(latest).toMatchObject({
      decision: "acao-recomendada",
      trigger: "vercel",
      actionRecommended: "recomendar X",
      reversalCommand: "gh workflow enable X",
      issueNumber: 42,
    });
  });

  it("recentQuotaWatch devolve a mais recente primeiro, respeitando o limite", async () => {
    await drizzleQuotaWatch.record(row({ checkedAt: "2026-09-29T10:00:00.000Z" }));
    await drizzleQuotaWatch.record(row({ checkedAt: "2026-09-29T11:00:00.000Z" }));
    await drizzleQuotaWatch.record(row({ checkedAt: "2026-09-29T12:00:00.000Z" }));
    const rows = await recentQuotaWatch(2);
    expect(rows.map((r) => r.checkedAt)).toEqual(["2026-09-29T12:00:00.000Z", "2026-09-29T11:00:00.000Z"]);
  });

  it("store.recent() devolve só decision/trigger/issueNumber, mais recente primeiro (M1/M4)", async () => {
    await drizzleQuotaWatch.record(row({ decision: "ok" }));
    await drizzleQuotaWatch.record(row({ decision: "aviso", trigger: "actions", issueNumber: 5 }));
    const history = await drizzleQuotaWatch.recent(2);
    expect(history).toEqual([
      { decision: "aviso", trigger: "actions", issueNumber: 5 },
      { decision: "ok", trigger: null, issueNumber: null },
    ]);
  });

  it("store.recent() ordena por id, não por checked_at — imune a duas linhas no mesmo instante", async () => {
    // As três linhas têm o MESMO checked_at de propósito: só a ordem de
    // inserção (id) pode dizer qual é "a anterior" de verdade.
    await drizzleQuotaWatch.record(row({ decision: "ok" }));
    await drizzleQuotaWatch.record(row({ decision: "aviso", trigger: "vercel" }));
    await drizzleQuotaWatch.record(row({ decision: "acao-recomendada", trigger: "vercel" }));
    const history = await drizzleQuotaWatch.recent(3);
    expect(history.map((h) => h.decision)).toEqual(["acao-recomendada", "aviso", "ok"]);
  });

  it("trigger com valor inesperado no banco vira null, nunca um QuotaTrigger inventado", async () => {
    // Escrita fora do caminho tipado, para simular um valor que a TypeScript
    // nunca deixaria `record()` gravar (migração antiga, escrita manual).
    await getDb().execute(sql`insert into production.quota_watch (checked_at, decision, trigger) values ('2026-09-29T13:00:00.000Z', 'ok', 'algo-inesperado')`);
    const [history] = await drizzleQuotaWatch.recent(1);
    expect(history!.trigger).toBeNull();
  });
});
