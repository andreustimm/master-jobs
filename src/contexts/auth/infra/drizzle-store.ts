/**
 * Drizzle implementations of the auth ports.
 *
 * The only file in the context that knows SQL exists.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { clock } from "../../../core/clock.ts";
import { getDb } from "../../../core/db/client.ts";
import {
  authEvent,
  authLoginToken,
  authSession,
  authUser,
  recruiterCandidate,
} from "../../../core/db/schema.ts";
import type {
  AuthRepository,
  Identity,
  IdentityProvider,
  NewSession,
  SessionStore,
} from "../ports.ts";
import type { Role, Session } from "../domain/types.ts";

/** 32 bytes of CSPRNG. Guessing is not a threat model at this width. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256, not a password hash.
 *
 * Deliberate: a password is low-entropy and needs an expensive KDF to survive
 * an offline attack. A 256-bit random token has nothing to brute-force, and
 * running bcrypt on every request would cost latency for no security.
 */
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Candidatos que um recrutador acompanha.
 *
 * Uma consulta só, usada por todos os caminhos que montam uma `Identity` ou
 * uma `Session`, para os vínculos não divergirem entre login por senha e por
 * link — divergência aqui vira "o recrutador vê no login A e não vê no B".
 */
export async function linkedCandidatesFor(userId: number, roles: Role[]): Promise<number[]> {
  if (!roles.includes("recruiter")) return [];
  const rows = await getDb()
    .select({ candidateId: recruiterCandidate.candidateId })
    .from(recruiterCandidate)
    .where(eq(recruiterCandidate.recruiterUserId, userId));
  return rows.map((r) => r.candidateId);
}

export const drizzleSessions: SessionStore = {
  async create(input: NewSession): Promise<string> {
    const token = newToken();
    await getDb().insert(authSession).values({
      tokenHash: hash(token),
      userId: input.userId,
      expiresAt: input.expiresAt,
    });
    // Returned once. After this the system cannot recover it, by design.
    return token;
  },

  async resolve(token: string): Promise<Session | null> {
    if (!token) return null;
    const db = getDb();
    const [row] = await db
      .select({
        userId: authSession.userId,
        expiresAt: authSession.expiresAt,
        revokedAt: authSession.revokedAt,
        email: authUser.email,
        roles: authUser.roles,
        candidateId: authUser.candidateId,
        disabledAt: authUser.disabledAt,
        impersonatedBy: authSession.impersonatedBy,
      })
      .from(authSession)
      .innerJoin(authUser, eq(authUser.id, authSession.userId))
      .where(eq(authSession.tokenHash, hash(token)))
      .limit(1);

    if (!row) return null;
    if (row.revokedAt) return null;
    // A disabled account must lose access immediately, not at session expiry.
    if (row.disabledAt) return null;
    if (Date.parse(row.expiresAt) <= clock().now()) return null;

    const roles = (row.roles as Role[]) ?? [];

    // Os vínculos são lidos aqui, na carga da sessão, e não no ponto de uso.
    // É o que permite `policy.ts` continuar derivando posse da sessão: um id
    // que chegasse por parâmetro seria afirmação do chamador, não prova.
    const linkedCandidateIds = await linkedCandidatesFor(row.userId, roles);

    return {
      userId: row.userId,
      candidateId: row.candidateId,
      roles,
      email: row.email,
      expiresAt: row.expiresAt,
      linkedCandidateIds,
      impersonatedBy: row.impersonatedBy ?? null,
    };
  },

  async revoke(token: string): Promise<void> {
    await getDb()
      .update(authSession)
      .set({ revokedAt: clock().iso() })
      .where(eq(authSession.tokenHash, hash(token)));
  },

  async revokeAllFor(userId: number): Promise<number> {
    const rows = await getDb()
      .update(authSession)
      .set({ revokedAt: clock().iso() })
      .where(and(eq(authSession.userId, userId), isNull(authSession.revokedAt)))
      .returning({ id: authSession.id });
    return rows.length;
  },

  async purgeExpired(): Promise<number> {
    const rows = await getDb()
      .delete(authSession)
      .where(lt(authSession.expiresAt, clock().iso()))
      .returning({ id: authSession.id });
    return rows.length;
  },
};

export const drizzleAuthRepository: AuthRepository = {
  async record(input): Promise<void> {
    await getDb().insert(authEvent).values({
      kind: input.kind,
      userId: input.userId ?? null,
      email: input.email ?? null,
      detail: input.detail ?? null,
      at: clock().iso(),
    });
  },

  async findUserId(email): Promise<number | null> {
    const [user] = await getDb()
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, email.toLowerCase().trim()))
      .limit(1);
    return user?.id ?? null;
  },
};

export const MAGIC_LINK_MINUTES = 15;

/**
 * Magic link.
 *
 * No password anywhere: nothing to store, nothing to leak, nothing to reuse
 * across sites. The token is single-use and short-lived, and the account must
 * already exist — this is a personal system, not a public sign-up.
 */
export const magicLink: IdentityProvider = {
  name: "magic-link",

  async begin(email: string): Promise<{ token: string; expiresAt: string }> {
    const token = newToken();
    const expiresAt = new Date(clock().now() + MAGIC_LINK_MINUTES * 60_000).toISOString();
    await getDb().insert(authLoginToken).values({
      tokenHash: hash(token),
      email: email.toLowerCase().trim(),
      expiresAt,
    });
    return { token, expiresAt };
  },

  async complete(token: string): Promise<Identity | null> {
    const db = getDb();
    const tokenHash = hash(token);

    // Consume first, then read: marking it used in the same statement that
    // selects it is what stops two concurrent redemptions from both winning.
    const consumed = await db
      .update(authLoginToken)
      .set({ usedAt: clock().iso() })
      .where(
        and(
          eq(authLoginToken.tokenHash, tokenHash),
          isNull(authLoginToken.usedAt),
          sql`${authLoginToken.expiresAt} > ${clock().iso()}`,
        ),
      )
      .returning({ email: authLoginToken.email });

    const row = consumed[0];
    if (!row) return null;

    const [user] = await db
      .select({
        id: authUser.id,
        email: authUser.email,
        roles: authUser.roles,
        candidateId: authUser.candidateId,
        disabledAt: authUser.disabledAt,
      })
      .from(authUser)
      .where(eq(authUser.email, row.email))
      .limit(1);

    // No implicit account creation. An unknown address gets nothing, and the
    // caller cannot tell it apart from a bad token.
    if (!user || user.disabledAt) return null;

    const identityRoles = (user.roles as Role[]) ?? [];
    return {
      userId: user.id,
      email: user.email,
      roles: identityRoles,
      candidateId: user.candidateId,
      linkedCandidateIds: await linkedCandidatesFor(user.id, identityRoles),
    };
  },
};
