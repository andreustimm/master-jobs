import { NextResponse, type NextRequest } from "next/server";

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
const PUBLIC = ["/login", "/p"];

export function proxy(request: NextRequest) {
  if (process.env.JHO_AUTH_MODE === "open") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
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
