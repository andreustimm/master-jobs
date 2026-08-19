"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../../src/core/db/client.ts";
import { authEvent, authUser } from "../../src/core/db/schema.ts";
import { eq } from "drizzle-orm";
import { verifyLogin } from "../../src/contexts/auth/infra/password-login.ts";
import { drizzleSessions } from "../../src/contexts/auth/index.ts";
import { SESSION_COOKIE } from "../auth";

const SESSION_DAYS = 30;

/**
 * Password sign-in.
 *
 * A Server Action, because it mutates a cookie — the same boundary that made
 * the magic-link redemption a Route Handler.
 *
 * Deliberately unguarded: this is how a session begins, so requiring one would
 * be circular. It is also the only unauthenticated write in the system, which
 * is why the rate limit lives underneath it.
 */
export async function passwordLoginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  const result = await verifyLogin(email, password);

  if (!result.ok) {
    // One message for every failure. Distinguishing them would turn this form
    // into an account-enumeration oracle.
    redirect(`/login?error=${result.reason}`);
  }

  const db = getDb();
  const [user] = await db
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, result.identity.email))
    .limit(1);
  if (!user) redirect("/login?error=invalid");

  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  // A fresh token per login is what defeats fixation.
  const token = await drizzleSessions.create({ userId: user.id, expiresAt });
  await db.insert(authEvent).values({
    kind: "login",
    userId: user.id,
    email: result.identity.email,
    detail: "senha",
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });

  redirect("/");
}
