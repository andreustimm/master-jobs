/**
 * Porta do contexto de operações. Uma, porque uma variação é real.
 *
 * `WorkflowDispatchPort` absorve **quem executa** a rotina. Não pode ser a
 * função da Vercel: ela morre em 30 segundos e o sync leva de 18 a 27 minutos.
 * Hoje quem executa é o GitHub Actions, chamado por `workflow_dispatch`; amanhã
 * pode ser uma fila (ADR 0009) ou um runner próprio, e a tela não muda.
 *
 * Não há porta para "ler estado": o estado já mora nas tabelas que as rotinas
 * escrevem, e uma porta com uma implementação e nenhuma alternativa plausível
 * seria cerimônia — a ADR 0007 recusa isso explicitamente.
 */
import type { Routine } from "./domain/routine.ts";
import type { QuotaDecision, QuotaSample } from "./domain/quota-watch.ts";

export type DispatchResult =
  /** Aceito por quem executa; a rotina roda fora daqui. */
  | { ok: true }
  /** Sem credencial configurada: o pedido não sai, e quem chamou precisa dizer isso. */
  | { ok: false; code: "no_token" }
  /** Quem executa recusou. `status` entra no texto; corpo de resposta, nunca. */
  | { ok: false; code: "rejected"; status: number };

/**
 * O que se pede a quem executa. Só `routine` é a rotina inteira de antes;
 * com `run`, quem executa roda aquela execução de `source_run` (#223), e
 * `source` diz de qual fonte ela é — o executor confere os dois.
 */
export type DispatchRequest = {
  routine: Routine;
  source?: string | null;
  run?: number | null;
};

export type WorkflowDispatchPort = {
  /** Disponível quando há credencial — a tela usa isto para explicar o botão. */
  configured(): boolean;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
};

/* ------------------------- Vigia de cota (ADR 0030, Fase 3) ------------------------- */

export type QuotaWatchRow = {
  checkedAt: string;
  vercelDeploys24h: number | null;
  actionsQueueMaxWaitS: number | null;
  actionsStatus: QuotaSample["actionsStatus"];
  decision: QuotaDecision["state"];
  actionTaken: string | null;
  reversalCommand: string | null;
  note: string | null;
};

export type QuotaWatchStore = {
  record(row: QuotaWatchRow): Promise<void>;
};

/** Uma amostra: cada campo `null` quando a coleta daquela métrica falhou. */
export type QuotaMetricsPort = {
  sample(): Promise<QuotaSample>;
};

export type QuotaAlertPort = {
  /** Sempre tentado em `aviso`/`acao-automatica`; nunca lança — o chamador só lê `ok`. */
  open(input: { title: string; body: string }): Promise<{ ok: boolean; reason?: string }>;
};
