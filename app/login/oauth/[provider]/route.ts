import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FLOW_COOKIE, FLOW_TTL_MS, isOpenMode, startSocialSignIn } from "../../../../src/contexts/auth/index.ts";
import { currentSession } from "../../../auth";
import { redirect303 } from "../../redirect303";

/**
 * Começa o login com Google ou LinkedIn (#464, ADR-012).
 *
 * GET, e não formulário: o botão é um link, e um POST para outra origem
 * esbarraria na CSP (`form-action 'self'`). Pré-sessão por natureza — quem
 * clica ainda não entrou —, com uma exceção: `intent=link`, que liga o
 * provedor à conta da sessão e por isso a exige (`startSocialSignIn`).
 *
 * O que sai daqui é um 303 para o provedor e o cookie cifrado do fluxo, com
 * escopo `/login/oauth` e dez minutos de vida. Provedor fora da lista do
 * ambiente volta a `/login` com "não disponível aqui" (ADR-005); nome que não
 * é provedor é 404.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  // Modo aberto não tem conta a que ligar uma identidade.
  if (isOpenMode()) return redirect303(request, "/login");

  const { provider } = await context.params;
  const url = new URL(request.url);
  const outcome = await startSocialSignIn({
    provider,
    intent: url.searchParams.get("intent"),
    next: url.searchParams.get("next"),
    session: await currentSession(),
    request: {
      host: (await headers()).get("host"),
      proto: process.env.NODE_ENV === "production" ? "https" : "http",
    },
  });

  if (outcome.kind === "not_found") return new NextResponse(null, { status: 404 });
  if (outcome.kind === "provider") {
    (await cookies()).set(FLOW_COOKIE, outcome.sealedFlow, {
      httpOnly: true,
      // `lax` é o que deixa o cookie voltar no retorno: o provedor redireciona
      // com uma navegação GET de nível superior, que `lax` acompanha.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/login/oauth",
      maxAge: FLOW_TTL_MS / 1000,
    });
  }
  return redirect303(request, outcome.location);
}
