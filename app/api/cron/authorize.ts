import { NextResponse } from "next/server";
import { authorizeCronRequest } from "../../../src/contexts/auth/index.ts";
import { canRunIngestion } from "../../../src/core/ingest/environment.ts";
import { currentIngestionContext } from "../../../src/core/ingest/guard.ts";

/**
 * A borda HTTP do "cron por segredo", comum a toda rota de `/api/cron/`.
 *
 * Devolve a resposta de recusa, ou `null` quando a chamada pode seguir. É a
 * PRIMEIRA coisa que cada `GET` faz — antes de banco, fila ou rede —, e é
 * síncrona de propósito: nada com efeito cabe antes dela.
 *
 * A decisão é `authorizeCronRequest`, pura, no contexto de autenticação; aqui
 * só se lê o ambiente e se traduz em HTTP. Os corpos de erro são os que a rota
 * de reconferência sempre deu, para quem já monitora por eles.
 */
export function cronDenied(request: Request): NextResponse | null {
  const decision = authorizeCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (decision.ok) return null;
  return decision.status === 503
    ? NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 503 })
    : NextResponse.json({ error: "não autorizado" }, { status: 401 });
}

/**
 * O segredo prova quem chama; a política diz se ESTE deployment pode gastar
 * cota de terceiro (ADR 0021). Um preview com o mesmo segredo herdado por
 * engano continuaria autenticado — e é exatamente o caso que esta checagem
 * fecha, com 503 e motivo em vez de erro subindo do meio da fila.
 */
export function ingestionDenied(): NextResponse | null {
  const decision = canRunIngestion(currentIngestionContext());
  if (decision.allowed) return null;
  return NextResponse.json({ error: "ingestão bloqueada", motivo: decision.reason }, { status: 503 });
}
