/**
 * Uma checagem do vigia de cota, do começo ao registro.
 *
 * Orquestração burra: os limiares e a decisão moram em `domain/quota-watch.ts`
 * (pura); a leitura das APIs de terceiro e a escrita em `quota_watch` são
 * `infra/`. Tudo chega por `deps`, para o teste dirigir amostra e persistência
 * sem rede nem banco.
 *
 * Alertar nunca é silencioso (ADR 0030 decisão 7): `aviso` e `acao-automatica`
 * sempre tentam abrir o aviso, e a linha em `quota_watch` fica gravada mesmo
 * quando o aviso falhou — a métrica é a fonte de verdade, não a notificação.
 */
import { redactSecrets } from "../../../core/observability.ts";
import { decideQuotaWatch, type QuotaDecision, type QuotaSample, type QuotaThresholds } from "../domain/quota-watch.ts";
import type { QuotaAlertPort, QuotaMetricsPort, QuotaWatchStore } from "../ports.ts";

export type { QuotaWatchRow, QuotaWatchStore, QuotaMetricsPort, QuotaAlertPort } from "../ports.ts";

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
  /** Só verdadeiro quando o aviso foi tentado E aceito. `false` em `ok`. */
  alerted: boolean;
};

function noteOf(decision: QuotaDecision): string | null {
  if (decision.state === "ok") return null;
  if (decision.state === "amostra-indisponivel") return `amostra indisponível: ${decision.missing.join(", ")}`;
  return redactSecrets(decision.reason);
}

function issueOf(decision: QuotaDecision): { title: string; body: string } | null {
  if (decision.state === "aviso") {
    return {
      title: `Vigia de cota: aviso (${decision.trigger})`,
      body: `${decision.reason}\n\nNenhuma ação automática ainda — este é o aviso de 70%/minor (ADR 0030, Fase 3).`,
    };
  }
  if (decision.state === "acao-automatica") {
    return {
      title: `Vigia de cota: ação automática (${decision.trigger})`,
      body: `${decision.reason}\n\nAção: ${decision.action}\n\nReverter com:\n\n\`\`\`\n${decision.reversalCommand}\n\`\`\``,
    };
  }
  return null;
}

/** Uma checagem completa: coleta, decide, alerta (se preciso) e grava. */
export async function runQuotaWatch(deps: QuotaWatchDeps): Promise<QuotaWatchReport> {
  const sample = await deps.metrics.sample();
  const decision = decideQuotaWatch(sample, deps.thresholds);
  const checkedAt = deps.now();

  let alerted = false;
  const issue = issueOf(decision);
  if (issue) {
    const opened = await deps.alert.open(issue);
    alerted = opened.ok;
  }

  await deps.store.record({
    checkedAt,
    vercelDeploys24h: sample.vercelDeploys24h,
    actionsQueueMaxWaitS: sample.actionsQueueMaxWaitS,
    actionsStatus: sample.actionsStatus,
    decision: decision.state,
    actionTaken: decision.state === "acao-automatica" ? redactSecrets(decision.action) : null,
    reversalCommand: decision.state === "acao-automatica" ? decision.reversalCommand : null,
    note: noteOf(decision),
  });

  return { checkedAt, sample, decision, alerted };
}
