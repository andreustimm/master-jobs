import { NextResponse, type NextRequest } from "next/server";

/**
 * First barrier: no session cookie, no page.
 *
 * Two layers guard the app, and this is the cheap one. Middleware runs on the
 * Edge runtime and cannot open the database, so it only asks whether a session
 * cookie is *present* — it cannot tell a valid token from a forged one. The
 * real check happens in `requireSession()` on each page, which resolves the
 * token against the database.
 *
 * Why both: the page-level check is authoritative but easy to forget on a new
 * route, and a forgotten check on a page that reads the funnel is a silent
 * leak. This catches every route by default, including ones nobody remembered
 * to guard. Defence in depth, where the cheap layer has full coverage and the
 * expensive layer has full accuracy.
 */

const SESSION_COOKIE = "jho_session";

/** Reachable without a session, by necessity. */
const PUBLIC = ["/login"];

export function middleware(request: NextRequest) {
  // Autenticação é o padrão. O modo aberto precisa ser pedido explicitamente,
  // porque "só roda em loopback" não é uma barreira — é uma suposição sobre
  // como o servidor foi iniciado.
  if (process.env.JHO_AUTH_MODE === "open") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets. API routes are included on purpose:
  // an unauthenticated export of the job corpus is the same leak as the page.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
