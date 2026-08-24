import { NextResponse, type NextRequest } from "next/server";
import { clientKey, createRateLimiter } from "./src/core/rate-limit.ts";

/**
 * First barrier: no session cookie, no page.
 *
 * Two layers guard the app, and this is the cheap one. Proxy only asks whether
 * a session cookie is present; it cannot tell a valid token from a forged one.
 * The authoritative check happens in `requireSession()` on every protected
 * page or route, where the token is resolved against the database.
 *
 * Why both: the page-level check has full accuracy, while this boundary has
 * full route coverage. Neither is treated as a substitute for the other.
 */

const SESSION_COOKIE = "jho_session";

/** Reachable without a session, by necessity. */
// Cada entrada aqui é um furo deliberado na rede grossa, por isso a lista é
// curta. `/p` é o portfólio: responde sem sessão, e o que ele mostra é decidido
// por lista de permissão em `publicProfile()`, não por esta linha.
// `/offline.html` é gerado sem layout ou sessão e instalado sem credenciais.
// Exigir sessão aqui transformaria a entrada segura num redirect autenticado.
const PUBLIC = [
  "/login",
  "/p",
  "/offline.html",
  "/manifest.json",
  "/icons",
  "/sw.js",
  // `/api/cron` passa por aqui porque a Vercel a chama SEM cookie — o guard de
  // sessão a bloquearia sempre. Ela não fica desprotegida: autentica-se com
  // `CRON_SECRET` em `authorization`, comparado em tempo constante, e responde
  // 503 quando o segredo não está configurado. Fechada por omissão, e não
  // aberta.
  "/api/cron",
];

/**
 * Limite por IP no portfólio público.
 *
 * Mora AQUI e não na página por duas razões. A primeira é de camada: um Server
 * Component não devolve 429 com `Retry-After` — `notFound()` e `forbidden()`
 * existem, um equivalente para "excedeu" não. A segunda é de custo: limitar
 * depois de renderizar pagaria exatamente o que o limite existe para evitar,
 * porque a consulta ao banco já teria acontecido.
 *
 * 30 em 5 minutos: generoso para quem abriu o link que o candidato mandou —
 * cabe recarregar, voltar e abrir em abas — e caro para quem varre nomes.
 *
 * Conta ANTES de saber se o perfil existe. Contar só o 404 diria ao varredor
 * que ele foi detectado; contar só o 200 deixaria livre a varredura de nomes
 * inexistentes, que é justamente a varredura.
 */
const publicProfileLimiter = createRateLimiter({ limit: 30, windowMs: 5 * 60_000 });

export function proxy(request: NextRequest) {
  if (process.env.JHO_AUTH_MODE === "open") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (pathname === "/p" || pathname.startsWith("/p/")) {
    const decision = publicProfileLimiter.check(clientKey(request.headers));
    if (!decision.allowed) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        // Sem `Retry-After` o cliente não sabe quando voltar e tenta em laço —
        // o limite viraria mais tráfego, não menos.
        headers: { "retry-after": String(decision.retryAfterSeconds) },
      });
    }
    return NextResponse.next();
  }

  if (PUBLIC.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // API routes are included: exporting the corpus without a cookie is the same
  // confidentiality failure as rendering a protected page.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
