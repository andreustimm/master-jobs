import { NextResponse } from "next/server";

/**
 * Autenticação das rotas de serviço por `CRON_SECRET`, não por sessão.
 *
 * Quem chama essas rotas — um agendador, ou o dono à mão — não traz cookie
 * nenhum, então o guard de sessão as bloquearia. O segredo vem no
 * `authorization`, e a comparação é de tempo constante: um `===` sobre segredo
 * vaza o prefixo pelo tempo de resposta, e estas rotas respondem a quem quiser
 * chamá-las.
 */
function seguroIgual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

/** A resposta de recusa, ou `null` quando quem chama provou ter o segredo. */
export function refuseWithoutCronSecret(request: Request): NextResponse | null {
  const esperado = process.env.CRON_SECRET;

  // Sem segredo configurado a rota fica FECHADA, e não aberta. Um erro de
  // configuração não pode virar porta aberta — e ninguém percebe uma variável
  // que não foi definida.
  if (!esperado) {
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 503 });
  }

  const enviado = request.headers.get("authorization") ?? "";
  if (!seguroIgual(enviado, `Bearer ${esperado}`)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  return null;
}
