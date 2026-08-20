"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { passwordSignIn } from "../../src/contexts/auth/index.ts";
import { SESSION_COOKIE } from "../auth";

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

  const result = await passwordSignIn(email, password);

  if (!result.ok) {
    // One message for every failure. Distinguishing them would turn this form
    // into an account-enumeration oracle.
    redirect(`/login?error=${result.reason}`);
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(result.session.expiresAt),
  });

  // Para onde cada papel vai.
  //
  // O cockpit é a tela do candidato: funil, lacunas do currículo, nota de
  // aderência. Quem não é candidato não tem nada lá — e mandar todo mundo para
  // `/` era o que fazia um recrutador cair em 403 logo depois de acertar a
  // senha.
  if (result.session.candidateId !== null) redirect("/");
  redirect("/jobs");
}
