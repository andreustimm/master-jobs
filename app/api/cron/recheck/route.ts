import { NextResponse, type NextRequest } from "next/server";
import { canRunIngestion } from "../../../../src/core/ingest/environment.ts";
import { currentIngestionContext } from "../../../../src/core/ingest/guard.ts";
import { enqueueStale, runVerifyQueue } from "../../../../src/core/ingest/verify-queue.ts";

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
 * **Autenticação por `CRON_SECRET`, não por sessão.** Quem chama esta rota
 * não traz cookie nenhum, então o guard de sessão a bloquearia. O segredo vem no
 * `authorization`, e a comparação é de tempo constante — um `===` sobre
 * segredo vaza o prefixo pelo tempo de resposta, e esta rota responde a quem
 * quiser chamá-la.
 */
function seguroIgual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

export async function GET(request: NextRequest) {
  const esperado = process.env.CRON_SECRET;

  // Sem segredo configurado a rota fica FECHADA, e não aberta. Um cron
  // desprotegido é um botão de disparar requisições contra sites de terceiros
  // que qualquer um pode apertar em laço.
  if (!esperado) {
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 503 });
  }

  const enviado = request.headers.get("authorization") ?? "";
  if (!seguroIgual(enviado, `Bearer ${esperado}`)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

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
