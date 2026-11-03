"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  cancelRecruiterInvite,
  dismissRecruiterInvite,
  grantRecruiterAccess,
  resendRecruiterInvite,
  resolvePublicOrigin,
  revokeRecruiterAccess,
  setRecruiterGrantEndDate,
  type AccessResultSimple,
  type GrantResult,
} from "../../src/contexts/auth/index.ts";
import { guardOwnCandidate } from "../auth";

/**
 * As escritas da seção "Acesso de recrutadores" de `/account` (#465).
 *
 * Toda action começa por `guardOwnCandidate("access:manage")`: o candidato vem
 * da sessão, nunca do formulário (G40), e a política nega a sessão emprestada
 * antes de qualquer efeito (G24) — o admin que assume alguém vê a seção, mas
 * não concede, revoga nem convida em nome dele. O id que o formulário manda é
 * da concessão ou do convite, e o store só o procura dentro do candidato da
 * sessão: o de outra pessoa responde `not_found`, igual ao que não existe.
 */

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

function idOf(formData: FormData, name: string): number {
  const value = Number(formData.get(name));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * Origem dos links do e-mail (G17): `JHO_PUBLIC_URL` ou a da plataforma; o
 * `Host` da requisição só na máquina do dono. Nula, o e-mail com link não sai
 * e a falha fica registrada.
 */
async function origin(): Promise<string | null> {
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  return resolvePublicOrigin(process.env, { host: (await headers()).get("host"), proto });
}

export async function grantRecruiterAccessAction(formData: FormData): Promise<GrantResult> {
  const { session } = await guardOwnCandidate("access:manage");
  const result = await grantRecruiterAccess(
    session,
    { email: text(formData, "email"), endDate: text(formData, "endDate"), tz: text(formData, "tz") },
    await origin(),
  );
  if (result.ok) revalidatePath("/account");
  return result;
}

export async function revokeRecruiterAccessAction(formData: FormData): Promise<AccessResultSimple> {
  const { session } = await guardOwnCandidate("access:manage");
  const result = await revokeRecruiterAccess(session, idOf(formData, "grantId"));
  revalidatePath("/account");
  return result;
}

export async function setGrantEndDateAction(formData: FormData): Promise<AccessResultSimple> {
  const { session } = await guardOwnCandidate("access:manage");
  const result = await setRecruiterGrantEndDate(
    session,
    { grantId: idOf(formData, "grantId"), endDate: text(formData, "endDate"), tz: text(formData, "tz") },
    await origin(),
  );
  revalidatePath("/account");
  return result;
}

export async function resendInviteAction(formData: FormData): Promise<AccessResultSimple> {
  const { session } = await guardOwnCandidate("access:manage");
  const result = await resendRecruiterInvite(session, idOf(formData, "inviteId"), await origin());
  revalidatePath("/account");
  return result;
}

export async function cancelInviteAction(formData: FormData): Promise<AccessResultSimple> {
  const { session } = await guardOwnCandidate("access:manage");
  const result = await cancelRecruiterInvite(session, idOf(formData, "inviteId"));
  revalidatePath("/account");
  return result;
}

export async function dismissInviteAction(formData: FormData): Promise<AccessResultSimple> {
  const { session } = await guardOwnCandidate("access:manage");
  const result = await dismissRecruiterInvite(session, idOf(formData, "inviteId"));
  revalidatePath("/account");
  return result;
}
