import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { finishLogin, isOpenMode } from "../../../src/contexts/auth/index.ts";
import { SESSION_COOKIE } from "../../auth";

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
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (isOpenMode()) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  }
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing", request.url), { status: 303 });
  }

  const result = await finishLogin(token);
  if (!result) {
    // Single-use and short-lived, so a second click legitimately lands here.
    return NextResponse.redirect(new URL("/login?error=invalid", request.url), { status: 303 });
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

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
