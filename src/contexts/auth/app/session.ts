/**
 * Use cases: sign in, sign out, and answer "who is this".
 *
 * Orchestration only. The decision lives in `domain/policy.ts`, the storage in
 * `infra/`, and this file just moves between them.
 */
import { clock } from "../../../core/clock.ts";
import { getDb } from "../../../core/db/client.ts";
import { authEvent, authUser } from "../../../core/db/schema.ts";
import { eq } from "drizzle-orm";
import type { IdentityProvider, SessionStore } from "../ports.ts";
import type { Role, Session } from "../domain/types.ts";

export type AuthDeps = { sessions: SessionStore; identity: IdentityProvider };

const SESSION_DAYS = 30;

/**
 * Records what happened, never how.
 *
 * A token, a cookie or a key in an audit log turns the log into a credential
 * store — and logs are the thing people paste into issues.
 */
async function record(
  kind: string,
  input: { userId?: number | null; email?: string | null; detail?: string },
): Promise<void> {
  await getDb().insert(authEvent).values({
    kind,
    userId: input.userId ?? null,
    email: input.email ?? null,
    detail: input.detail ?? null,
    // From the injected clock, so anything that reasons over a time window
    // (rate limiting) measures against the same timeline it writes.
    at: clock().iso(),
  });
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
    await record("login_failed", { detail: "token inválido, usado ou expirado" });
    return null;
  }

  const db = getDb();
  const [user] = await db
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, identity.email))
    .limit(1);
  if (!user) {
    await record("login_failed", { email: identity.email, detail: "conta inexistente" });
    return null;
  }

  const expiresAt = new Date(clock().now() + SESSION_DAYS * 86_400_000).toISOString();
  // A fresh token on every login is what defeats session fixation: a value the
  // attacker planted before authentication is not the value that ends up valid.
  const token = await deps.sessions.create({ userId: user.id, expiresAt });

  await record("login", { userId: user.id, email: identity.email });

  return {
    token,
    session: {
      userId: user.id,
      candidateId: identity.candidateId,
      roles: identity.roles,
      email: identity.email,
      expiresAt,
    },
  };
}

export async function logout(token: string, deps: AuthDeps): Promise<void> {
  const session = await deps.sessions.resolve(token);
  // Revoked server-side, not merely forgotten by the browser: a cookie the
  // client deletes is still a valid credential to anyone who copied it.
  await deps.sessions.revoke(token);
  if (session) await record("logout", { userId: session.userId, email: session.email });
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

export const SINGLE_USER_ROLES: Role[] = ["owner", "admin"];

/** Sessão sintetizada do modo aberto. Só existe quando `JHO_AUTH_MODE=open`. */
export function singleUserSession(candidateId: number | null, now = clock().now()): Session {
  return {
    userId: 0,
    candidateId,
    roles: SINGLE_USER_ROLES,
    email: "local@single-user",
    expiresAt: new Date(now + 86_400_000).toISOString(),
  };
}
