"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  askPasswordReset,
  recordResetSendFailure,
  resolvePublicOrigin,
} from "../../../src/contexts/auth/index.ts";
import { getLocale } from "../../i18n";
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

  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = resolvePublicOrigin(process.env, {
    host: (await headers()).get("host"),
    proto,
  });

  if (origin) {
    // O e-mail sai no idioma da conta; sem ele, no desta tela (US-020).
    await askPasswordReset(email, origin, await getLocale());
  } else {
    // Falha fechada (host poisoning, G17/G18): sem `JHO_PUBLIC_URL` num
    // deployment, o `Host` do cliente não é confiável para montar o link —
    // nenhum e-mail sai, e a resposta continua idêntica, para não revelar a
    // conta nem o defeito de configuração a quem pediu. O registro é
    // incondicional (nunca consulta se a conta existe), a mesma disciplina
    // de `requestPasswordReset` para as outras causas de falha de envio.
    console.warn(
      "[auth] ALERTA: recuperação de senha sem JHO_PUBLIC_URL configurada — nenhum link foi enviado.",
    );
    await recordResetSendFailure(email, "origem pública não configurada (JHO_PUBLIC_URL)");
  }

  await setMutationFeedbackCookie("success");
  redirect("/login/forgot?sent=1");
}
