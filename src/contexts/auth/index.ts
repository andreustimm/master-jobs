/**
 * The auth context, composed.
 *
 * Callers get functions and never see a port. Composition by function, no
 * container — which would be illegal under the erasable-TypeScript rule anyway.
 */
import {
  drizzleAuthRepository,
  drizzleSessions,
  magicLink,
} from "./infra/drizzle-store.ts";
import { drizzlePasswords } from "./infra/password-login.ts";
import {
  beginLogin,
  completeLogin,
  isOpenMode,
  loginWithPassword,
  logout,
  revokeAllSessionsForEmail,
  singleUserSession,
  type AuthDeps,
  type LoginResult,
} from "./app/session.ts";
import type { Session } from "./domain/types.ts";

export { can, authorize, candidateScope, AuthorizationError } from "./domain/policy.ts";
export { checkPassword, MIN_LENGTH } from "./domain/password.ts";
export type { Action, Decision, Resource, Role, Session } from "./domain/types.ts";
export { ACTIONS, ROLES } from "./domain/types.ts";
export { isOpenMode, isSingleUser, singleUserSession, SESSION_DAYS } from "./app/session.ts";
export { generatePassword, seedOwner } from "./app/seed.ts";
export type { SeedResult } from "./app/seed.ts";
export { setPassword, verifyLogin } from "./infra/password-login.ts";
import { setPassword } from "./infra/password-login.ts";
export { canReadPublicProfile } from "./domain/policy.ts";
export { VISIBILITIES, isVisibility, ADMIN_ACTIONS } from "./domain/types.ts";
export type { Visibility } from "./domain/types.ts";
export type { UserSummary } from "./ports.ts";
export { IMPERSONATION_HOURS } from "./app/impersonation.ts";
export { RESET_MINUTES, RESET_MAX_PER_HOUR } from "./app/password-reset.ts";
export type { Mailer, OutgoingMail, MailResult } from "./ports-mailer.ts";
export { configuredMailer, consoleMailer, resendMailer } from "./infra/resend-mailer.ts";

import { drizzleUserDirectory, otherActiveAdmins } from "./infra/drizzle-directory.ts";
import { hashToken, issueResetToken } from "./infra/drizzle-store.ts";
import { configuredMailer } from "./infra/resend-mailer.ts";
import {
  isResetTokenLive,
  redeemPasswordReset,
  requestPasswordReset,
  type ResetDeps,
} from "./app/password-reset.ts";
import {
  startImpersonation,
  stopImpersonation,
  type ImpersonationDeps,
} from "./app/impersonation.ts";
import type { Role } from "./domain/types.ts";
import { changeOwnPassword } from "./infra/password-login.ts";
import { AuthorizationError } from "./domain/policy.ts";
import { SESSION_DAYS } from "./app/session.ts";
import { clock } from "../../core/clock.ts";
export { MAX_CHANGE_ATTEMPTS } from "./infra/password-login.ts";

const deps: AuthDeps = {
  sessions: drizzleSessions,
  identity: magicLink,
  passwords: drizzlePasswords,
  repository: drizzleAuthRepository,
};

export function startLogin(email: string): Promise<{ token: string; expiresAt: string }> {
  return beginLogin(email, deps);
}

export function finishLogin(token: string): Promise<LoginResult> {
  return completeLogin(token, deps);
}

export function endSession(token: string): Promise<void> {
  return logout(token, deps);
}

export function passwordSignIn(email: string, password: string) {
  return loginWithPassword(email, password, deps);
}

export function revokeUserSessions(email: string): Promise<number | null> {
  return revokeAllSessionsForEmail(email, deps);
}

/* ----------------------------- Gestão de contas --------------------------- */

const directoryDeps: ImpersonationDeps = {
  sessions: drizzleSessions,
  users: drizzleUserDirectory,
  audit: drizzleAuthRepository,
};

export function listUsers() {
  return drizzleUserDirectory.list();
}

export function findUser(userId: number) {
  return drizzleUserDirectory.find(userId);
}

export function createUser(input: {
  email: string;
  fullName?: string | null;
  roles: Role[];
  candidateId?: number | null;
}) {
  return drizzleUserDirectory.create(input);
}

export function setUserRoles(userId: number, roles: Role[]) {
  return drizzleUserDirectory.updateRoles(userId, roles);
}

/**
 * Edita os dados da conta. Campo ausente fica como está.
 *
 * Não recebe `candidateId` de propósito, pela mesma razão que `createUser` não
 * o aceita do formulário: apontar uma conta para o candidato de outra pessoa
 * daria acesso ao currículo e ao funil dela sem passar pela impersonação
 * auditada, que é o único caminho previsto.
 */
export function updateUser(
  userId: number,
  patch: { email?: string; fullName?: string | null; roles?: Role[] },
) {
  return drizzleUserDirectory.update(userId, patch);
}

/**
 * Apaga a conta, de vez.
 *
 * Quem chama precisa ter checado antes que não é o último admin e que não é a
 * própria conta — as duas regras moram na ação, junto do `guard`, porque são
 * decisões sobre a sessão de quem pediu, e esta função não conhece sessão.
 */
export function deleteUser(userId: number) {
  return drizzleUserDirectory.remove(userId);
}

export function setUserDisabled(userId: number, disabled: boolean) {
  return drizzleUserDirectory.setDisabled(userId, disabled);
}

/** Vínculos de um recrutador, com id. Para a tela listar e remover. */
export function recruiterLinks(recruiterUserId: number) {
  return drizzleUserDirectory.linksOf(recruiterUserId);
}

/**
 * Vincula um recrutador ao candidato.
 *
 * Só o próprio candidato chama — o vínculo dá leitura de currículo e funil, e
 * admin criando um leria dado alheio por procuração.
 */
export function linkRecruiterToCandidate(recruiterUserId: number, candidateId: number, by: number) {
  return drizzleUserDirectory.linkCandidate(recruiterUserId, candidateId, by);
}

/** Remove um vínculo. Revogar acesso é seguro vindo de admin ou do candidato. */
export function removeRecruiterLink(linkId: number) {
  return drizzleUserDirectory.unlinkById(linkId);
}

/**
 * Admins ativos além deste. Zero significa que ele é o último — e a instalação
 * não pode ficar sem ninguém capaz de criar contas.
 */
export function adminsBesides(userId: number) {
  return otherActiveAdmins(userId);
}

/* ------------------------------- Minha conta ------------------------------- */

export type OwnPasswordResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; reason: "invalid" | "weak" | "rate_limited" | "unavailable" | "no_password" };

/**
 * Sessão emprestada nunca chega à escrita da conta.
 *
 * A política já nega `account:write` a ela, e a ação chama `guard` antes. Esta
 * segunda barreira existe porque a função recebe a sessão como argumento e
 * pode ser chamada de outro lugar amanhã: quem esquecer o `guard` ainda não
 * troca a senha do alvo.
 */
function assertOwnSession(session: Session): void {
  if (session.impersonatedBy !== null) {
    throw new AuthorizationError("account:write", "sessão emprestada não altera a conta do alvo");
  }
}

/**
 * Troca a senha da conta DA SESSÃO, provando a atual.
 *
 * Todas as sessões da conta caem, inclusive a que pediu; em seguida nasce uma
 * sessão nova, cujo token quem chama grava no cookie. O efeito para a pessoa é
 * "as outras sessões caíram e eu continuo dentro", e o token antigo deste
 * navegador também deixa de valer — um cookie copiado antes da troca não
 * sobrevive a ela.
 */
export async function changePasswordForSession(
  session: Session,
  currentPassword: string,
  newPassword: string,
): Promise<OwnPasswordResult> {
  assertOwnSession(session);
  const result = await changeOwnPassword(session.userId, currentPassword, newPassword);
  if (!result.ok) return result;
  const expiresAt = new Date(clock().now() + SESSION_DAYS * 86_400_000).toISOString();
  const token = await drizzleSessions.create({ userId: session.userId, expiresAt });
  await drizzleAuthRepository.record({
    kind: "login",
    userId: session.userId,
    email: result.email,
    detail: "sessão renovada após troca de senha",
  });
  return { ok: true, token, expiresAt };
}

/**
 * Troca o nome de exibição da conta DA SESSÃO.
 *
 * Só o nome. O e-mail é o identificador de entrada e o destino da recuperação
 * de senha; trocá-lo sem confirmar a posse do endereço novo deixaria uma
 * sessão roubada redirecionar a recuperação para o atacante. Enquanto não
 * houver confirmação por e-mail em produção, e-mail muda só por admin
 * (`docs/security.md`).
 */
export async function renameForSession(session: Session, fullName: string): Promise<void> {
  assertOwnSession(session);
  await drizzleUserDirectory.update(session.userId, { fullName });
  await drizzleAuthRepository.record({
    kind: "profile_updated",
    userId: session.userId,
    email: session.email,
    detail: "nome de exibição alterado pela própria conta",
  });
}

/* ----------------------------- Impersonação ------------------------------- */

/* --------------------------- Recuperar a senha ---------------------------- */

function resetDeps(baseUrl: string): ResetDeps {
  return {
    mailer: configuredMailer(),
    audit: drizzleAuthRepository,
    sessions: drizzleSessions,
    linkFor: (token) => `${baseUrl}/login/reset?token=${encodeURIComponent(token)}`,
    setPassword,
    issue: issueResetToken,
  };
}

/**
 * Pede a recuperação. **Sempre devolve `{ sent: true }`.**
 *
 * O retorno confirma que o pedido foi aceito, não que a conta existe. Quem
 * chama não consegue distinguir os dois casos, e é assim de propósito: um
 * formulário que responde "não encontramos esta conta" é um oráculo de
 * enumeração aberto ao mundo.
 */
export function askPasswordReset(email: string, baseUrl: string) {
  return requestPasswordReset(email, resetDeps(baseUrl));
}

/** O link ainda serve? Consulta sem consumir, para a tela avisar antes. */
export function resetTokenIsLive(token: string) {
  return isResetTokenLive(token, hashToken);
}

export function completePasswordReset(token: string, newPassword: string, baseUrl: string) {
  return redeemPasswordReset(token, newPassword, hashToken, resetDeps(baseUrl));
}

export function beginImpersonation(actor: Session | null, targetUserId: number) {
  return startImpersonation(actor, targetUserId, directoryDeps);
}

export function endImpersonation(borrowed: Session | null, token: string) {
  return stopImpersonation(borrowed, token, directoryDeps);
}

/**
 * The session for the current request.
 *
 * In single-user mode this synthesises one rather than returning null, so every
 * call site can treat "who is this" identically in both modes. The guard is the
 * same code path either way — a multi-user branch that only runs in production
 * is a branch nobody has tested.
 */
export async function resolveSession(
  token: string | null,
  candidateId: number | null = null,
): Promise<Session | null> {
  if (isOpenMode()) return singleUserSession(candidateId);
  if (!token) return null;
  return drizzleSessions.resolve(token);
}
