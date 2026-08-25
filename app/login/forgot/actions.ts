"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { askPasswordReset } from "../../../src/contexts/auth/index.ts";
import { setMutationFeedbackCookie } from "../../mutation-feedback-server";

/**
 * Pede o link de recuperação.
 *
 * Sem guard, e de propósito: quem esqueceu a senha não tem sessão. É o mesmo
 * caso de `passwordLoginAction`, que o teste de arquitetura já lista como
 * desguardada por desenho.
 *
 * Redireciona SEMPRE para a mesma tela de confirmação, com ou sem conta. A
 * disciplina de não revelar quem está cadastrado só vale se a URL final também
 * não revelar.
 */
export async function requestResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");

  const host = (await headers()).get("host") ?? "127.0.0.1:3000";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  await askPasswordReset(email, `${proto}://${host}`);

  await setMutationFeedbackCookie("success");
  redirect("/login/forgot?sent=1");
}
