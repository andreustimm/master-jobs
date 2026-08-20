import { NextResponse, type NextRequest } from "next/server";
import { enqueueStale, runVerifyQueue } from "../../../../src/core/ingest/verify-queue.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Reconferência agendada, para quando o sistema vive na Vercel.
 *
 * `jho jobs recheck queue && jho jobs recheck run` fazem isto no terminal e
 * levam minutos. Uma função serverless tem teto — 30 segundos no plano gratuito
 * — então o lote aqui é pequeno de propósito e a fila é consumida ao longo de
 * vários dias. Não é a mesma coisa; é o que cabe.
 *
 * Quem roda `jho` num laptop apontado para a mesma Turso não precisa desta
 * rota. Ela existe para quem não tem laptop ligado.
 *
 * **Autenticação por `CRON_SECRET`, não por sessão.** A Vercel chama esta rota
 * sem cookie nenhum, então o guard de sessão a bloquearia. O segredo vem no
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

  // Enfileira antes de consumir: sem isto, o primeiro dia processaria a fila
  // que já existia e os seguintes não teriam o que fazer.
  const enfileiradas = await enqueueStale({ limit: 60 });

  // `max` bem abaixo do teto de tempo. Ser interrompido no meio deixa tarefas
  // com claim pendurado, que só voltam a ser elegíveis depois do timeout de
  // claim — atrasa o dia seguinte por um lote ambicioso demais hoje.
  const result = await runVerifyQueue({ max: 25, delayMs: 200, worker: "vercel-cron" });

  return NextResponse.json({ enfileiradas, ...result });
}
