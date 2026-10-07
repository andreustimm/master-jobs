/**
 * O vigia de cota (ADR 0030, Fase 3): decide se a amostra lida da Vercel e do
 * GitHub Actions é `ok`, merece `aviso` ou `acao-recomendada` — sem banco,
 * sem rede, sem relógio (regra 4). Quem chama traz os números já coletados;
 * esta função só compara com o limiar.
 *
 * Dado ausente nunca é "ok" por omissão (regra 8, adaptada a infraestrutura):
 * uma métrica que falhou ao coletar entra como `null` e pesa como
 * `amostra-indisponivel`, nunca como "dentro do limite".
 *
 * O vigia nunca aplica a mudança sozinho (corte de escopo desta entrega,
 * ver `docs/operations.md`, "Vigia de cota: ativar") — por isso o estado se
 * chama `acao-recomendada`, não "automática", e a coluna que grava o texto é
 * `action_recommended`: a tabela não pode registrar uma ação que não foi
 * tomada.
 */

/** `null` numa métrica é "não foi possível coletar", nunca "zero". */
export type QuotaSample = {
  /** Deployments criados nas últimas 24 h, lidos da API da Vercel. */
  vercelDeploys24h: number | null;
  /** Maior espera (segundos) entre runs `queued` do Actions. */
  actionsQueueMaxWaitS: number | null;
  /** Status do componente "Actions" em https://www.githubstatus.com/api/v2/components.json. */
  actionsStatus: "none" | "minor" | "major" | "critical" | null;
};

export type QuotaThresholds = {
  /** Deploys/dia do plano monitorado (Vercel Hobby: 100). */
  vercelDailyDeployLimit: number;
  /** Fração do limite que já merece aviso (F3-01: 70%). */
  vercelWarnRatio: number;
  /** Fração do limite que já merece ação recomendada (F3-01: 90%). */
  vercelActionRatio: number;
  /** Fila do Actions acima disto já merece aviso. "N a definir" na techspec; 10 min aqui. */
  actionsQueueWarnS: number;
  /** Fila do Actions acima disto já merece ação recomendada; 20 min aqui. */
  actionsQueueActionS: number;
  /** Checagens seguidas com amostra indisponível antes de alertar (M4). */
  unavailableStreakForAlert: number;
};

export const DEFAULT_QUOTA_THRESHOLDS: QuotaThresholds = {
  vercelDailyDeployLimit: 100,
  vercelWarnRatio: 0.7,
  vercelActionRatio: 0.9,
  actionsQueueWarnS: 10 * 60,
  actionsQueueActionS: 20 * 60,
  unavailableStreakForAlert: 3,
};

export type QuotaTrigger = "vercel" | "actions";

export type QuotaDecision =
  | { state: "ok" }
  /** F3-02: métrica ausente/inválida — nunca decide como se fosse "ok". */
  | { state: "amostra-indisponivel"; missing: QuotaTrigger[] }
  | { state: "aviso"; trigger: QuotaTrigger; reason: string }
  | {
      state: "acao-recomendada";
      trigger: QuotaTrigger;
      reason: string;
      /** O que se recomenda fazer — texto operacional, nunca segredo. Nunca aplicado sozinho. */
      action: string;
      /** F3-05: toda `acao-recomendada` carrega o comando exato de reversão, sem placeholder. */
      reversalCommand: string;
    };

type DimensionState = "ok" | "indisponivel" | "aviso" | "acao-recomendada";

const RANK: Record<DimensionState, number> = { ok: 0, indisponivel: 1, aviso: 2, "acao-recomendada": 3 };

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
    return { state: "acao-recomendada", reason: `${deploys} deployments/24h — ${Math.round(ratio * 100)}% do limite da Vercel` };
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
  // Indisponibilidade confirmada do componente Actions pesa mais que a fila:
  // mesmo com fila baixa (ou desconhecida), "major"/"critical" já é motivo.
  if (status === "critical" || status === "major") {
    return { state: "acao-recomendada", reason: `componente Actions do githubstatus.com relata "${status}"` };
  }
  if (!isFiniteNonNegative(queueMaxWaitS) && status === null) {
    return { state: "indisponivel", reason: "não foi possível ler a fila do Actions nem o status do componente" };
  }
  if (status === "minor") {
    return { state: "aviso", reason: 'componente Actions do githubstatus.com relata "minor"' };
  }
  if (!isFiniteNonNegative(queueMaxWaitS)) {
    return { state: "indisponivel", reason: "não foi possível ler a fila do Actions" };
  }
  if (queueMaxWaitS >= thresholds.actionsQueueActionS) {
    return { state: "acao-recomendada", reason: `fila do Actions esperando ${Math.round(queueMaxWaitS / 60)} min` };
  }
  if (queueMaxWaitS >= thresholds.actionsQueueWarnS) {
    return { state: "aviso", reason: `fila do Actions esperando ${Math.round(queueMaxWaitS / 60)} min` };
  }
  return { state: "ok", reason: "" };
}

/**
 * O workflow que a promoção usa para levar `dev` a `staging` (e, na sequência,
 * a `main`, que é quem deploya desde a Fase 1). Pausá-lo reduz o ritmo de
 * merges que chegam a `main` sem depender de o runner self-hosted da Fase 2
 * existir — ao contrário de `CI_RUNS_ON`.
 */
export const PROMOTION_WORKFLOW = "promover-para-staging.yml";

/**
 * A recomendação e o comando de reversão de cada gatilho. Nunca um
 * placeholder (F3-05/M5): o comando de reversão precisa rodar como está.
 *
 * `vercel`: `DEPLOY_PREVIEW_ENVS` é só o registro documentado de qual preview
 * está religado (techspec, "Variável DEPLOY_PREVIEW_ENVS") — não é o
 * mecanismo que gera deploy, e zerá-la não reduz nada enquanto ela já estiver
 * vazia (o caso comum). A alavanca real é desligar a promoção: sem novo SHA
 * chegando a `staging`, não há novo PR de produção nem novo deploy de `main`.
 * `actions`: a alavanca (Fase 2) é `CI_RUNS_ON`; recomendar não é o mesmo que
 * aplicar — aplicar de fato é decisão do dono, porque um runner self-hosted
 * que ainda não existe não pode receber tráfego de CI. A reversão APAGA a
 * variável em vez de gravar uma etiqueta: sem ela, `ci.yml` cai no runner
 * hospedado padrão, e uma etiqueta copiada aqui envelheceria a cada troca de
 * versão do Ubuntu (issue #468).
 */
function actionOf(trigger: QuotaTrigger): { action: string; reversalCommand: string } {
  if (trigger === "vercel") {
    return {
      action: `recomendar \`gh workflow disable ${PROMOTION_WORKFLOW}\` (pausa a promoção dev→staging, cortando o ritmo de merges que chegam a \`main\` e deployam)`,
      reversalCommand: `gh workflow enable ${PROMOTION_WORKFLOW}`,
    };
  }
  return {
    action: 'recomendar `gh variable set CI_RUNS_ON --body \'["self-hosted","master-jobs"]\'` (só se o runner da Fase 2 já existir)',
    reversalCommand: "gh variable delete CI_RUNS_ON",
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

  if (winner.state === "acao-recomendada") {
    return { state: "acao-recomendada", trigger: winner.trigger, reason: winner.reason, ...actionOf(winner.trigger) };
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

/* --------------------------- Alerta: dedupe e persistência (M1/M4) --------------------------- */

/**
 * O que se compara para decidir "é a mesma situação de antes?" — `trigger`
 * nulo cobre o caso de `amostra-indisponivel` persistente (M4), que não tem
 * uma dimensão única.
 */
export type AlertPoint = { state: QuotaDecision["state"]; trigger: QuotaTrigger | null };

/** O alerta anterior mais recente (linha imediatamente anterior), se alguma — o que `runQuotaWatch` lê do banco. */
export type PreviousAlert = (AlertPoint & { issueNumber: number | null }) | null;

export type AlertPlan =
  /** Mesmo gatilho e mesmo estado da checagem anterior, com issue conhecida: comenta nela. */
  | { kind: "comment"; issueNumber: number }
  /** Estado/gatilho diferentes, ou a anterior não tinha issue: abre uma nova. */
  | { kind: "open" };

/**
 * M1 — dedupe: duas checagens seguidas no MESMO estado e MESMO gatilho
 * comentam na issue já aberta em vez de abrir outra. Pura: recebe o alerta
 * anterior como dado, nunca consulta o GitHub.
 */
export function planAlert(current: AlertPoint, previous: PreviousAlert): AlertPlan {
  if (previous && previous.state === current.state && previous.trigger === current.trigger && previous.issueNumber !== null) {
    return { kind: "comment", issueNumber: previous.issueNumber };
  }
  return { kind: "open" };
}

/**
 * M4 — amostra indisponível persistente. `pastDecisions` são as decisões das
 * checagens anteriores, mais recente primeiro, sem incluir a atual. Alerta a
 * partir da N-ésima (padrão 3) checagem SEGUIDA em `amostra-indisponivel`
 * (incluindo a atual) — uma falha isolada não abre issue, uma sequência sim.
 */
export function isPersistentlyUnavailable(
  pastDecisions: readonly string[],
  streak: number = DEFAULT_QUOTA_THRESHOLDS.unavailableStreakForAlert,
): boolean {
  const needed = streak - 1;
  if (needed <= 0) return true;
  if (pastDecisions.length < needed) return false;
  return pastDecisions.slice(0, needed).every((d) => d === "amostra-indisponivel");
}
