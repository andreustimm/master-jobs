"use server";

import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  INVITE_COOKIE,
  acceptRecruiterInvite,
  recruiterInviteCookie,
} from "../../../src/contexts/auth/index.ts";
import { guard } from "../../auth";
import { INVITE_COOKIE_PATH, requestOrigin } from "../../invite-arrival";

/**
 * As duas entradas da página do convite de recrutador (#465, ADR-018).
 *
 * O token vem do formulário da página, que o recebeu do link do e-mail. Ele
 * nunca vai para log: em erro, a resposta é a página neutra, sem o token.
 */

function tokenOf(formData: FormData): string | null {
  const value = formData.get("token");
  return typeof value === "string" ? value : null;
}

/**
 * "Criar conta de recrutador": guarda o token cru no cookie `jho_invite` e
 * leva ao cadastro com Recrutador marcado.
 *
 * **Sem `guard`, por desenho** — quem chega aqui ainda não tem conta. Está em
 * `UNGUARDED_BY_DESIGN` com o que substitui a permissão: o token de uso único
 * (32 bytes, só o hash no banco) conferido antes de gravar, e o cookie que não
 * concede nada sozinho — a conclusão exige a conta de recrutador com o e-mail
 * convidado provado.
 */
export async function startInvitedSignup(formData: FormData): Promise<void> {
  const token = tokenOf(formData);
  const cookie = await recruiterInviteCookie(token);
  // Link que não serve mais: a mesma página neutra de quem abriu o link morto.
  if (cookie === null || token === null) redirect("/signup/invite");
  (await cookies()).set(INVITE_COOKIE, token.trim(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: INVITE_COOKIE_PATH,
    // Nunca além da validade do convite: o cookie esquecido morre com ele.
    maxAge: cookie.maxAge,
  });
  redirect("/signup?role=recruiter");
}

/**
 * "Aceitar e abrir" (US-003.AC-5): a conta da sessão, de recrutador e com o
 * e-mail convidado, conclui o convite num clique. Recusa sessão emprestada e
 * conta sem o papel antes de qualquer efeito.
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const session = await guard("account:read");
  const location = await acceptRecruiterInvite(session, tokenOf(formData), await requestOrigin());
  redirect(location as Route);
}
