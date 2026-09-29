"use server";

import { redirect } from "next/navigation";
import { completePasswordReset, resolvePublicOrigin } from "../../../src/contexts/auth/index.ts";
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

  // `completePasswordReset` monta o mesmo `baseUrl` de `askPasswordReset` por
  // simetria, mas o resgate da senha nunca chega a montar um link com ele —
  // só o pedido de recuperação envia e-mail. Mesmo assim, este arquivo nunca
  // lê o `Host` do cliente: `resolvePublicOrigin` sem `request.host` só
  // resolve pela variável configurada ou pelo loopback local, nunca por
  // entrada do cliente — host poisoning não tem onde entrar aqui, hoje nem
  // se o resgate vier a montar um link no futuro.
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = resolvePublicOrigin(process.env, { host: null, proto }) ?? `${proto}://127.0.0.1:3000`;
  const result = await completePasswordReset(token, password, origin);

  if (result.ok) {
    await setMutationFeedbackCookie("success");
    redirect("/login?reset=1");
  }
  // O motivo volta na URL porque a tela precisa distinguir "senha curta" de
  // "link morto": a primeira se corrige aqui mesmo, a segunda exige outro link.
  redirect(`/login/reset?token=${encodeURIComponent(token)}&error=${result.reason}`);
}
