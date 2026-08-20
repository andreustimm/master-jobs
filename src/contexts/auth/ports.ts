/**
 * Ports for the auth context.
 *
 * Two, because two absorb variation that is real:
 *
 *  - `SessionStore` — a table today. It becomes Redis the moment there is more
 *    than one process, which is the same reasoning as ADR 0009.
 *  - `IdentityProvider` — magic link today; OAuth or SSO later. The domain must
 *    not learn which.
 *
 * There is deliberately no port for hashing or for the clock: hashing has one
 * correct implementation and the clock already has `src/core/clock.ts`.
 */
import type { Role, Session } from "./domain/types.ts";

export type NewSession = {
  userId: number;
  expiresAt: string;
};

export type SessionStore = {
  /** Returns the raw token exactly once; only its hash is persisted. */
  create(input: NewSession): Promise<string>;
  /** Resolves a raw token to a session, or null when absent/expired/revoked. */
  resolve(token: string): Promise<Session | null>;
  revoke(token: string): Promise<void>;
  revokeAllFor(userId: number): Promise<number>;
  /** Housekeeping; expired rows are proof of nothing. */
  purgeExpired(): Promise<number>;
};

export type Identity = {
  userId: number;
  email: string;
  roles: Role[];
  candidateId: number | null;
};

export type IdentityProvider = {
  readonly name: string;
  /** Starts a login. Returns whatever the caller must deliver to the user. */
  begin(email: string): Promise<{ token: string; expiresAt: string }>;
  /** Completes a login, or null when the token is invalid, used or expired. */
  complete(token: string): Promise<Identity | null>;
};

export type AuthAuditInput = {
  kind: string;
  userId?: number | null;
  email?: string | null;
  detail?: string;
};

export type AuthRepository = {
  record(input: AuthAuditInput): Promise<void>;
  findUserId(email: string): Promise<number | null>;
};

export type PasswordResult =
  | { ok: true; identity: Identity }
  | { ok: false; reason: "invalid" | "rate_limited" };

export type PasswordVerifier = {
  verify(email: string, password: string): Promise<PasswordResult>;
};
