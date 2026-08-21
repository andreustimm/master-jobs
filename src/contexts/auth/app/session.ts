/**
 * Use cases: sign in, sign out, and answer "who is this".
 *
 * Orchestration only. The decision lives in `domain/policy.ts`, the storage in
 * `infra/`, and this file just moves between them.
 */
import { clock } from "../../../core/clock.ts";
import type {
  AuthRepository,
  IdentityProvider,
  PasswordVerifier,
  SessionStore,
} from "../ports.ts";
import type { Role, Session } from "../domain/types.ts";

export type AuthDeps = {
  sessions: SessionStore;
  identity: IdentityProvider;
  passwords: PasswordVerifier;
  repository: AuthRepository;
};

export const SESSION_DAYS = 30;

/**
 * Records what happened, never how.
 *
 * A token, a cookie or a key in an audit log turns the log into a credential
 * store — and logs are the thing people paste into issues.
 */
async function record(
  kind: string,
  input: { userId?: number | null; email?: string | null; detail?: string },
  deps: AuthDeps,
): Promise<void> {
  await deps.repository.record({ kind, ...input });
}

export async function beginLogin(
  email: string,
  deps: AuthDeps,
): Promise<{ token: string; expiresAt: string }> {
  return deps.identity.begin(email);
}

export type LoginResult = { token: string; session: Session } | null;

export async function completeLogin(loginToken: string, deps: AuthDeps): Promise<LoginResult> {
  const identity = await deps.identity.complete(loginToken);
  if (!identity) {
    await record("login_failed", { detail: "token inválido, usado ou expirado" }, deps);
    return null;
  }

  const expiresAt = new Date(clock().now() + SESSION_DAYS * 86_400_000).toISOString();
  // A fresh token on every login is what defeats session fixation: a value the
  // attacker planted before authentication is not the value that ends up valid.
  const token = await deps.sessions.create({ userId: identity.userId, expiresAt });

  await record("login", { userId: identity.userId, email: identity.email }, deps);

  return {
    token,
    session: {
      userId: identity.userId,
      candidateId: identity.candidateId,
      roles: identity.roles,
      email: identity.email,
      fullName: identity.fullName,
      expiresAt,
      linkedCandidateIds: identity.linkedCandidateIds,
      impersonatedBy: null,
    },
  };
}

export type PasswordLoginResult =
  | { ok: true; token: string; session: Session }
  /**
   * `unavailable`: o verificador não rodou — falha de recurso, não
   * veredito sobre a senha. Ver `KdfIndisponivelError`.
   */
  | { ok: false; reason: "invalid" | "rate_limited" | "unavailable" };

export async function loginWithPassword(
  email: string,
  password: string,
  deps: AuthDeps,
): Promise<PasswordLoginResult> {
  const verified = await deps.passwords.verify(email, password);
  if (!verified.ok) return verified;
  const identity = verified.identity;
  const expiresAt = new Date(clock().now() + SESSION_DAYS * 86_400_000).toISOString();
  const token = await deps.sessions.create({ userId: identity.userId, expiresAt });
  await record("login", {
    userId: identity.userId,
    email: identity.email,
    detail: "senha",
  }, deps);
  return {
    ok: true,
    token,
    session: { ...identity, expiresAt, impersonatedBy: null },
  };
}

export async function logout(token: string, deps: AuthDeps): Promise<void> {
  const session = await deps.sessions.resolve(token);
  // Revoked server-side, not merely forgotten by the browser: a cookie the
  // client deletes is still a valid credential to anyone who copied it.
  await deps.sessions.revoke(token);
  if (session) await record("logout", { userId: session.userId, email: session.email }, deps);
}

export async function revokeAllSessionsForEmail(
  email: string,
  deps: AuthDeps,
): Promise<number | null> {
  const userId = await deps.repository.findUserId(email);
  if (userId === null) return null;
  return deps.sessions.revokeAllFor(userId);
}

/* ------------------------------ Single user ------------------------------- */

/**
 * Autenticação é exigida por padrão.
 *
 * Era o contrário, e estava errado: o padrão `single-user` sintetizava uma
 * sessão e deixava currículo, funil e o export CSV inteiro acessíveis a
 * qualquer requisição. "Só roda em loopback" protege contra a internet, não
 * contra outro processo, outra conta da máquina, ou um bind mal configurado —
 * que já aconteceu aqui uma vez.
 *
 * O modo aberto continua existindo, mas agora precisa ser pedido:
 * `JHO_AUTH_MODE=open`. Explícito, e quem escreve isso sabe o que está
 * abrindo. Segurança por omissão significa a omissão ser a opção segura.
 *
 * O guard é o mesmo código nos dois modos, então o caminho autenticado nunca
 * foi um ramo pouco exercitado.
 */
export function isOpenMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.JHO_AUTH_MODE === "open";
}

/** @deprecated Use `isOpenMode`. Mantido para não quebrar chamada antiga. */
export function isSingleUser(env: Record<string, string | undefined> = process.env): boolean {
  return isOpenMode(env);
}

export const SINGLE_USER_ROLES: Role[] = ["admin", "candidate"];

/** Sessão sintetizada do modo aberto. Só existe quando `JHO_AUTH_MODE=open`. */
export function singleUserSession(candidateId: number | null, now = clock().now()): Session {
  return {
    userId: 0,
    candidateId,
    roles: SINGLE_USER_ROLES,
    email: "local@single-user",
    // Sem nome de propósito: não há conta por trás desta sessão, e inventar um
    // nome faria a interface tratar o modo aberto como se fosse alguém.
    fullName: null,
    expiresAt: new Date(now + 86_400_000).toISOString(),
    linkedCandidateIds: [],
    impersonatedBy: null,
  };
}
