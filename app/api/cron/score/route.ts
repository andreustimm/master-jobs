import { NextResponse, type NextRequest } from "next/server";
import { runScoreSlice } from "../../../../src/core/scoring/queue.ts";
import { refuseWithoutCronSecret } from "../authorize.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Uma fatia da fila de repontuação, por segredo.
 *
 * Salvar o currículo já dispara uma fatia no `after()` da própria ação; esta
 * rota é a continuação para quando o acervo não coube nela, ou quando o
 * `after()` morreu. Quem a chama a cada poucos minutos é um agendador externo
 * (#281) — a Vercel não agenda nada aqui: o plano só permite cron diário, e
 * `vercel.json` continua sem `crons` (ver `docs/operations.md`).
 *
 * Contrato: `GET`, `authorization: Bearer <CRON_SECRET>`, resposta 200 com
 * `processadas`, `pontuadas`, `falhas`, `adiadas`, `interrompida` e
 * `pendentes`. Chamar de novo é sempre seguro: a reivindicação é atômica, a
 * fatia interrompida devolve a tarefa à fila sem gastar tentativa, e as notas
 * gravadas não são refeitas.
 *
 * Não consulta a política de ingestão, ao contrário de `/api/cron/recheck`:
 * pontuar não chama site de terceiro, só grava nota no banco do próprio
 * ambiente.
 */
export async function GET(request: NextRequest) {
  const recusa = refuseWithoutCronSecret(request);
  if (recusa) return recusa;

  return NextResponse.json(await runScoreSlice("cron-score"));
}
