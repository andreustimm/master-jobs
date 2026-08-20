/**
 * Password login.
 *
 * Coexists with the magic link — an account may have either, both, or only one.
 * Neither is required.
 *
 * Three properties this file exists to hold:
 *
 *  1. **The answer is the same for every failure.** Unknown address, wrong
 *     password, disabled account: identical result. Anything else turns the
 *     login form into an account-enumeration oracle.
 *  2. **Work is done even when the account does not exist.** Otherwise the
 *     response time itself answers the question — a fast "no" means "no such
 *     user", a slow one means "user exists, password wrong".
 *  3. **Attempts are limited.** scrypt makes each guess expensive; the limit
 *     makes a sustained campaign impossible.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { clock } from "../../../core/clock.ts";
import { getDb } from "../../../core/db/client.ts";
import { authEvent, authUser } from "../../../core/db/schema.ts";
import { hashPassword, verifyPassword } from "../domain/password.ts";
import type { PasswordResult, PasswordVerifier } from "../ports.ts";
import type { Role } from "../domain/types.ts";

/** Failures tolerated per address inside the window. */
export const MAX_ATTEMPTS = 8;
export const WINDOW_MINUTES = 15;

/**
 * A hash to verify against when the account does not exist.
 *
 * Computed once at module load, against a value nobody can supply. Its only job
 * is to make the "no such user" path cost the same as the real one.
 */
let decoyHash: string | null = null;
async function decoy(): Promise<string> {
  decoyHash ??= await hashPassword("decoy-for-constant-time-comparison-only");
  return decoyHash;
}

export async function recentFailures(email: string): Promise<number> {
  const since = new Date(clock().now() - WINDOW_MINUTES * 60_000).toISOString();
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(authEvent)
    .where(
      and(
        eq(authEvent.kind, "login_failed"),
        eq(authEvent.email, email.toLowerCase().trim()),
        gte(authEvent.at, since),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function verifyLogin(email: string, password: string): Promise<PasswordResult> {
  const normalised = email.toLowerCase().trim();
  const db = getDb();

  if ((await recentFailures(normalised)) >= MAX_ATTEMPTS) {
    await db.insert(authEvent).values({
      kind: "login_failed",
      email: normalised,
      detail: "bloqueado por tentativas",
      // Stamped from the injected clock, not the database default: the rate
      // limit compares against `clock()`, so the write has to use the same
      // clock or the window is measured against a different timeline.
      at: clock().iso(),
    });
    return { ok: false, reason: "rate_limited" };
  }

  const [user] = await db
    .select({
      id: authUser.id,
      email: authUser.email,
      roles: authUser.roles,
      candidateId: authUser.candidateId,
      passwordHash: authUser.passwordHash,
      disabledAt: authUser.disabledAt,
    })
    .from(authUser)
    .where(eq(authUser.email, normalised))
    .limit(1);

  // Verify against the decoy when there is no account, so the timing of a
  // miss matches the timing of a hit.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await decoy()));

  if (!user || !user.passwordHash || user.disabledAt || !ok) {
    await db.insert(authEvent).values({
      kind: "login_failed",
      email: normalised,
      at: clock().iso(),
      // The reason is recorded for the operator, never returned to the caller.
      detail: !user
        ? "conta inexistente"
        : user.disabledAt
          ? "conta desabilitada"
          : !user.passwordHash
            ? "conta sem senha definida"
            : "senha incorreta",
    });
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    identity: {
      userId: user.id,
      email: user.email,
      roles: (user.roles as Role[]) ?? [],
      candidateId: user.candidateId,
    },
  };
}

export const drizzlePasswords: PasswordVerifier = { verify: verifyLogin };

/** Sets or replaces a password, and drops every live session for the account. */
export async function setPassword(email: string, password: string): Promise<boolean> {
  const db = getDb();
  const normalised = email.toLowerCase().trim();
  const hash = await hashPassword(password);

  const rows = await db
    .update(authUser)
    .set({ passwordHash: hash })
    .where(eq(authUser.email, normalised))
    .returning({ id: authUser.id });

  if (rows.length === 0) return false;

  // A password change must end sessions opened with the old one — that is the
  // point of changing it after a suspected compromise.
  const { drizzleSessions } = await import("./drizzle-store.ts");
  await drizzleSessions.revokeAllFor(rows[0]!.id);

  await db.insert(authEvent).values({
    kind: "role_changed",
    userId: rows[0]!.id,
    email: normalised,
    detail: "senha definida; sessões encerradas",
    at: clock().iso(),
  });
  return true;
}
