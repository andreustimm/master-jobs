import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { endSession } from "../../src/contexts/auth/index.ts";
import { SESSION_COOKIE } from "../auth";

/**
 * Logout.
 *
 * Revokes server-side before clearing the cookie. Clearing only the cookie
 * would leave the token valid for anyone who copied it — which is exactly the
 * case logout exists to close.
 */
export async function POST(request: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await endSession(token);
  jar.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
