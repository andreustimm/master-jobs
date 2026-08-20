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
export { canReadPublicProfile } from "./domain/policy.ts";
export { VISIBILITIES, isVisibility, ADMIN_ACTIONS } from "./domain/types.ts";
export type { Visibility } from "./domain/types.ts";
export type { UserSummary } from "./ports.ts";
export { IMPERSONATION_HOURS } from "./app/impersonation.ts";

import { drizzleUserDirectory, otherActiveAdmins } from "./infra/drizzle-directory.ts";
import {
  startImpersonation,
  stopImpersonation,
  type ImpersonationDeps,
} from "./app/impersonation.ts";
import type { Role } from "./domain/types.ts";

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

export function createUser(input: { email: string; roles: Role[]; candidateId?: number | null }) {
  return drizzleUserDirectory.create(input);
}

export function setUserRoles(userId: number, roles: Role[]) {
  return drizzleUserDirectory.updateRoles(userId, roles);
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

/* ----------------------------- Impersonação ------------------------------- */

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
