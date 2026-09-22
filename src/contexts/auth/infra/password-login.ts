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
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { linkedCandidatesFor, ownedCandidateId } from "./drizzle-store.ts";
import { clock } from "../../../core/clock.ts";
import { getDb } from "../../../core/db/client.ts";
import { authEvent, authSession, authUser } from "../../../core/db/schema.ts";
import { checkPassword, hashPassword, KdfIndisponivelError, verifyPassword } from "../domain/password.ts";
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
      fullName: authUser.fullName,
      roles: authUser.roles,
      candidateId: ownedCandidateId,
      passwordHash: authUser.passwordHash,
      disabledAt: authUser.disabledAt,
    })
    .from(authUser)
    .where(eq(authUser.email, normalised))
    .limit(1);

  // Verify against the decoy when there is no account, so the timing of a
  // miss matches the timing of a hit.
  let ok: boolean;
  try {
    ok = await verifyPassword(password, user?.passwordHash ?? (await decoy()));
  } catch (erro) {
    if (!(erro instanceof KdfIndisponivelError)) throw erro;

    // O KDF não rodou, então não há veredito sobre a senha. Dizer "inválida"
    // aqui mandaria embora quem digitou a certa, e o registro do sistema
    // concordaria com o erro — o suporte procuraria um problema de senha que
    // não existe.
    //
    // Registrado com `kind` próprio: `login_failed` alimenta o limite por
    // tentativas, e uma falha de infraestrutura não pode ir bloqueando a conta
    // de quem não errou nada.
    await db.insert(authEvent).values({
      kind: "login_unavailable",
      email: normalised,
      detail: erro.message.slice(0, 300),
      at: clock().iso(),
    });
    return { ok: false, reason: "unavailable" };
  }

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

  const roles = (user.roles as Role[]) ?? [];
  return {
    ok: true,
    identity: {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
      candidateId: roles.includes("candidate") ? user.candidateId : null,
      linkedCandidateIds: await linkedCandidatesFor(user.id, roles),
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

/* ------------------------- Trocar a própria senha -------------------------- */

/**
 * Tentativas de troca por conta, na janela. Contam todas, certas ou erradas:
 * ninguém troca a senha cinco vezes em quinze minutos de boa-fé.
 */
export const MAX_CHANGE_ATTEMPTS = 5;

export type ChangePasswordResult =
  | { ok: true; email: string }
  /**
   * `invalid`: senha atual errada, conta desabilitada ou sumida, ou troca
   * concorrente — uma resposta só, como no login.
   * `no_password`: a conta entra só por link; não há senha atual a provar.
   * `unavailable`: o KDF não rodou, e isso não é veredito sobre a senha.
   */
  | { ok: false; reason: "invalid" | "weak" | "rate_limited" | "unavailable" | "no_password" };

async function changeAttemptsSince(userId: number, since: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(authEvent)
    .where(
      and(
        eq(authEvent.kind, "password_change_attempt"),
        eq(authEvent.userId, userId),
        gte(authEvent.at, since),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Troca a senha de uma conta que PROVA a senha atual.
 *
 * O `userId` vem da sessão de quem chama, nunca de formulário; esta função não
 * sabe de sessão e confia nisso. Quatro garantias:
 *
 *  1. **A senha atual é exigida.** Uma sessão roubada — cookie copiado, máquina
 *     destravada — não vira posse permanente da conta sem a senha.
 *  2. **O limite reserva o slot ANTES de verificar.** A tentativa é gravada e
 *     só depois contada: N requisições simultâneas enxergam umas às outras, e
 *     a k-ésima a gravar conta pelo menos k. Contar primeiro e gravar depois
 *     deixaria todas passarem juntas pelo mesmo número.
 *  3. **Hash ilegível nega.** A verificação é `verifyPassword`, que nunca
 *     deriva parâmetro do valor gravado; hash truncado responde `invalid`.
 *  4. **Todas as sessões da conta caem** — quem troca a senha costuma
 *     suspeitar de acesso indevido. Quem chama abre uma sessão nova para o
 *     navegador que pediu, e é assim que "as outras" caem e esta continua.
 *
 * A escrita confere o hash lido (`WHERE password_hash = <lido>`): duas trocas
 * concorrentes com a mesma senha atual não gravam as duas.
 */
export async function changeOwnPassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  // Senha nova fraca não consome tentativa: não diz nada sobre a atual, e um
  // erro de digitação na nova não pode bloquear a conta.
  if (!checkPassword(newPassword).ok) return { ok: false, reason: "weak" };

  const db = getDb();
  const now = clock().iso();
  await db.insert(authEvent).values({ kind: "password_change_attempt", userId, at: now });
  const since = new Date(clock().now() - WINDOW_MINUTES * 60_000).toISOString();
  if ((await changeAttemptsSince(userId, since)) > MAX_CHANGE_ATTEMPTS) {
    await db.insert(authEvent).values({
      kind: "password_change_failed",
      userId,
      detail: "bloqueado por tentativas",
      at: clock().iso(),
    });
    return { ok: false, reason: "rate_limited" };
  }

  const [user] = await db
    .select({ email: authUser.email, passwordHash: authUser.passwordHash, disabledAt: authUser.disabledAt })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);

  if (!user || user.disabledAt) {
    await db.insert(authEvent).values({
      kind: "password_change_failed",
      userId,
      detail: !user ? "conta inexistente" : "conta desabilitada",
      at: clock().iso(),
    });
    return { ok: false, reason: "invalid" };
  }
  if (!user.passwordHash) {
    await db.insert(authEvent).values({
      kind: "password_change_failed",
      userId,
      email: user.email,
      detail: "conta sem senha definida",
      at: clock().iso(),
    });
    return { ok: false, reason: "no_password" };
  }

  let ok: boolean;
  try {
    ok = await verifyPassword(currentPassword, user.passwordHash);
  } catch (erro) {
    if (!(erro instanceof KdfIndisponivelError)) throw erro;
    await db.insert(authEvent).values({
      kind: "password_change_unavailable",
      userId,
      email: user.email,
      detail: erro.message.slice(0, 300),
      at: clock().iso(),
    });
    return { ok: false, reason: "unavailable" };
  }

  if (!ok) {
    await db.insert(authEvent).values({
      kind: "password_change_failed",
      userId,
      email: user.email,
      detail: "senha atual incorreta",
      at: clock().iso(),
    });
    return { ok: false, reason: "invalid" };
  }

  // O hash da nova pede os mesmos ~64 MB da verificação, e sob pressão de
  // memória falha do mesmo jeito: é falta de recurso, não veredito — mesma
  // resposta `unavailable`, e não uma página de erro.
  let hash: string;
  try {
    hash = await hashPassword(newPassword);
  } catch (erro) {
    await db.insert(authEvent).values({
      kind: "password_change_unavailable",
      userId,
      email: user.email,
      detail: new KdfIndisponivelError(erro).message.slice(0, 300),
      at: clock().iso(),
    });
    return { ok: false, reason: "unavailable" };
  }
  const storedHash = user.passwordHash;
  // Senha, revogação e registro numa transação só. Em comandos separados, uma
  // queda de conexão entre a escrita da senha e a revogação deixaria a senha
  // trocada com as sessões antigas — inclusive um cookie roubado — ainda
  // valendo, que é o oposto do que a troca promete.
  const revoked = await db.transaction(async (tx) => {
    const rows = await tx
      .update(authUser)
      .set({ passwordHash: hash })
      .where(and(eq(authUser.id, userId), eq(authUser.passwordHash, storedHash)))
      .returning({ id: authUser.id });
    if (rows.length === 0) return null;
    const ended = await tx
      .update(authSession)
      .set({ revokedAt: clock().iso() })
      .where(and(eq(authSession.userId, userId), isNull(authSession.revokedAt)))
      .returning({ id: authSession.id });
    await tx.insert(authEvent).values({
      kind: "password_changed",
      userId,
      email: user.email,
      detail: `trocada pela própria conta; ${ended.length} sessões encerradas`,
      at: clock().iso(),
    });
    return ended.length;
  });

  if (revoked === null) {
    await db.insert(authEvent).values({
      kind: "password_change_failed",
      userId,
      email: user.email,
      detail: "senha alterada por outra requisição",
      at: clock().iso(),
    });
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, email: user.email };
}
