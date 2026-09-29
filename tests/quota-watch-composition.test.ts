import { describe, expect, it, vi } from "vitest";
import { runQuotaWatch, type QuotaWatchDeps, type QuotaWatchRow } from "../src/contexts/operations/app/quota-watch.ts";
import type { QuotaSample } from "../src/contexts/operations/domain/quota-watch.ts";

/**
 * `runQuotaWatch` — a orquestração (coleta → decide → alerta → grava), com
 * fakes no lugar de rede e banco (regra 4). A decisão em si já está provada
 * em `quota-watch-domain.test.ts`; aqui a prova é de composição: quem alerta,
 * o que a linha grava, e que gravar não depende do alerta ter funcionado.
 */

function deps(sample: QuotaSample, opts: { alertOk?: boolean } = {}): {
  deps: QuotaWatchDeps;
  rows: QuotaWatchRow[];
  open: ReturnType<typeof vi.fn>;
} {
  const rows: QuotaWatchRow[] = [];
  const open = vi.fn().mockResolvedValue({ ok: opts.alertOk ?? true });
  return {
    rows,
    open,
    deps: {
      now: () => "2026-09-29T12:00:00.000Z",
      metrics: { sample: async () => sample },
      store: { record: async (row) => { rows.push(row); } },
      alert: { open },
    },
  };
}

describe("runQuotaWatch — composição", () => {
  it("ok: não alerta, e a linha grava decision='ok' sem ação nem reversão", async () => {
    const { deps: d, rows, open } = deps({ vercelDeploys24h: 5, actionsQueueMaxWaitS: 0, actionsStatus: "none" });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      checkedAt: "2026-09-29T12:00:00.000Z",
      decision: "ok",
      actionTaken: null,
      reversalCommand: null,
      note: null,
    });
  });

  it("aviso: tenta alertar e grava a linha com o motivo em note", async () => {
    const { deps: d, rows, open } = deps({ vercelDeploys24h: 80, actionsQueueMaxWaitS: 0, actionsStatus: "none" });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toMatchObject({ title: expect.stringContaining("aviso") });
    expect(rows[0]).toMatchObject({ decision: "aviso", actionTaken: null, reversalCommand: null });
    expect(rows[0]!.note).toMatch(/vercel/i);
  });

  it("ação automática: a linha carrega ação e comando de reversão, e o corpo da issue os inclui", async () => {
    const { deps: d, rows, open } = deps({ vercelDeploys24h: 95, actionsQueueMaxWaitS: 0, actionsStatus: "none" });
    await runQuotaWatch(d);

    expect(rows[0]!.decision).toBe("acao-automatica");
    expect(rows[0]!.actionTaken).toBeTruthy();
    expect(rows[0]!.reversalCommand).toBeTruthy();
    expect(open.mock.calls[0]![0].body).toContain(rows[0]!.reversalCommand);
  });

  it("amostra indisponível: não alerta (não é aviso nem ação), mas grava a linha", async () => {
    const { deps: d, rows, open } = deps({ vercelDeploys24h: null, actionsQueueMaxWaitS: null, actionsStatus: null });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ decision: "amostra-indisponivel" });
    expect(rows[0]!.note).toMatch(/indisponível/);
  });

  it("o alerta falhando (`ok: false`) ainda grava a linha — a métrica não depende da notificação", async () => {
    const { deps: d, rows } = deps({ vercelDeploys24h: 95, actionsQueueMaxWaitS: 0, actionsStatus: "none" }, { alertOk: false });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe("acao-automatica");
  });

  it("segredo nunca aparece na linha gravada, mesmo se vazasse pela ação (redactSecrets)", async () => {
    const { deps: d, rows } = deps({ vercelDeploys24h: 95, actionsQueueMaxWaitS: 0, actionsStatus: "none" });
    await runQuotaWatch(d);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toMatch(/bearer\s+\S+/i);
  });
});
