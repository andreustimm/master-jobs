import { NextResponse, type NextRequest } from "next/server";
import { openModeActive } from "./src/contexts/auth/domain/open-mode.ts";
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
  // Inclui `/login/oauth/<provedor>` e `/login/oauth/<provedor>/callback`, o
  // início e o retorno do login social (#464): a autorização ali é o fluxo
  // OIDC (cookie cifrado, `state`, PKCE), e o `intent=link` resolve a sessão
  // na própria rota.
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

/**
 * Foto e capa (#327) em balde próprio. Cada visita ao perfil pede a página e
 * até duas imagens; no mesmo balde, dez visitas esgotariam o limite de quem
 * só abriu o link algumas vezes. O balde das imagens comporta as duas por
 * visita.
 *
 * **Custo declarado.** Uma varredura de endereços que bata na rota da imagem
 * NÃO gasta o balde da página: por IP, são até 30 sondas pela página e mais
 * 60 pela imagem a cada 5 minutos. O preferível seria o 404 da imagem gastar
 * também o balde da página, mas o proxy decide ANTES de a rota saber a
 * resposta, e proxy e rota não compartilham memória confiável (na Vercel,
 * podem rodar em funções diferentes). O que a sonda pela imagem aprende é
 * menos do que pela página: responde 200 só para perfil público COM imagem
 * marcada para mostrar, e o mesmo 404 para todo o resto.
 */
const publicImageLimiter = createRateLimiter({ limit: 60, windowMs: 5 * 60_000 });
const PUBLIC_IMAGE_PATH = /^\/p\/[^/]+\/image\/[^/]+$/;

export function proxy(request: NextRequest) {
  // Mesma regra de `isOpenMode()`, importada do domínio e não da composição:
  // a borda não pode puxar o banco. Em deployment, `open` é ignorado e a rede
  // grossa continua valendo — ver `src/contexts/auth/domain/open-mode.ts`.
  if (openModeActive(process.env)) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (pathname === "/p" || pathname.startsWith("/p/")) {
    const limiter = PUBLIC_IMAGE_PATH.test(pathname) ? publicImageLimiter : publicProfileLimiter;
    const decision = limiter.check(clientKey(request.headers));
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
  // O endereço pedido viaja como `next`, para o login social devolver a pessoa
  // a ele (US-001.EC-8). Só página navegada: API não tem para onde voltar. Quem
  // segue o `next` o confere de novo com `safeNext` — aqui ele é só recado.
  if (request.method === "GET" && !pathname.startsWith("/api/") && pathname !== "/") {
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  }
  return NextResponse.redirect(url);
}

export const config = {
  // API routes are included: exporting the corpus without a cookie is the same
  // confidentiality failure as rendering a protected page.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
