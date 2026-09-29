import { describe, expect, it, vi } from "vitest";
import { runQuotaWatch, type QuotaWatchDeps, type QuotaWatchHistoryEntry, type QuotaWatchRow } from "../src/contexts/operations/app/quota-watch.ts";
import type { QuotaSample } from "../src/contexts/operations/domain/quota-watch.ts";

/**
 * `runQuotaWatch` — a orquestração (coleta → decide → alerta com dedupe →
 * grava), com fakes no lugar de rede e banco (regra 4). A decisão em si já
 * está provada em `quota-watch-domain.test.ts`; aqui a prova é de
 * composição: quem alerta, se abre ou comenta (M1), a persistência
 * (M4/M6), e que gravar não depende do alerta ter funcionado.
 */

function deps(
  sample: QuotaSample,
  opts: { alertOk?: boolean; history?: QuotaWatchHistoryEntry[]; openNumber?: number } = {},
): {
  deps: QuotaWatchDeps;
  rows: QuotaWatchRow[];
  open: ReturnType<typeof vi.fn>;
  comment: ReturnType<typeof vi.fn>;
} {
  const rows: QuotaWatchRow[] = [];
  const history = opts.history ?? [];
  const open = vi.fn().mockResolvedValue({ ok: opts.alertOk ?? true, number: opts.openNumber ?? 123 });
  const comment = vi.fn().mockResolvedValue({ ok: opts.alertOk ?? true });
  return {
    rows,
    open,
    comment,
    deps: {
      now: () => "2026-09-29T12:00:00.000Z",
      metrics: { sample: async () => sample },
      store: {
        record: async (row) => { rows.push(row); },
        recent: async () => history,
      },
      alert: { open, comment },
    },
  };
}

describe("runQuotaWatch — composição", () => {
  it("ok: não alerta, e a linha grava decision='ok' sem recomendação nem reversão nem issue", async () => {
    const { deps: d, rows, open } = deps({ vercelDeploys24h: 5, actionsQueueMaxWaitS: 0, actionsStatus: "none" });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(false);
    expect(report.issueNumber).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      checkedAt: "2026-09-29T12:00:00.000Z",
      decision: "ok",
      trigger: null,
      actionRecommended: null,
      reversalCommand: null,
      note: null,
      issueNumber: null,
    });
  });

  it("aviso, sem histórico: abre issue e grava a linha com o motivo em note", async () => {
    const { deps: d, rows, open, comment } = deps({ vercelDeploys24h: 80, actionsQueueMaxWaitS: 0, actionsStatus: "none" });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(true);
    expect(report.issueNumber).toBe(123);
    expect(open).toHaveBeenCalledTimes(1);
    expect(comment).not.toHaveBeenCalled();
    expect(open.mock.calls[0]![0]).toMatchObject({ title: expect.stringContaining("aviso") });
    expect(rows[0]).toMatchObject({ decision: "aviso", trigger: "vercel", actionRecommended: null, reversalCommand: null, issueNumber: 123 });
    expect(rows[0]!.note).toMatch(/vercel/i);
  });

  it("M1 — mesmo estado e gatilho da checagem anterior: comenta na issue existente, não abre outra", async () => {
    const history: QuotaWatchHistoryEntry[] = [{ decision: "aviso", trigger: "vercel", issueNumber: 42 }];
    const { deps: d, rows, open, comment } = deps({ vercelDeploys24h: 80, actionsQueueMaxWaitS: 0, actionsStatus: "none" }, { history });
    const report = await runQuotaWatch(d);

    expect(open).not.toHaveBeenCalled();
    expect(comment).toHaveBeenCalledTimes(1);
    expect(comment.mock.calls[0]![0]).toMatchObject({ issueNumber: 42 });
    expect(report.issueNumber).toBe(42);
    expect(rows[0]!.issueNumber).toBe(42);
  });

  it("M1 — gatilho diferente do anterior: abre uma issue nova, mesmo havendo uma aberta", async () => {
    const history: QuotaWatchHistoryEntry[] = [{ decision: "aviso", trigger: "actions", issueNumber: 42 }];
    const { deps: d, open, comment } = deps({ vercelDeploys24h: 80, actionsQueueMaxWaitS: 0, actionsStatus: "none" }, { history, openNumber: 77 });
    const report = await runQuotaWatch(d);

    expect(comment).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(report.issueNumber).toBe(77);
  });

  it("ação recomendada: a linha carrega a recomendação e o comando de reversão, e o corpo da issue os inclui", async () => {
    const { deps: d, rows, open } = deps({ vercelDeploys24h: 95, actionsQueueMaxWaitS: 0, actionsStatus: "none" });
    await runQuotaWatch(d);

    expect(rows[0]!.decision).toBe("acao-recomendada");
    expect(rows[0]!.actionRecommended).toBeTruthy();
    expect(rows[0]!.reversalCommand).toBeTruthy();
    expect(open.mock.calls[0]![0].body).toContain(rows[0]!.reversalCommand);
    expect(open.mock.calls[0]![0].body).toContain("nunca aplicada sozinha");
  });

  it("amostra indisponível isolada (sem histórico de streak): não alerta, mas grava a linha", async () => {
    const { deps: d, rows, open } = deps({ vercelDeploys24h: null, actionsQueueMaxWaitS: null, actionsStatus: null });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ decision: "amostra-indisponivel", trigger: null, issueNumber: null });
    expect(rows[0]!.note).toMatch(/indisponível/);
  });

  it("M4 — amostra indisponível persistente (streak completo): alerta na 3ª checagem seguida", async () => {
    const history: QuotaWatchHistoryEntry[] = [
      { decision: "amostra-indisponivel", trigger: null, issueNumber: null },
      { decision: "amostra-indisponivel", trigger: null, issueNumber: null },
    ];
    const { deps: d, rows, open } = deps({ vercelDeploys24h: null, actionsQueueMaxWaitS: null, actionsStatus: null }, { history });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(rows[0]!.decision).toBe("amostra-indisponivel");
  });

  it("M4 — só uma checagem anterior indisponível: ainda não é streak, não alerta", async () => {
    const history: QuotaWatchHistoryEntry[] = [{ decision: "amostra-indisponivel", trigger: null, issueNumber: null }];
    const { deps: d, open } = deps({ vercelDeploys24h: null, actionsQueueMaxWaitS: null, actionsStatus: null }, { history });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("o alerta falhando (`ok: false`) ainda grava a linha — a métrica não depende da notificação", async () => {
    const { deps: d, rows } = deps({ vercelDeploys24h: 95, actionsQueueMaxWaitS: 0, actionsStatus: "none" }, { alertOk: false });
    const report = await runQuotaWatch(d);

    expect(report.alerted).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe("acao-recomendada");
  });

  it("o alerta falhando na ABERTURA não grava issueNumber (o número só existe se a abertura funcionou)", async () => {
    const { deps: d, rows } = deps({ vercelDeploys24h: 95, actionsQueueMaxWaitS: 0, actionsStatus: "none" }, { alertOk: false });
    await runQuotaWatch(d);
    expect(rows[0]!.issueNumber).toBeNull();
  });

});
