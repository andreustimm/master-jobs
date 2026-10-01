import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { finishLogin, isOpenMode } from "../../../src/contexts/auth/index.ts";
import { SESSION_COOKIE } from "../../auth";

function redirect303(request: NextRequest, location: string): NextResponse {
  // Navegações do App Router são RSC fetches. O redirect helper permite que
  // o Next transforme a URL absoluta em `x-nextjs-redirect`, que o cliente
  // usa para liberar a transição sem seguir uma resposta HTML como Flight.
  if (request.headers.get("RSC") === "1") {
    return NextResponse.redirect(new URL(location, request.url), { status: 303 });
  }
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

/**
 * Redeems a magic link and starts the session.
 *
 * A Route Handler, not the page: Next only allows cookies to be *modified* in a
 * Server Action or Route Handler, and redeeming a login is exactly a mutation.
 * Doing it while rendering `/login` threw
 * "Cookies can only be modified in a Server Action or Route Handler" — the
 * framework enforcing a boundary that is correct, since rendering should be
 * replayable and this is not.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (isOpenMode()) {
    return redirect303(request, "/login");
  }
  if (!token) {
    return redirect303(request, "/login?error=missing");
  }

  const result = await finishLogin(token);
  if (!result) {
    // Single-use and short-lived, so a second click legitimately lands here.
    return redirect303(request, "/login?error=invalid");
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    // No TLS on a loopback dev server; required everywhere else.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(result.session.expiresAt),
  });

  return redirect303(request, "/");
}
