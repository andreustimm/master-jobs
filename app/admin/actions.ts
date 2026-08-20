"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  adminsBesides,
  beginImpersonation,
  createUser,
  endImpersonation,
  ROLES,
  setUserDisabled,
  setUserRoles,
  removeRecruiterLink,
  type Role,
} from "../../src/contexts/auth/index.ts";
import { ensureCandidate } from "../../src/core/candidate.ts";
import { ADMIN_COOKIE, currentSession, guard, SESSION_COOKIE } from "../auth";

/** Mesmas opções do cookie de sessão. Divergir aqui é como se perde httpOnly. */
function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

function parseRoles(formData: FormData): Role[] {
  const raw = formData.getAll("roles").map(String);
  // Validado contra a lista, não aceito como veio: papel é a coisa que decide
  // permissão, e uma string livre no formulário seria a própria brecha.
  return ROLES.filter((role) => raw.includes(role));
}

export async function createUserAction(formData: FormData) {
  await guard("user:manage");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido.");

  const roles = parseRoles(formData);
  if (roles.length === 0) throw new Error("Escolha ao menos um papel.");

  // O admin NÃO escolhe a qual candidato a conta se liga.
  //
  // Deixar esse id vir do formulário seria a segunda porta dos fundos deste
  // arquivo: criar uma conta apontada para o candidato de outra pessoa e entrar
  // nela daria acesso ao currículo e ao funil dela, sem passar pela
  // impersonação — que é o único caminho previsto, e o único que deixa rastro.
  //
  // Conta com papel de candidato ganha um candidato PRÓPRIO, novo, cujo slug
  // deriva do e-mail e portanto é dela.
  const candidateId = roles.includes("candidate")
    ? await ensureCandidate({ slug: `user-${email.replace(/[^a-z0-9]+/g, "-")}`, name: email })
    : null;

  await createUser({ email, roles, candidateId });
  revalidatePath("/admin/users");
}

export async function setRolesAction(formData: FormData) {
  const session = await guard("user:manage");

  const userId = Number(formData.get("userId"));
  if (!Number.isFinite(userId)) throw new Error("userId inválido");

  const roles = parseRoles(formData);
  if (roles.length === 0) throw new Error("Escolha ao menos um papel.");

  // A instalação não pode ficar sem admin. Sem esta checagem, tirar o próprio
  // papel deixaria o sistema sem ninguém capaz de criar contas ou desfazer a
  // mudança, e a recuperação seria SQL na mão.
  if (!roles.includes("admin") && (await adminsBesides(userId)).length === 0) {
    throw new Error("Este é o último admin ativo. Promova outro antes de rebaixá-lo.");
  }
  void session;

  await setUserRoles(userId, roles);
  revalidatePath("/admin/users");
}

export async function toggleDisabledAction(formData: FormData) {
  await guard("user:manage");

  const userId = Number(formData.get("userId"));
  const disable = String(formData.get("disable")) === "1";
  if (!Number.isFinite(userId)) throw new Error("userId inválido");

  if (disable && (await adminsBesides(userId)).length === 0) {
    throw new Error("Este é o último admin ativo. Promova outro antes de desabilitá-lo.");
  }

  await setUserDisabled(userId, disable);
  revalidatePath("/admin/users");
}

/**
 * Remove um vínculo recrutador↔candidato.
 *
 * O admin **revoga** acesso, mas não o concede: criar o vínculo mora na área do
 * candidato, porque ele dá leitura de currículo e funil. Um admin capaz de
 * criá-lo leria dado alheio por procuração — bastaria vincular a si mesmo como
 * recrutador —, desviando da impersonação auditada, que é o único caminho
 * previsto para isso.
 *
 * Recebe o id do VÍNCULO, não o par recrutador+candidato: assim nenhuma tela de
 * administração precisa passar um id de candidato adiante.
 */
export async function unlinkAction(formData: FormData) {
  await guard("user:manage");
  const linkId = Number(formData.get("linkId"));
  if (!Number.isFinite(linkId)) throw new Error("Vínculo inválido");
  await removeRecruiterLink(linkId);
  revalidatePath("/admin/users");
}

/**
 * Assume a identidade de outra conta.
 *
 * A autorização vive em `beginImpersonation`, que a checa contra a sessão antes
 * de qualquer escrita — inclusive negando quem já está de empréstimo, porque
 * assumir é ação de administração e sessão emprestada não administra.
 */
export async function impersonateAction(formData: FormData) {
  // Guard aqui além da checagem dentro do caso de uso. Redundante de propósito:
  // Server Action é endpoint HTTP público, e a garantia não deve depender de
  // uma função interna continuar chamando `authorize`.
  await guard("user:impersonate");
  const session = await currentSession();
  const targetUserId = Number(formData.get("userId"));
  if (!Number.isFinite(targetUserId)) throw new Error("userId inválido");

  const result = await beginImpersonation(session, targetUserId);
  if (!result.ok) throw new Error(`Não foi possível assumir: ${result.reason}`);

  const jar = await cookies();
  const adminToken = jar.get(SESSION_COOKIE)?.value;
  if (adminToken) {
    // Estacionado com a validade da sessão emprestada: se o admin abandonar o
    // empréstimo, o cookie de volta não sobrevive além dele.
    jar.set(ADMIN_COOKIE, adminToken, cookieOptions(new Date(result.expiresAt)));
  }
  jar.set(SESSION_COOKIE, result.token, cookieOptions(new Date(result.expiresAt)));

  redirect("/");
}

/** Encerra o empréstimo e devolve o admin à própria sessão. */
export async function stopImpersonatingAction() {
  const jar = await cookies();
  const borrowedToken = jar.get(SESSION_COOKIE)?.value ?? "";
  const borrowed = await currentSession();

  await endImpersonation(borrowed, borrowedToken);

  const adminToken = jar.get(ADMIN_COOKIE)?.value;
  if (adminToken) {
    jar.set(SESSION_COOKIE, adminToken, cookieOptions(new Date(Date.now() + 30 * 86_400_000)));
  } else {
    jar.delete(SESSION_COOKIE);
  }
  jar.delete(ADMIN_COOKIE);

  // Ramos separados porque o tipo de rota do Next 16 é literal: uma ternária
  // colapsa os dois em união e não casa com a assinatura.
  if (adminToken) redirect("/admin/users");
  redirect("/login");
}
