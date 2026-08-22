"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  adminsBesides,
  beginImpersonation,
  createUser,
  deleteUser,
  endImpersonation,
  ROLES,
  setUserDisabled,
  updateUser,
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

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function parseEmail(formData: FormData): string {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("E-mail inválido.");
  return email;
}

/**
 * Nome como veio do formulário.
 *
 * Obrigatório, e limitado em 120 caracteres porque campo de texto livre sem
 * teto vira o jeito mais fácil de encher a tabela; o número é folgado para
 * qualquer nome real. Vazio é erro, e não `null`: a interface trata a pessoa
 * pelo nome, e deixar a conta sem ele a faz cair no e-mail em toda tela.
 */
function parseFullName(formData: FormData): string {
  const bruto = formData.get("fullName");
  const nome = String(bruto ?? "").trim().slice(0, 120);
  if (nome === "") throw new Error("O nome é obrigatório.");
  return nome;
}

function parseUserId(formData: FormData): number {
  const userId = Number(formData.get("userId"));
  if (!Number.isFinite(userId)) throw new Error("userId inválido");
  return userId;
}

export async function createUserAction(formData: FormData) {
  await guard("user:manage");

  const email = parseEmail(formData);
  const fullName = parseFullName(formData);

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
    ? await ensureCandidate({
        slug: `user-${email.replace(/[^a-z0-9]+/g, "-")}`,
        // O slug continua vindo do e-mail, que é único; só o nome exibido usa o
        // que a pessoa escreveu. Derivar o slug do nome deixaria dois "João
        // Silva" brigando pela mesma URL pública.
        name: fullName,
      })
    : null;

  await createUser({ email, fullName, roles, candidateId });
  revalidatePath("/admin/users");
}

export async function toggleDisabledAction(formData: FormData) {
  await guard("user:manage");

  const userId = parseUserId(formData);
  const disable = String(formData.get("disable")) === "1";

  if (disable && (await adminsBesides(userId)).length === 0) {
    throw new Error("Este é o último admin ativo. Promova outro antes de desabilitá-lo.");
  }

  await setUserDisabled(userId, disable);
  revalidatePath("/admin/users");
}

/**
 * Edita e-mail, nome e papéis de uma conta, numa transação de tela só.
 *
 * Substituiu o antigo `setRolesAction`, que salvava só os papéis a partir de um
 * formulário embutido na linha da lista. Uma ação por campo deixaria a tela num
 * estado meio aplicado quando a segunda falhasse, e o admin não teria como
 * saber qual parte pegou.
 *
 * NÃO aceita `candidateId`. Ver a nota em `createUserAction`: apontar uma conta
 * para o candidato de outra pessoa daria leitura do currículo e do funil dela
 * sem passar pela impersonação auditada.
 */
export async function updateUserAction(formData: FormData) {
  await guard("user:manage");

  const userId = parseUserId(formData);
  const email = parseEmail(formData);
  const fullName = parseFullName(formData);

  const roles = parseRoles(formData);
  if (roles.length === 0) throw new Error("Escolha ao menos um papel.");

  // A instalação não pode ficar sem admin. Sem esta checagem, tirar o próprio
  // papel deixaria o sistema sem ninguém capaz de criar contas ou desfazer a
  // mudança, e a recuperação seria SQL na mão.
  if (!roles.includes("admin") && (await adminsBesides(userId)).length === 0) {
    throw new Error("Este é o último admin ativo. Promova outro antes de rebaixá-lo.");
  }

  await updateUser(userId, { email, fullName, roles });
  revalidatePath("/admin/users");
}

/**
 * Apaga a conta. Irreversível.
 *
 * Duas recusas antes de qualquer escrita, e nenhuma é conveniência de tela:
 *
 * 1. **A própria conta, não.** Apagar a si mesmo derrubaria a sessão que está
 *    executando a ação; o efeito seria um erro no meio do caminho com a conta
 *    já removida. Quem quer sair usa desabilitar, que é reversível.
 * 2. **O último admin, não.** Mesma razão de sempre: sem admin, ninguém cria
 *    conta nem desfaz nada, e a recuperação vira SQL na mão.
 *
 * O que sobrevive é decisão das chaves estrangeiras, e está documentado em
 * `UserDirectory.remove`: sessão e token caem junto, auditoria e atribuição de
 * vaga viram nulo, e o candidato continua existindo.
 */
export async function deleteUserAction(formData: FormData) {
  const session = await guard("user:manage");
  const userId = parseUserId(formData);

  if (userId === session.userId) {
    throw new Error("Não é possível apagar a própria conta. Desabilite, ou peça a outro admin.");
  }

  if ((await adminsBesides(userId)).length === 0) {
    throw new Error("Este é o último admin ativo. Promova outro antes de apagá-lo.");
  }

  await deleteUser(userId);
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
