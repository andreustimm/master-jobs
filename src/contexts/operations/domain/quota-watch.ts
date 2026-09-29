/**
 * O vigia de cota (ADR 0030, Fase 3): decide se a amostra lida da Vercel e do
 * GitHub Actions é `ok`, merece `aviso` ou exige `acao-automatica` — sem
 * banco, sem rede, sem relógio (regra 4). Quem chama traz os números já
 * coletados; esta função só compara com o limiar.
 *
 * Dado ausente nunca é "ok" por omissão (regra 8, adaptada a infraestrutura):
 * uma métrica que falhou ao coletar entra como `null` e pesa como
 * `amostra-indisponivel`, nunca como "dentro do limite".
 */

/** `null` numa métrica é "não foi possível coletar", nunca "zero". */
export type QuotaSample = {
  /** Deployments criados nas últimas 24 h, lidos da API da Vercel. */
  vercelDeploys24h: number | null;
  /** Maior espera (segundos) entre runs `queued`/`in_progress` do Actions. */
  actionsQueueMaxWaitS: number | null;
  /** `indicator` de https://www.githubstatus.com/api/v2/status.json. */
  actionsStatus: "none" | "minor" | "major" | "critical" | null;
};

export type QuotaThresholds = {
  /** Deploys/dia do plano monitorado (Vercel Hobby: 100). */
  vercelDailyDeployLimit: number;
  /** Fração do limite que já merece aviso (F3-01: 70%). */
  vercelWarnRatio: number;
  /** Fração do limite que já exige ação automática (F3-01: 90%). */
  vercelActionRatio: number;
  /** Fila do Actions acima disto já merece aviso. "N a definir" na techspec; 10 min aqui. */
  actionsQueueWarnS: number;
  /** Fila do Actions acima disto já exige ação automática; 20 min aqui. */
  actionsQueueActionS: number;
};

export const DEFAULT_QUOTA_THRESHOLDS: QuotaThresholds = {
  vercelDailyDeployLimit: 100,
  vercelWarnRatio: 0.7,
  vercelActionRatio: 0.9,
  actionsQueueWarnS: 10 * 60,
  actionsQueueActionS: 20 * 60,
};

export type QuotaTrigger = "vercel" | "actions";

export type QuotaDecision =
  | { state: "ok" }
  /** F3-02: métrica ausente/inválida — nunca decide como se fosse "ok". */
  | { state: "amostra-indisponivel"; missing: QuotaTrigger[] }
  | { state: "aviso"; trigger: QuotaTrigger; reason: string }
  | {
      state: "acao-automatica";
      trigger: QuotaTrigger;
      reason: string;
      /** O que a ação automática faz — texto operacional, nunca segredo. */
      action: string;
      /** F3-05: toda `acao-automatica` carrega o comando exato de reversão. */
      reversalCommand: string;
    };

type DimensionState = "ok" | "indisponivel" | "aviso" | "acao-automatica";

const RANK: Record<DimensionState, number> = { ok: 0, indisponivel: 1, aviso: 2, "acao-automatica": 3 };

function isFiniteNonNegative(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function vercelDimension(
  deploys: number | null,
  thresholds: QuotaThresholds,
): { state: DimensionState; reason: string } {
  if (!isFiniteNonNegative(deploys)) {
    return { state: "indisponivel", reason: "não foi possível ler deployments da Vercel nas últimas 24 h" };
  }
  const ratio = deploys / thresholds.vercelDailyDeployLimit;
  if (ratio >= thresholds.vercelActionRatio) {
    return { state: "acao-automatica", reason: `${deploys} deployments/24h — ${Math.round(ratio * 100)}% do limite da Vercel` };
  }
  if (ratio >= thresholds.vercelWarnRatio) {
    return { state: "aviso", reason: `${deploys} deployments/24h — ${Math.round(ratio * 100)}% do limite da Vercel` };
  }
  return { state: "ok", reason: "" };
}

function actionsDimension(
  queueMaxWaitS: number | null,
  status: QuotaSample["actionsStatus"],
  thresholds: QuotaThresholds,
): { state: DimensionState; reason: string } {
  // Indisponibilidade confirmada da plataforma pesa mais que a fila: mesmo
  // com fila baixa (ou desconhecida), "major"/"critical" já é motivo de ação.
  if (status === "critical" || status === "major") {
    return { state: "acao-automatica", reason: `githubstatus.com relata indicator="${status}"` };
  }
  if (!isFiniteNonNegative(queueMaxWaitS) && status === null) {
    return { state: "indisponivel", reason: "não foi possível ler a fila do Actions nem o status da plataforma" };
  }
  if (status === "minor") {
    return { state: "aviso", reason: 'githubstatus.com relata indicator="minor"' };
  }
  if (!isFiniteNonNegative(queueMaxWaitS)) {
    return { state: "indisponivel", reason: "não foi possível ler a fila do Actions" };
  }
  if (queueMaxWaitS >= thresholds.actionsQueueActionS) {
    return { state: "acao-automatica", reason: `fila do Actions esperando ${Math.round(queueMaxWaitS / 60)} min` };
  }
  if (queueMaxWaitS >= thresholds.actionsQueueWarnS) {
    return { state: "aviso", reason: `fila do Actions esperando ${Math.round(queueMaxWaitS / 60)} min` };
  }
  return { state: "ok", reason: "" };
}

/**
 * A ação e o comando de reversão de cada gatilho.
 *
 * `vercel`: a alavanca já existente (Fase 1) é `DEPLOY_PREVIEW_ENVS` — limpá-la
 * garante que só `main` deploya, sem depender da Fase 2 existir. `actions`:
 * a alavanca (Fase 2) é `CI_RUNS_ON`; recomendar não é o mesmo que aplicar —
 * quem decide aplicar de fato é o adapter, por opt-in explícito (ADR 0030
 * princípio 2), porque um runner self-hosted que ainda não existe não pode
 * receber tráfego de CI.
 */
function actionOf(trigger: QuotaTrigger): { action: string; reversalCommand: string } {
  if (trigger === "vercel") {
    return {
      action: 'recomendar `gh variable set DEPLOY_PREVIEW_ENVS --body ""` (garante só `main` deployando)',
      reversalCommand: 'gh variable set DEPLOY_PREVIEW_ENVS --body "<valor anterior>"',
    };
  }
  return {
    action: 'recomendar `gh variable set CI_RUNS_ON --body \'["self-hosted","master-jobs"]\'` (só se o runner da Fase 2 já existir)',
    reversalCommand: 'gh variable set CI_RUNS_ON --body \'"ubuntu-latest"\'',
  };
}

/**
 * Decide a partir de uma amostra e dos limiares (padrão: os da techspec).
 *
 * Determinístico (F3-03): a mesma amostra sempre produz a mesma decisão — não
 * há relógio nem estado escondido aqui.
 */
export function decideQuotaWatch(
  sample: QuotaSample,
  thresholds: QuotaThresholds = DEFAULT_QUOTA_THRESHOLDS,
): QuotaDecision {
  const vercel = vercelDimension(sample.vercelDeploys24h, thresholds);
  const actions = actionsDimension(sample.actionsQueueMaxWaitS, sample.actionsStatus, thresholds);

  const winner: { trigger: QuotaTrigger; state: DimensionState; reason: string } =
    RANK[actions.state] > RANK[vercel.state] ? { trigger: "actions", ...actions } : { trigger: "vercel", ...vercel };

  if (winner.state === "acao-automatica") {
    return { state: "acao-automatica", trigger: winner.trigger, reason: winner.reason, ...actionOf(winner.trigger) };
  }
  if (winner.state === "aviso") {
    return { state: "aviso", trigger: winner.trigger, reason: winner.reason };
  }
  if (winner.state === "indisponivel") {
    const missing: QuotaTrigger[] = [];
    if (vercel.state === "indisponivel") missing.push("vercel");
    if (actions.state === "indisponivel") missing.push("actions");
    return { state: "amostra-indisponivel", missing };
  }
  return { state: "ok" };
}
