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
  /** Preenchido só quando um admin assume a identidade de alguém. */
  impersonatedBy?: number | null;
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
  /** Candidatos que este recrutador acompanha. Vazio para os outros papéis. */
  linkedCandidateIds: number[];
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

/** Resumo de uma conta, para a tela de administração. */
export type UserSummary = {
  id: number;
  email: string;
  roles: Role[];
  candidateId: number | null;
  disabledAt: string | null;
  createdAt: string;
  hasPassword: boolean;
};

/**
 * Gestão de contas.
 *
 * Porta separada de `IdentityProvider` porque responde outra pergunta: aquele
 * autentica, este administra. Juntá-los faria o provedor de login carregar
 * escrita de conta, que é justamente o que não se quer perto de um caminho de
 * autenticação.
 */
export type UserDirectory = {
  list(): Promise<UserSummary[]>;
  find(userId: number): Promise<UserSummary | null>;
  create(input: {
    email: string;
    roles: Role[];
    candidateId?: number | null;
  }): Promise<{ id: number }>;
  updateRoles(userId: number, roles: Role[]): Promise<void>;
  setDisabled(userId: number, disabled: boolean): Promise<void>;
  /** Candidatos que um recrutador acompanha. */
  linkedCandidates(recruiterUserId: number): Promise<number[]>;
  /** Vínculos com id, para a tela poder removê-los sem citar o candidato. */
  linksOf(recruiterUserId: number): Promise<{ id: number; candidateId: number }[]>;
  /**
   * Cria o vínculo.
   *
   * `candidateId` vem de quem CONSENTE, nunca do admin: ver a nota em
   * `drizzle-directory.ts` sobre por que admin não vincula.
   */
  linkCandidate(recruiterUserId: number, candidateId: number, by: number): Promise<void>;
  /** Remove pelo id do vínculo. Revogar acesso é seguro em qualquer direção. */
  unlinkById(linkId: number): Promise<void>;
};

export type PasswordResult =
  | { ok: true; identity: Identity }
  | { ok: false; reason: "invalid" | "rate_limited" };

export type PasswordVerifier = {
  verify(email: string, password: string): Promise<PasswordResult>;
};
