import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUOTA_THRESHOLDS,
  PROMOTION_WORKFLOW,
  decideQuotaWatch,
  isPersistentlyUnavailable,
  planAlert,
  type QuotaSample,
} from "../src/contexts/operations/domain/quota-watch.ts";

/**
 * `decideQuotaWatch` — a lógica pura do vigia de cota (ADR 0030, Fase 3).
 *
 * Contrato: `.compozy/tasks/contingencia-ci-deploy/_tests.md`, F3-01 a F3-05.
 * Sem banco, sem rede, sem relógio — cada teste só passa amostra e limiar.
 */

const OK: QuotaSample = { vercelDeploys24h: 10, actionsQueueMaxWaitS: 60, actionsStatus: "none" };

describe("F3-01 — limiares 70 %/90 % decidem a ação certa", () => {
  it("abaixo de 70 % dos deploys e fila baixa: ok", () => {
    expect(decideQuotaWatch(OK)).toEqual({ state: "ok" });
  });

  it("entre 70 % e 90 % dos deploys: aviso", () => {
    const decision = decideQuotaWatch({ ...OK, vercelDeploys24h: 75 });
    expect(decision).toMatchObject({ state: "aviso", trigger: "vercel" });
  });

  it("70 deploys exatos (limiar) já é aviso — >=, não >", () => {
    expect(decideQuotaWatch({ ...OK, vercelDeploys24h: 70 })).toMatchObject({ state: "aviso" });
  });

  it("a partir de 90 % dos deploys: ação recomendada, com reversão", () => {
    const decision = decideQuotaWatch({ ...OK, vercelDeploys24h: 91 });
    expect(decision).toMatchObject({ state: "acao-recomendada", trigger: "vercel" });
  });

  it("fila do Actions acima do limiar de aviso/ação, mesmo com deploys baixos", () => {
    expect(decideQuotaWatch({ ...OK, actionsQueueMaxWaitS: 11 * 60 })).toMatchObject({ state: "aviso", trigger: "actions" });
    expect(decideQuotaWatch({ ...OK, actionsQueueMaxWaitS: 21 * 60 })).toMatchObject({
      state: "acao-recomendada",
      trigger: "actions",
    });
  });

  it("indisponibilidade confirmada da plataforma (major/critical) é ação recomendada mesmo com fila vazia", () => {
    for (const status of ["major", "critical"] as const) {
      expect(decideQuotaWatch({ ...OK, actionsQueueMaxWaitS: 0, actionsStatus: status })).toMatchObject({
        state: "acao-recomendada",
        trigger: "actions",
      });
    }
  });

  it("indicator=minor é aviso, não ação recomendada", () => {
    expect(decideQuotaWatch({ ...OK, actionsQueueMaxWaitS: 0, actionsStatus: "minor" })).toMatchObject({
      state: "aviso",
      trigger: "actions",
    });
  });

  it("fila ausente mas status conhecido (não minor/major/critical): amostra-indisponivel só do lado do Actions", () => {
    // `actionsStatus: "none"` passa pelas checagens de minor/major/critical
    // sem decidir — é a fila (`null`) que sobra como o único motivo.
    const decision = decideQuotaWatch({ ...OK, actionsQueueMaxWaitS: null, actionsStatus: "none" });
    expect(decision).toEqual({ state: "amostra-indisponivel", missing: ["actions"] });
  });

  it("os dois gatilhos estourando ao mesmo tempo: o pior vence", () => {
    const decision = decideQuotaWatch({ vercelDeploys24h: 95, actionsQueueMaxWaitS: 30 * 60, actionsStatus: "none" });
    expect(decision.state).toBe("acao-recomendada");
  });

  it("limiares customizados mudam o corte", () => {
    const thresholds = { ...DEFAULT_QUOTA_THRESHOLDS, vercelDailyDeployLimit: 10, vercelWarnRatio: 0.5, vercelActionRatio: 0.8 };
    expect(decideQuotaWatch({ ...OK, vercelDeploys24h: 5 }, thresholds)).toMatchObject({ state: "aviso" });
    expect(decideQuotaWatch({ ...OK, vercelDeploys24h: 8 }, thresholds)).toMatchObject({ state: "acao-recomendada" });
  });
});

describe("F3-02 — amostra ausente ou inválida nunca é 'ok'", () => {
  it("as duas métricas ausentes: amostra-indisponivel, nunca ok", () => {
    const decision = decideQuotaWatch({ vercelDeploys24h: null, actionsQueueMaxWaitS: null, actionsStatus: null });
    expect(decision.state).toBe("amostra-indisponivel");
    if (decision.state === "amostra-indisponivel") {
      expect(decision.missing.sort()).toEqual(["actions", "vercel"]);
    }
  });

  it("só a Vercel ausente, Actions ok: amostra-indisponivel (não finge ok pela metade boa)", () => {
    const decision = decideQuotaWatch({ vercelDeploys24h: null, actionsQueueMaxWaitS: 0, actionsStatus: "none" });
    expect(decision).toEqual({ state: "amostra-indisponivel", missing: ["vercel"] });
  });

  it("valor negativo ou não finito de deploys também é amostra indisponível, nunca contagem", () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const decision = decideQuotaWatch({ vercelDeploys24h: value, actionsQueueMaxWaitS: null, actionsStatus: null });
      expect(decision.state, String(value)).toBe("amostra-indisponivel");
    }
  });

  it("amostra ausente nunca é sobreposta por um sinal real pior: se a outra dimensão está mal, o real vence", () => {
    // Vercel ausente, mas o Actions já estourou 90%: o sinal real que existe
    // não pode ser escondido por uma coleta parcial — a linha carrega os dois.
    const decision = decideQuotaWatch({ vercelDeploys24h: null, actionsQueueMaxWaitS: 25 * 60, actionsStatus: "none" });
    expect(decision.state).toBe("acao-recomendada");
  });
});

describe("F3-03 — determinístico: a mesma amostra produz a mesma decisão", () => {
  it("chamar duas vezes com a mesma amostra dá o mesmo resultado", () => {
    const sample: QuotaSample = { vercelDeploys24h: 91, actionsQueueMaxWaitS: 30, actionsStatus: "none" };
    expect(decideQuotaWatch(sample)).toEqual(decideQuotaWatch(sample));
  });

  it("amostra indisponível também é estável", () => {
    const sample: QuotaSample = { vercelDeploys24h: null, actionsQueueMaxWaitS: null, actionsStatus: null };
    expect(decideQuotaWatch(sample)).toEqual(decideQuotaWatch(sample));
  });
});

describe("F3-05 — toda ação recomendada carrega o comando de reversão", () => {
  it("gatilho vercel: reversão explícita, não vazia, sem placeholder (M5)", () => {
    const decision = decideQuotaWatch({ ...OK, vercelDeploys24h: 92 });
    expect(decision.state).toBe("acao-recomendada");
    if (decision.state === "acao-recomendada") {
      expect(decision.reversalCommand.length).toBeGreaterThan(0);
      expect(decision.action.length).toBeGreaterThan(0);
      expect(decision.reversalCommand).not.toContain("<");
      expect(decision.action).not.toContain("<");
    }
  });

  it("M5 — gatilho vercel recomenda pausar a promoção (workflow real), não DEPLOY_PREVIEW_ENVS (só registro)", () => {
    const decision = decideQuotaWatch({ ...OK, vercelDeploys24h: 92 });
    expect(decision.state).toBe("acao-recomendada");
    if (decision.state === "acao-recomendada") {
      expect(decision.action).toContain(`gh workflow disable ${PROMOTION_WORKFLOW}`);
      expect(decision.reversalCommand).toBe(`gh workflow enable ${PROMOTION_WORKFLOW}`);
      expect(decision.action).not.toContain("DEPLOY_PREVIEW_ENVS");
      expect(decision.reversalCommand).not.toContain("DEPLOY_PREVIEW_ENVS");
    }
  });

  it("gatilho actions: reversão explícita, não vazia, sem placeholder", () => {
    const decision = decideQuotaWatch({ ...OK, actionsStatus: "critical" });
    expect(decision.state).toBe("acao-recomendada");
    if (decision.state === "acao-recomendada") {
      expect(decision.reversalCommand.length).toBeGreaterThan(0);
      expect(decision.reversalCommand).not.toContain("<");
    }
  });

  it("nenhuma decisão fora de acao-recomendada carrega reversalCommand", () => {
    for (const decision of [
      decideQuotaWatch(OK),
      decideQuotaWatch({ ...OK, vercelDeploys24h: 75 }),
      decideQuotaWatch({ vercelDeploys24h: null, actionsQueueMaxWaitS: null, actionsStatus: null }),
    ]) {
      expect(decision).not.toHaveProperty("reversalCommand");
    }
  });
});

describe("M1 — planAlert: dedupe puro contra o alerta anterior", () => {
  it("sem alerta anterior: abre", () => {
    expect(planAlert({ state: "aviso", trigger: "vercel" }, null)).toEqual({ kind: "open" });
  });

  it("mesmo estado e gatilho, com issue conhecida: comenta nela", () => {
    const previous = { state: "aviso" as const, trigger: "vercel" as const, issueNumber: 42 };
    expect(planAlert({ state: "aviso", trigger: "vercel" }, previous)).toEqual({ kind: "comment", issueNumber: 42 });
  });

  it("mesmo estado e gatilho, mas sem issue registrada (abertura anterior falhou): abre de novo", () => {
    const previous = { state: "aviso" as const, trigger: "vercel" as const, issueNumber: null };
    expect(planAlert({ state: "aviso", trigger: "vercel" }, previous)).toEqual({ kind: "open" });
  });

  it("gatilho diferente: abre uma nova, mesmo com issue conhecida", () => {
    const previous = { state: "aviso" as const, trigger: "vercel" as const, issueNumber: 42 };
    expect(planAlert({ state: "aviso", trigger: "actions" }, previous)).toEqual({ kind: "open" });
  });

  it("estado diferente (aviso -> acao-recomendada): abre uma nova", () => {
    const previous = { state: "aviso" as const, trigger: "vercel" as const, issueNumber: 42 };
    expect(planAlert({ state: "acao-recomendada", trigger: "vercel" }, previous)).toEqual({ kind: "open" });
  });

  it("amostra-indisponivel persistente também dedupla (trigger nulo dos dois lados)", () => {
    const previous = { state: "amostra-indisponivel" as const, trigger: null, issueNumber: 7 };
    expect(planAlert({ state: "amostra-indisponivel", trigger: null }, previous)).toEqual({ kind: "comment", issueNumber: 7 });
  });
});

describe("M4 — isPersistentlyUnavailable: streak de amostra indisponível", () => {
  it("sem histórico: não alerta (precisa de streak-1 checagens anteriores)", () => {
    expect(isPersistentlyUnavailable([])).toBe(false);
  });

  it("uma anterior só: ainda não é streak de 3", () => {
    expect(isPersistentlyUnavailable(["amostra-indisponivel"])).toBe(false);
  });

  it("duas anteriores, ambas indisponíveis: streak de 3 completo (com a atual)", () => {
    expect(isPersistentlyUnavailable(["amostra-indisponivel", "amostra-indisponivel"])).toBe(true);
  });

  it("uma das duas anteriores não era amostra-indisponivel: quebra o streak", () => {
    expect(isPersistentlyUnavailable(["amostra-indisponivel", "ok"])).toBe(false);
    expect(isPersistentlyUnavailable(["ok", "amostra-indisponivel"])).toBe(false);
  });

  it("streak customizado", () => {
    expect(isPersistentlyUnavailable(["amostra-indisponivel"], 2)).toBe(true);
    expect(isPersistentlyUnavailable([], 1)).toBe(true);
  });
});
