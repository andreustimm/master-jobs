import { NextResponse, type NextRequest } from "next/server";
import { canRunIngestion } from "../../../../src/core/ingest/environment.ts";
import { currentIngestionContext } from "../../../../src/core/ingest/guard.ts";
import { enqueueStale, runVerifyQueue } from "../../../../src/core/ingest/verify-queue.ts";
import { refuseWithoutCronSecret } from "../authorize.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Reconferência por segredo, num lote que cabe em uma função serverless.
 *
 * **Nada agenda esta rota.** O dono da reconferência agendada é a varredura do
 * GitHub (`.github/workflows/varredura.yml`), que drena a fila inteira numa
 * rodada; o cron da Vercel que também a chamava saiu de `vercel.json` para que
 * dois agendadores não disputassem a mesma fila (B-11). A rota fica para uma
 * chamada manual, com o mesmo lote pequeno — 30 segundos de teto.
 *
 * **Autenticação por `CRON_SECRET`, não por sessão** — ver
 * `refuseWithoutCronSecret`, compartilhada com a fatia de repontuação.
 */
export async function GET(request: NextRequest) {
  const recusa = refuseWithoutCronSecret(request);
  if (recusa) return recusa;

  // O segredo prova quem chama; a política diz se ESTE deployment pode gastar
  // cota. Um preview com o mesmo segredo herdado por engano continuaria
  // autenticado — e é exatamente o caso que a ADR 0021 fecha. Responder aqui
  // dá 503 com motivo em vez de deixar o erro subir do meio da fila.
  const decisao = canRunIngestion(currentIngestionContext());
  if (!decisao.allowed) {
    return NextResponse.json({ error: "ingestão bloqueada", motivo: decisao.reason }, { status: 503 });
  }

  // Enfileira antes de consumir: sem isto, a chamada só drenaria a fila que já
  // existia e as seguintes não teriam o que fazer.
  const enfileiradas = await enqueueStale({ limit: 60 });

  // `max` bem abaixo do teto de tempo. Ser interrompido no meio deixa tarefas
  // com claim pendurado, que só voltam a ser elegíveis depois do timeout de
  // claim — atrasa a próxima rodada por um lote ambicioso demais agora.
  const result = await runVerifyQueue({ max: 25, delayMs: 200, worker: "recheck-route" });

  return NextResponse.json({ enfileiradas, ...result });
}
