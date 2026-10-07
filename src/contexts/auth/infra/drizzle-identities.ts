/**
 * `auth_identity` e o que o login social lê da conta (#464, ADR-001, ADR-009).
 *
 * Busca e grava; não decide. Quem decide é `domain/identity-resolution.ts`, e
 * quem aplica é `app/oidc-login.ts`.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { authIdentity, authLoginToken, authUser } from "../../../core/db/schema.ts";
import {
  canDisconnect,
  type AccountMethodsRecord,
  type IdentityOrigin,
  type IdentityRecord,
  type UnlinkOutcome,
} from "../domain/methods.ts";
import type { OidcProviderId } from "../domain/oidc-config.ts";
import type { Role } from "../domain/types.ts";
import type { Identity } from "../ports.ts";
import { linkedCandidatesFor, ownedCandidateId } from "./drizzle-store.ts";

export type LinkedUser = { id: number; email: string; disabled: boolean };
export type EmailUser = { id: number; email: string; disabled: boolean; hasProvider: boolean };

/** A conta ligada a `(provider, subject)`, se houver. */
export async function findLinkedUser(provider: OidcProviderId, subject: string): Promise<LinkedUser | null> {
  const [row] = await getDb()
    .select({ id: authUser.id, email: authUser.email, disabledAt: authUser.disabledAt })
    .from(authIdentity)
    .innerJoin(authUser, eq(authUser.id, authIdentity.userId))
    .where(and(eq(authIdentity.provider, provider), eq(authIdentity.subject, subject)))
    .limit(1);
  return row ? { id: row.id, email: row.email, disabled: row.disabledAt !== null } : null;
}

/** A conta deste e-mail (já normalizado) e se ela já tem uma identidade deste provedor. */
export async function findUserByEmail(email: string, provider: OidcProviderId): Promise<EmailUser | null> {
  const [row] = await getDb()
    .select({
      id: authUser.id,
      email: authUser.email,
      disabledAt: authUser.disabledAt,
      identityId: authIdentity.id,
    })
    .from(authUser)
    .leftJoin(authIdentity, and(eq(authIdentity.userId, authUser.id), eq(authIdentity.provider, provider)))
    .where(eq(authUser.email, email))
    .limit(1);
  if (!row) return null;
  return { id: row.id, email: row.email, disabled: row.disabledAt !== null, hasProvider: row.identityId !== null };
}

/** A conta já tem uma identidade deste provedor? */
export async function userHasProvider(userId: number, provider: OidcProviderId): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: authIdentity.id })
    .from(authIdentity)
    .where(and(eq(authIdentity.userId, userId), eq(authIdentity.provider, provider)))
    .limit(1);
  return row !== undefined;
}

/**
 * Liga a identidade. `false` quando outra requisição chegou antes.
 *
 * Os dois índices únicos — `(provider, subject)` e `(user_id, provider)` — são
 * a trava contra o vínculo duplo concorrente (US-002.EC-5): a segunda inserção
 * não grava nada, e quem chama relê para saber quem venceu.
 */
export async function linkIdentity(input: {
  userId: number;
  provider: OidcProviderId;
  subject: string;
  emailAtLink: string | null;
  origin: "automatic" | "manual";
  at: string;
}): Promise<boolean> {
  const rows = await getDb()
    .insert(authIdentity)
    .values({
      userId: input.userId,
      provider: input.provider,
      subject: input.subject,
      emailAtLink: input.emailAtLink,
      origin: input.origin,
      linkedAt: input.at,
    })
    .onConflictDoNothing()
    .returning({ id: authIdentity.id });
  return rows.length > 0;
}

/** Último uso, para a tela da conta mostrar (US-001.AC-4). */
export async function touchIdentity(provider: OidcProviderId, subject: string, at: string): Promise<void> {
  await getDb()
    .update(authIdentity)
    .set({ lastUsedAt: at })
    .where(and(eq(authIdentity.provider, provider), eq(authIdentity.subject, subject)));
}

/** A identidade de sessão da conta — a mesma forma que senha e link mágico montam. */
export async function identityOfUser(userId: number): Promise<Identity | null> {
  const [user] = await getDb()
    .select({
      id: authUser.id,
      email: authUser.email,
      fullName: authUser.fullName,
      roles: authUser.roles,
      candidateId: ownedCandidateId,
      disabledAt: authUser.disabledAt,
    })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);
  if (!user || user.disabledAt) return null;
  const roles = (user.roles as Role[]) ?? [];
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    roles,
    candidateId: roles.includes("candidate") ? user.candidateId : null,
    linkedCandidateIds: await linkedCandidatesFor(user.id, roles),
  };
}

/** E-mail e idioma da conta, para o aviso de vínculo (US-019). */
export async function accountContact(userId: number): Promise<{ email: string; locale: string | null } | null> {
  const [row] = await getDb()
    .select({ email: authUser.email, locale: authUser.locale })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);
  return row ?? null;
}

/* --------------------------- Formas de entrar ---------------------------- */

function toIdentityRecord(row: {
  provider: string;
  origin: string;
  linkedAt: string;
  lastUsedAt: string | null;
}): IdentityRecord {
  // As restrições `check` da tabela garantem os dois domínios.
  return {
    provider: row.provider as OidcProviderId,
    origin: row.origin as IdentityOrigin,
    linkedAt: row.linkedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/** A conta e as identidades ligadas. O hash da senha nunca sai daqui, só o fato de existir. */
export async function accountMethods(userId: number): Promise<AccountMethodsRecord | null> {
  const db = getDb();
  const [user] = await db
    .select({
      email: authUser.email,
      locale: authUser.locale,
      passwordHash: authUser.passwordHash,
      disabledAt: authUser.disabledAt,
      termsVersion: authUser.termsVersion,
      privacyVersion: authUser.privacyVersion,
      termsAcceptedAt: authUser.termsAcceptedAt,
    })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);
  if (!user) return null;
  const identities = await db
    .select({
      provider: authIdentity.provider,
      origin: authIdentity.origin,
      linkedAt: authIdentity.linkedAt,
      lastUsedAt: authIdentity.lastUsedAt,
    })
    .from(authIdentity)
    .where(eq(authIdentity.userId, userId))
    .orderBy(asc(authIdentity.provider));
  return {
    email: user.email,
    locale: user.locale,
    hasPassword: user.passwordHash !== null,
    disabled: user.disabledAt !== null,
    identities: identities.map(toIdentityRecord),
    terms: {
      termsVersion: user.termsVersion,
      privacyVersion: user.privacyVersion,
      acceptedAt: user.termsAcceptedAt,
    },
  };
}

/** O id da conta deste e-mail (normalizado aqui), para a CLI. */
export async function userIdByEmail(email: string): Promise<number | null> {
  const [row] = await getDb()
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

/** Provedores ligados por conta, para a lista do admin (US-011.AC-1). */
export async function providersByUser(): Promise<Map<number, OidcProviderId[]>> {
  const rows = await getDb()
    .select({ userId: authIdentity.userId, provider: authIdentity.provider })
    .from(authIdentity)
    .orderBy(asc(authIdentity.userId), asc(authIdentity.provider));
  const byUser = new Map<number, OidcProviderId[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row.provider as OidcProviderId);
    byUser.set(row.userId, list);
  }
  return byUser;
}

/**
 * Desliga o provedor, a menos que seja a última forma de entrar (ADR-004).
 *
 * A conferência e a remoção rodam na mesma transação, com a linha da conta
 * travada (`FOR UPDATE`): dois desligamentos simultâneos de uma conta sem
 * senha com Google e LinkedIn passam um de cada vez, e o segundo vê só um
 * provedor sobrando — "último método" (US-008.EC-1). Sem a trava, os dois
 * leriam dois provedores e apagariam um cada, deixando a conta sem porta.
 */
export async function unlinkIdentityChecked(userId: number, provider: OidcProviderId): Promise<UnlinkOutcome> {
  return getDb().transaction(async (tx) => {
    const [user] = await tx
      .select({ passwordHash: authUser.passwordHash })
      .from(authUser)
      .where(eq(authUser.id, userId))
      .for("update");
    if (!user) return "no_account";
    const linked = await tx
      .select({ provider: authIdentity.provider })
      .from(authIdentity)
      .where(eq(authIdentity.userId, userId));
    const providers = linked.map((row) => row.provider as OidcProviderId);
    if (!providers.includes(provider)) return "not_linked";
    if (!canDisconnect({ hasPassword: user.passwordHash !== null, providers }, provider)) return "last_method";
    await tx.delete(authIdentity).where(and(eq(authIdentity.userId, userId), eq(authIdentity.provider, provider)));
    return "unlinked";
  });
}

/**
 * Grava a PRIMEIRA senha (US-009). `false` quando a conta já tem senha, está
 * desabilitada ou sumiu — trocar senha existente é outro caminho, que prova a
 * atual e derruba as sessões.
 *
 * Não encerra sessão nenhuma (US-009.EC-2): acrescentar uma porta não é
 * suspeita de invasão. O `WHERE password_hash IS NULL` faz duas requisições
 * simultâneas gravarem uma só.
 */
export async function setFirstPassword(userId: number, hash: string): Promise<boolean> {
  const rows = await getDb()
    .update(authUser)
    .set({ passwordHash: hash })
    .where(and(eq(authUser.id, userId), isNull(authUser.passwordHash), isNull(authUser.disabledAt)))
    .returning({ id: authUser.id });
  return rows.length > 0;
}

/**
 * Queima o `state` de um fluxo OIDC: `true` na primeira vez, `false` depois.
 *
 * O cookie do fluxo é do navegador e pode ser reenviado — duas abas, um
 * retorno repetido, alguém que copiou o cookie. Para o retorno valer uma vez só
 * (US-001.EC-5), o servidor guarda o hash do `state` consumido em
 * `auth_login_token`, que já tem índice único em `token_hash`: a segunda
 * inserção do mesmo hash não grava, mesmo sob concorrência. A linha nasce com
 * `used_at` preenchido e propósito `oidc_flow`, então não serve de link mágico
 * nem de recuperação; o rótulo no hash a separa de qualquer outro token.
 */
export async function consumeFlowState(state: string, at: string, expiresAt: string): Promise<boolean> {
  const tokenHash = createHash("sha256").update(`oidc-flow:${state}`).digest("hex");
  const rows = await getDb()
    .insert(authLoginToken)
    .values({ tokenHash, email: "", purpose: "oidc_flow", expiresAt, usedAt: at })
    .onConflictDoNothing()
    .returning({ id: authLoginToken.id });
  return rows.length > 0;
}
