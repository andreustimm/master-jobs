"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { changePasswordForSession, renameForSession } from "../../src/contexts/auth/index.ts";
import { guard, SESSION_COOKIE } from "../auth";
import type { AccountStatus } from "./status";

/**
 * As escritas da própria conta.
 *
 * Nenhuma aceita id: a conta é sempre a da sessão que `guard` devolveu. Um
 * `userId` no formulário seria pedido, não prova — e com ele uma requisição
 * feita à mão trocaria a senha de qualquer um.
 *
 * `account:write` é negado à sessão emprestada pela política, antes de papel
 * nenhum: o admin que assume alguém não troca senha, e-mail nem nome do alvo.
 */

function back(status: AccountStatus): never {
  redirect(`/account?status=${status}`);
}

export async function renameAction(formData: FormData) {
  const session = await guard("account:write");

  // Mesmo teto do cadastro de admin: nome real cabe folgado em 120, e campo
  // livre sem teto vira o jeito mais fácil de encher a tabela.
  const fullName = String(formData.get("fullName") ?? "").trim().slice(0, 120);
  if (fullName === "") back("name-required");

  await renameForSession(session, fullName);
  // O nome aparece no topo de toda tela, então o layout inteiro revalida.
  revalidatePath("/", "layout");
  back("name-saved");
}

export async function changePasswordAction(formData: FormData) {
  const session = await guard("account:write");

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  // Conferida aqui, e não no domínio: é erro de digitação na tela, não regra
  // de senha, e não consome tentativa.
  if (next !== confirm) back("password-mismatch");

  const result = await changePasswordForSession(session, current, next);
  if (!result.ok) back(`password-${result.reason}`);

  // Todas as sessões caíram, inclusive a deste cookie. A nova entra no lugar,
  // com as mesmas opções do login — divergir aqui é como se perde httpOnly.
  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(result.expiresAt),
  });
  back("password-changed");
}
