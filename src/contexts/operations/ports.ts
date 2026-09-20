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

export type DispatchResult =
  /** Aceito por quem executa; a rotina roda fora daqui. */
  | { ok: true }
  /** Sem credencial configurada: o pedido não sai, e quem chamou precisa dizer isso. */
  | { ok: false; code: "no_token" }
  /** Quem executa recusou. `status` entra no texto; corpo de resposta, nunca. */
  | { ok: false; code: "rejected"; status: number };

export type WorkflowDispatchPort = {
  /** Disponível quando há credencial — a tela usa isto para explicar o botão. */
  configured(): boolean;
  dispatch(routine: Routine): Promise<DispatchResult>;
};
