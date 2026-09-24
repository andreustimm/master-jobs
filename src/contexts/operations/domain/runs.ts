/**
 * Estados de uma execução de trabalho longo e a regra de vencimento do lease.
 *
 * Puro: o instante chega como argumento. Uma regra só de vencimento para toda
 * fila com lease (execução de fonte, análise de vaga): duas regras divergiriam
 * sobre quando um processador morto deixa de prender o trabalho.
 */

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted";

/**
 * `running` sem batimento além do lease: o processador morreu ou perdeu a
 * conexão, e a linha precisa sair do estado ativo para não prender o trabalho
 * para sempre. Estado terminal nunca vence — nem `queued`, que ainda não tem
 * dono. Batimento ilegível conta como vencido: sem prova de vida, não há vida.
 */
export function isStale(run: { status: RunStatus; heartbeatAt: string }, now: string, leaseMs: number): boolean {
  if (run.status !== "running") return false;
  const beat = Date.parse(run.heartbeatAt);
  const at = Date.parse(now);
  if (Number.isNaN(beat)) return true;
  return at - beat > leaseMs;
}
