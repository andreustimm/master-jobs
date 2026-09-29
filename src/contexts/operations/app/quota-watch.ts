/**
 * Uma checagem do vigia de cota, do começo ao registro.
 *
 * Orquestração burra: os limiares, a decisão e o dedupe de alerta moram em
 * `domain/quota-watch.ts` (puros); a leitura das APIs de terceiro e a escrita
 * em `quota_watch` são `infra/`. Tudo chega por `deps`, para o teste dirigir
 * amostra, histórico e persistência sem rede nem banco.
 *
 * Alertar nunca é silencioso (ADR 0030 decisão 7): `aviso`, `acao-recomendada`
 * e `amostra-indisponivel` persistente (M4) sempre tentam avisar — a linha em
 * `quota_watch` fica gravada mesmo quando o aviso falhou, e o dedupe (M1)
 * decide entre abrir uma issue nova ou comentar na que já existe.
 */
import { redactSecrets } from "../../../core/observability.ts";
import {
  DEFAULT_QUOTA_THRESHOLDS,
  decideQuotaWatch,
  isPersistentlyUnavailable,
  planAlert,
  type AlertPoint,
  type PreviousAlert,
  type QuotaDecision,
  type QuotaSample,
  type QuotaThresholds,
} from "../domain/quota-watch.ts";
import type { QuotaAlertPort, QuotaMetricsPort, QuotaWatchHistoryEntry, QuotaWatchStore } from "../ports.ts";

export type { QuotaWatchRow, QuotaWatchStore, QuotaMetricsPort, QuotaAlertPort, QuotaWatchHistoryEntry } from "../ports.ts";

export type QuotaWatchDeps = {
  now: () => string;
  metrics: QuotaMetricsPort;
  store: QuotaWatchStore;
  alert: QuotaAlertPort;
  thresholds?: QuotaThresholds;
};

export type QuotaWatchReport = {
  checkedAt: string;
  sample: QuotaSample;
  decision: QuotaDecision;
  /** Só verdadeiro quando um alerta foi tentado E aceito (abertura ou comentário). */
  alerted: boolean;
  /** Número da issue usada, quando houve alerta. */
  issueNumber: number | null;
};

function noteOf(decision: QuotaDecision): string | null {
  if (decision.state === "ok") return null;
  if (decision.state === "amostra-indisponivel") return `amostra indisponível: ${decision.missing.join(", ")}`;
  return redactSecrets(decision.reason);
}

/** O ponto de comparação do M1: o que esta checagem representaria como alerta. */
function alertPointOf(
  decision: QuotaDecision,
  pastDecisions: readonly string[],
  thresholds: QuotaThresholds,
): AlertPoint | null {
  if (decision.state === "aviso" || decision.state === "acao-recomendada") {
    return { state: decision.state, trigger: decision.trigger };
  }
  if (decision.state === "amostra-indisponivel" && isPersistentlyUnavailable(pastDecisions, thresholds.unavailableStreakForAlert)) {
    return { state: "amostra-indisponivel", trigger: null };
  }
  return null;
}

function titleOf(point: AlertPoint): string {
  const gatilho = point.trigger ?? "amostra";
  return `Vigia de cota: ${point.state} (${gatilho})`;
}

function bodyOf(decision: QuotaDecision, repeat: boolean): string {
  const prefixo = repeat ? "Checagem se repete — " : "";
  if (decision.state === "acao-recomendada") {
    return (
      `${prefixo}${decision.reason}\n\n` +
      `Recomendação (nunca aplicada sozinha): ${decision.action}\n\n` +
      `Reverter com:\n\n\`\`\`\n${decision.reversalCommand}\n\`\`\``
    );
  }
  if (decision.state === "amostra-indisponivel") {
    return `${prefixo}amostra indisponível por checagens seguidas: ${decision.missing.join(", ")}. Confira os tokens do vigia (Vault) e a conectividade das APIs monitoradas.`;
  }
  if (decision.state === "aviso") {
    return `${prefixo}${decision.reason}\n\nNenhuma ação recomendada ainda — este é o aviso de 70%/minor (ADR 0030, Fase 3).`;
  }
  return "";
}

/** Uma checagem completa: coleta, decide, alerta (com dedupe) e grava. */
export async function runQuotaWatch(deps: QuotaWatchDeps): Promise<QuotaWatchReport> {
  const thresholds = deps.thresholds ?? DEFAULT_QUOTA_THRESHOLDS;
  const sample = await deps.metrics.sample();
  const decision = decideQuotaWatch(sample, thresholds);
  const checkedAt = deps.now();

  // O histórico cobre o suficiente para o streak do M4 (`unavailableStreakForAlert - 1`
  // checagens anteriores) e sempre pelo menos a imediatamente anterior, para o dedupe do M1.
  const history = await deps.store.recent(Math.max(1, thresholds.unavailableStreakForAlert - 1));
  const pastDecisions = history.map((h) => h.decision);
  const point = alertPointOf(decision, pastDecisions, thresholds);

  let alerted = false;
  let issueNumber: number | null = null;

  if (point) {
    const last = history[0] as QuotaWatchHistoryEntry | undefined;
    const previous: PreviousAlert = last ? { state: last.decision, trigger: last.trigger, issueNumber: last.issueNumber } : null;
    const plan = planAlert(point, previous);
    const body = bodyOf(decision, plan.kind === "comment");
    if (plan.kind === "comment") {
      const result = await deps.alert.comment({ issueNumber: plan.issueNumber, body });
      alerted = result.ok;
      issueNumber = plan.issueNumber;
    } else {
      const result = await deps.alert.open({ title: titleOf(point), body });
      alerted = result.ok;
      issueNumber = result.ok ? (result.number ?? null) : null;
    }
  }

  await deps.store.record({
    checkedAt,
    vercelDeploys24h: sample.vercelDeploys24h,
    actionsQueueMaxWaitS: sample.actionsQueueMaxWaitS,
    actionsStatus: sample.actionsStatus,
    decision: decision.state,
    trigger: point?.trigger ?? null,
    actionRecommended: decision.state === "acao-recomendada" ? redactSecrets(decision.action) : null,
    reversalCommand: decision.state === "acao-recomendada" ? decision.reversalCommand : null,
    note: noteOf(decision),
    issueNumber,
  });

  return { checkedAt, sample, decision, alerted, issueNumber };
}
