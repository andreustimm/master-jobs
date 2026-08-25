"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { completePasswordReset } from "../../../src/contexts/auth/index.ts";
import { setMutationFeedbackCookie } from "../../mutation-feedback-server";

/**
 * Grava a senha nova.
 *
 * Sem guard: o token É a autorização. Exigir sessão aqui seria pedir que a
 * pessoa entrasse para poder recuperar a senha de que não se lembra.
 */
export async function submitResetAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  const host = (await headers()).get("host") ?? "127.0.0.1:3000";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const result = await completePasswordReset(token, password, `${proto}://${host}`);

  if (result.ok) {
    await setMutationFeedbackCookie("success");
    redirect("/login?reset=1");
  }
  // O motivo volta na URL porque a tela precisa distinguir "senha curta" de
  // "link morto": a primeira se corrige aqui mesmo, a segunda exige outro link.
  redirect(`/login/reset?token=${encodeURIComponent(token)}&error=${result.reason}`);
}
