/**
 * The auth context, composed.
 *
 * Callers get functions and never see a port. Composition by function, no
 * container — which would be illegal under the erasable-TypeScript rule anyway.
 */
import { drizzleSessions, magicLink } from "./infra/drizzle-store.ts";
import {
  beginLogin,
  completeLogin,
  isSingleUser,
  logout,
  singleUserSession,
  type AuthDeps,
  type LoginResult,
} from "./app/session.ts";
import type { Session } from "./domain/types.ts";

export { can, authorize, candidateScope, AuthorizationError } from "./domain/policy.ts";
export type { Action, Decision, Resource, Role, Session } from "./domain/types.ts";
export { ACTIONS, ROLES } from "./domain/types.ts";
export { isSingleUser, singleUserSession } from "./app/session.ts";

const deps: AuthDeps = { sessions: drizzleSessions, identity: magicLink };

export function startLogin(email: string): Promise<{ token: string; expiresAt: string }> {
  return beginLogin(email, deps);
}

export function finishLogin(token: string): Promise<LoginResult> {
  return completeLogin(token, deps);
}

export function endSession(token: string): Promise<void> {
  return logout(token, deps);
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
  if (isSingleUser()) return singleUserSession(candidateId);
  if (!token) return null;
  return drizzleSessions.resolve(token);
}

export { drizzleSessions };
