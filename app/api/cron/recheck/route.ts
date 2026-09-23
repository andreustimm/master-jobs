import { NextResponse, type NextRequest } from "next/server";
import { enqueueStale, runVerifyQueue } from "../../../../src/core/ingest/verify-queue.ts";
import { cronDenied, ingestionDenied } from "../authorize.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Reconferência por segredo, num lote que cabe em uma função serverless.
 *
 * **Nada agenda esta rota.** A reconferência agendada é a fatia
 * `reconferencia` de `/api/cron/varredura`, chamada pelo `pg_cron` do Supabase
 * (ADR 0025). Esta rota fica para uma chamada manual, com o mesmo lote pequeno
 * — 30 segundos de teto.
 *
 * **Autenticação por `CRON_SECRET`, não por sessão**, pela mesma borda de toda
 * rota de `/api/cron/` (`../authorize.ts`).
 */
export async function GET(request: NextRequest) {
  const denied = cronDenied(request) ?? ingestionDenied();
  if (denied) return denied;

  // Enfileira antes de consumir: sem isto, a chamada só drenaria a fila que já
  // existia e as seguintes não teriam o que fazer.
  const enfileiradas = await enqueueStale({ limit: 60 });

  // `max` bem abaixo do teto de tempo. Ser interrompido no meio deixa tarefas
  // com claim pendurado, que só voltam a ser elegíveis depois do timeout de
  // claim — atrasa a próxima rodada por um lote ambicioso demais agora.
  const result = await runVerifyQueue({ max: 25, delayMs: 200, worker: "recheck-route", budgetMs: 20_000 });

  return NextResponse.json({ enfileiradas, ...result });
}
