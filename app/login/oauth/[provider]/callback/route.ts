import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  FLOW_COOKIE,
  SIGNUP_COOKIE,
  finishSocialSignIn,
  isOpenMode,
} from "../../../../../src/contexts/auth/index.ts";
import { clientKey } from "../../../../../src/core/rate-limit.ts";
import { SESSION_COOKIE, currentSession } from "../../../../auth";
import { getLocale } from "../../../../i18n";
import { redirect303 } from "../../../redirect303";

/**
 * Retorno do Google ou do LinkedIn (#464, ADR-012).
 *
 * Route Handler pelo mesmo motivo do link mágico (`app/login/callback`):
 * começar sessão é mutação, e só Server Action ou Route Handler escrevem
 * cookie. O cookie do fluxo sai em qualquer desfecho — vale uma vez.
 *
 * Desfechos: sessão nova e destino do papel (ou o `next` seguro); pendência de
 * cadastro e `/signup`; vínculo pela conta e `/account`; ou `/login` com o
 * motivo, sempre por 303.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  if (isOpenMode()) return redirect303(request, "/login");

  const { provider } = await context.params;
  const jar = await cookies();
  const requestHeaders = await headers();
  const outcome = await finishSocialSignIn({
    provider,
    callbackUrl: new URL(request.url),
    sealedFlow: jar.get(FLOW_COOKIE)?.value ?? null,
    session: await currentSession(),
    clientIp: clientKey(requestHeaders),
    locale: await getLocale(),
    request: {
      host: requestHeaders.get("host"),
      proto: process.env.NODE_ENV === "production" ? "https" : "http",
    },
  });

  if (outcome.kind === "not_found") return new NextResponse(null, { status: 404 });

  jar.delete({ name: FLOW_COOKIE, path: "/login/oauth" });
  const secure = process.env.NODE_ENV === "production";
  if (outcome.kind === "session") {
    jar.set(SESSION_COOKIE, outcome.token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      expires: new Date(outcome.expiresAt),
    });
  } else if (outcome.kind === "signup") {
    jar.set(SIGNUP_COOKIE, outcome.token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/signup",
      expires: new Date(outcome.expiresAt),
    });
  }
  return redirect303(request, outcome.location);
}
