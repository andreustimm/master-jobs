/**
 * Cadastro pendente em `auth_signup` e a criação da conta (#464, ADR-009).
 *
 * Busca, trava e grava; não decide. As decisões — papel, validade, código,
 * limites — são de `domain/signup-rules.ts`, chamadas aqui DENTRO da transação,
 * sobre o que a transação leu com as travas na mão.
 *
 * **Conta e perfil nunca existem pela metade.** A conta, a identidade do
 * provedor (cadastro social), o candidato com o currículo e a marca de
 * concluído entram no mesmo commit; qualquer erro desfaz tudo.
 *
 * **Travas, sempre nesta ordem:** e-mail (trava consultiva), linha da
 * pendência (`for update`), IP (trava consultiva). Ordem fixa é o que impede
 * duas transações de esperarem uma pela outra. A do e-mail serializa o duplo
 * envio e a corrida de duas pendências do mesmo endereço; a do IP é a reserva
 * da vaga da hora antes de gravar (G13): duas conclusões do mesmo IP leem a
 * contagem uma depois da outra, nunca juntas (US-006.EC-1).
 *
 * O cookie leva um token aleatório de 32 bytes; a tabela guarda só o SHA-256
 * dele, como sessão e link mágico. O IP chega já em HMAC (`signupIpHmac`), e o
 * código, em HMAC (`hashCode`).
 */
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb, type DbTransaction } from "../../../core/db/client.ts";
import { authEvent, authIdentity, authSignup, authUser } from "../../../core/db/schema.ts";
import { insertOwnCandidate } from "../../../core/candidate.ts";
import type { OidcProviderId } from "../domain/oidc-config.ts";
import {
  CODE_DIGITS,
  CODE_MAX_ATTEMPTS,
  capSlotsUsed,
  codeExpired,
  decideCompletion,
  decideManualStart,
  isExpired,
  pendingExpiresAt,
  resendWaitSeconds,
  tooManyCodes,
  validateRole,
  verifyCode,
  wrongAttempt,
  type ManualStartDecision,
  type SignupFailure,
  type SignupRole,
} from "../domain/signup-rules.ts";

export { SOCIAL_SIGNUP_MINUTES } from "../domain/signup-rules.ts";

/** Cookie do cadastro pendente. Escopo `/signup`: só a tela, o código e as ações deles o leem. */
export const SIGNUP_COOKIE = "jho_signup";

/** Chaves das travas consultivas, uma por espaço de nomes. */
const EMAIL_LOCK = 46_401;
const IP_LOCK = 46_402;

const HOUR_MS = 3_600_000;

export function signupTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Token novo do cookie do cadastro: só sai daqui uma vez. */
export function newSignupToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Código de 6 dígitos, uniforme (`randomInt` não tem o viés do módulo). */
export function generateSignupCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

/**
 * HMAC-SHA256 do IP do cliente com `JHO_SIGNUP_IP_SECRET` (ADR-009).
 *
 * O IP cru nunca é gravado: o HMAC basta para contar cadastros por endereço, e
 * sem a chave não se volta ao IP — nem testando os quatro bilhões de IPv4,
 * que é o que um hash sem chave permitiria.
 */
export function signupIpHmac(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

async function lockEmail(tx: DbTransaction, email: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(EMAIL_LOCK))}, hashtext(${email}))`);
}

async function lockIp(tx: DbTransaction, ipHmac: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(IP_LOCK))}, hashtext(${ipHmac}))`);
}

export async function createSocialSignup(input: {
  email: string;
  provider: OidcProviderId;
  subject: string;
  locale: string;
  ipHmac: string;
  now: Date;
}): Promise<{ token: string; expiresAt: string }> {
  const token = newSignupToken();
  const expiresAt = pendingExpiresAt("social", input.now).toISOString();
  await getDb().insert(authSignup).values({
    kind: "social",
    tokenHash: signupTokenHash(token),
    email: input.email,
    locale: input.locale,
    provider: input.provider,
    subject: input.subject,
    ipHmac: input.ipHmac,
    createdAt: input.now.toISOString(),
    expiresAt,
  });
  return { token, expiresAt };
}

/* ------------------------------- Leitura ---------------------------------- */

/** O que as telas precisam saber da pendência do cookie. Nada de dado de perfil. */
export type PendingView = {
  kind: "manual" | "social";
  email: string;
  provider: OidcProviderId | null;
  expiresAt: string;
  completedAt: string | null;
  codeSentAt: string | null;
  codeAttempts: number;
};

export async function findPending(tokenHash: string): Promise<PendingView | null> {
  const [row] = await getDb()
    .select({
      kind: authSignup.kind,
      email: authSignup.email,
      provider: authSignup.provider,
      expiresAt: authSignup.expiresAt,
      completedAt: authSignup.completedAt,
      codeSentAt: authSignup.codeSentAt,
      codeAttempts: authSignup.codeAttempts,
    })
    .from(authSignup)
    .where(eq(authSignup.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  return {
    kind: row.kind === "social" ? "social" : "manual",
    email: row.email,
    provider: row.provider === "google" || row.provider === "linkedin" ? row.provider : null,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    codeSentAt: row.codeSentAt,
    codeAttempts: row.codeAttempts,
  };
}

/* ----------------------------- Envios por e-mail -------------------------- */

/** Envios (código ou aviso de conta existente) para o e-mail na última hora. */
async function sendsLastHour(tx: DbTransaction, email: string, now: Date): Promise<{ count: number; last: string | null }> {
  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int`, last: sql<string | null>`max(${authEvent.at})` })
    .from(authEvent)
    .where(and(eq(authEvent.kind, "signup_code_sent"), eq(authEvent.email, email), gt(authEvent.at, since)));
  return { count: row?.count ?? 0, last: row?.last ?? null };
}

async function accountExists(tx: DbTransaction, email: string): Promise<boolean> {
  const [row] = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email)).limit(1);
  return row !== undefined;
}

async function recordInTx(
  tx: DbTransaction,
  input: { kind: string; email: string | null; userId?: number | null; detail: string; now: Date },
): Promise<void> {
  await tx.insert(authEvent).values({
    kind: input.kind,
    email: input.email,
    userId: input.userId ?? null,
    detail: input.detail,
    at: input.now.toISOString(),
  });
}

/* ------------------------------ Início manual ----------------------------- */

export type ManualStartInput = {
  email: string;
  locale: string;
  role: SignupRole;
  name: string;
  headline: string | null;
  cvText: string | null;
  passwordHash: string;
  termsVersion: string;
  privacyVersion: string;
  ipHmac: string;
  /** Hash do token novo do cookie. */
  tokenHash: string;
  /** HMAC do código gerado para este envio; só é gravado se a decisão for `code`. */
  codeHash: string;
  now: Date;
};

export type ManualStartOutcome = {
  decision: ManualStartDecision;
  /** O token novo passou a valer (e o cookie deve ser gravado). */
  tokenIssued: boolean;
};

/**
 * Grava (ou substitui) a pendência manual do e-mail e diz o que enviar.
 *
 * Uma pendência por e-mail: o segundo envio substitui os dados e o código do
 * primeiro (US-016.EC-4). Com conta existente, a pendência nasce sem dado de
 * perfil, sem senha e sem código — só para a tela de código responder igual
 * (US-016.EC-3) —, e nada que a pessoa digitou fica guardado.
 */
export async function startManualSignup(input: ManualStartInput): Promise<ManualStartOutcome> {
  return getDb().transaction(async (tx) => {
    await lockEmail(tx, input.email);
    const exists = await accountExists(tx, input.email);
    const sends = await sendsLastHour(tx, input.email, input.now);
    const [current] = await tx
      .select({ id: authSignup.id })
      .from(authSignup)
      .where(and(eq(authSignup.email, input.email), eq(authSignup.kind, "manual"), isNull(authSignup.completedAt)))
      .orderBy(desc(authSignup.id))
      .limit(1)
      .for("update");

    let decision = decideManualStart({
      accountExists: exists,
      sentLastHour: sends.count,
      lastSentAt: sends.last,
      now: input.now,
    });
    // Envio recente sem pendência para atualizar (concluída ou descartada no
    // meio): não há duplo clique a absorver, então o envio segue.
    if (decision === "duplicate" && current === undefined) decision = exists ? "account_exists_notice" : "code";
    if (decision === "too_many") return { decision, tokenIssued: false };

    const profile = exists
      ? { role: null, name: null, headline: null, cvText: null, passwordHash: null, termsVersion: null, privacyVersion: null }
      : {
          role: input.role,
          name: input.name,
          headline: input.headline,
          cvText: input.cvText,
          passwordHash: input.passwordHash,
          termsVersion: input.termsVersion,
          privacyVersion: input.privacyVersion,
        };

    if (decision === "duplicate") {
      // Duplo clique ou segunda aba: os dados mais recentes valem, o código e o
      // token continuam os do primeiro envio — um e-mail só (US-016.EC-5).
      await tx.update(authSignup).set({ ...profile, locale: input.locale }).where(eq(authSignup.id, current!.id));
      return { decision, tokenIssued: false };
    }

    const nowIso = input.now.toISOString();
    const fresh = {
      ...profile,
      tokenHash: input.tokenHash,
      locale: input.locale,
      ipHmac: input.ipHmac,
      codeHash: decision === "code" ? input.codeHash : null,
      codeAttempts: 0,
      codeSentAt: nowIso,
      createdAt: nowIso,
      expiresAt: pendingExpiresAt("manual", input.now).toISOString(),
    };
    if (current) {
      await tx.update(authSignup).set(fresh).where(eq(authSignup.id, current.id));
    } else {
      await tx.insert(authSignup).values({ kind: "manual", email: input.email, ...fresh });
    }
    await recordInTx(tx, {
      kind: "signup_code_sent",
      email: input.email,
      detail: decision === "code" ? "código" : "aviso de conta existente",
      now: input.now,
    });
    if (decision === "code") {
      await recordInTx(tx, { kind: "signup_started", email: input.email, detail: "manual", now: input.now });
    }
    return { decision, tokenIssued: true };
  });
}

/* --------------------------------- Reenvio -------------------------------- */

export type ResendOutcome =
  | { ok: true; send: "code" | "account_exists_notice"; email: string; locale: string }
  | SignupFailure;

/**
 * Código novo para a pendência do cookie, invalidando o anterior.
 *
 * Mesmas regras do início: 60 s entre envios, cinco por hora, e o aviso de
 * conta existente no lugar do código quando o e-mail ganhou conta.
 */
export async function resendSignupCode(input: { tokenHash: string; codeHash: string; now: Date }): Promise<ResendOutcome> {
  return getDb().transaction(async (tx) => {
    const [probe] = await tx
      .select({ email: authSignup.email, kind: authSignup.kind })
      .from(authSignup)
      .where(eq(authSignup.tokenHash, input.tokenHash))
      .limit(1);
    if (!probe || probe.kind !== "manual") return { ok: false, error: "expired" } as const;
    await lockEmail(tx, probe.email);
    const [row] = await tx
      .select()
      .from(authSignup)
      .where(eq(authSignup.tokenHash, input.tokenHash))
      .limit(1)
      .for("update");
    if (!row || row.completedAt !== null || isExpired(row.expiresAt, input.now)) return { ok: false, error: "expired" } as const;

    const wait = resendWaitSeconds(row.codeSentAt, input.now);
    if (wait > 0) return { ok: false, error: "resend_wait", retryInSeconds: wait } as const;
    if (tooManyCodes((await sendsLastHour(tx, row.email, input.now)).count)) {
      return { ok: false, error: "too_many_codes" } as const;
    }

    const exists = await accountExists(tx, row.email);
    // Pendência nascida de "conta existente" não tem dado para virar conta: se
    // a conta sumiu no meio, não há o que confirmar.
    if (!exists && (row.role === null || row.passwordHash === null)) return { ok: false, error: "expired" } as const;
    const send = exists ? "account_exists_notice" : "code";
    await tx
      .update(authSignup)
      .set({ codeHash: send === "code" ? input.codeHash : null, codeAttempts: 0, codeSentAt: input.now.toISOString() })
      .where(eq(authSignup.id, row.id));
    await recordInTx(tx, {
      kind: "signup_code_sent",
      email: row.email,
      detail: send === "code" ? "código (reenvio)" : "aviso de conta existente (reenvio)",
      now: input.now,
    });
    return { ok: true, send, email: row.email, locale: row.locale };
  });
}

/* -------------------------------- Conclusão ------------------------------- */

export type CompletionOutcome =
  | {
      kind: "created";
      userId: number;
      candidateId: number | null;
      role: SignupRole;
      email: string;
      locale: string;
    }
  | { kind: "already"; userId: number }
  | SignupFailure;

type NewAccount = {
  email: string;
  role: SignupRole;
  name: string;
  headline: string | null;
  cvText: string | null;
  cvLabel: string;
  passwordHash: string | null;
  termsVersion: string;
  privacyVersion: string;
  origin: "manual" | OidcProviderId;
  locale: string;
  now: Date;
};

/**
 * A conta, e o candidato com o currículo como primeira versão, dentro da
 * transação de quem chama.
 *
 * O candidato é sempre uma linha NOVA (`insertOwnCandidate`): conta nova
 * nunca aponta para candidato que já existia (G25). O recrutador nasce sem
 * candidato e sem vínculo nenhum — só o candidato concede acesso (#465).
 */
async function createAccount(tx: DbTransaction, account: NewAccount): Promise<{ userId: number; candidateId: number | null }> {
  const nowIso = account.now.toISOString();
  const [user] = await tx
    .insert(authUser)
    .values({
      email: account.email,
      fullName: account.name,
      roles: [account.role],
      passwordHash: account.passwordHash,
      emailVerifiedAt: nowIso,
      termsVersion: account.termsVersion,
      privacyVersion: account.privacyVersion,
      termsAcceptedAt: nowIso,
      signupOrigin: account.origin,
      locale: account.locale,
      createdAt: nowIso,
    })
    .returning({ id: authUser.id });
  if (!user) throw new Error("insert de auth_user não devolveu linha");

  if (account.role !== "candidate") return { userId: user.id, candidateId: null };
  const created = await insertOwnCandidate(tx, {
    name: account.name,
    headline: account.headline,
    location: null,
    cv: account.cvText,
    cvLabel: account.cvLabel,
    publicSlug: null,
  });
  // `null` só acontece com endereço público escolhido, e aqui não há escolha.
  if (created === null) throw new Error("candidato do cadastro sem endereço livre");
  await tx.update(authUser).set({ candidateId: created.id }).where(eq(authUser.id, user.id));
  return { userId: user.id, candidateId: created.id };
}

/** Concluídos deste IP na última hora, lidos com a trava do IP na mão. */
async function completedFromIp(tx: DbTransaction, ipHmac: string, now: Date): Promise<number> {
  await lockIp(tx, ipHmac);
  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  const rows = await tx
    .select({ completedAt: authSignup.completedAt })
    .from(authSignup)
    .where(and(eq(authSignup.ipHmac, ipHmac), isNotNull(authSignup.completedAt), gt(authSignup.completedAt, since)));
  return capSlotsUsed(rows, now);
}

async function finishPending(
  tx: DbTransaction,
  input: {
    rowId: number;
    userId: number;
    ipHmac: string;
    role: SignupRole;
    termsVersion: string;
    privacyVersion: string;
    now: Date;
  },
): Promise<void> {
  // O currículo, a senha e o código já cumpriram o papel: a linha concluída
  // fica 30 dias só para o limite por IP e a auditoria, sem o dado pessoal.
  await tx
    .update(authSignup)
    .set({
      completedAt: input.now.toISOString(),
      userId: input.userId,
      ipHmac: input.ipHmac,
      role: input.role,
      termsVersion: input.termsVersion,
      privacyVersion: input.privacyVersion,
      cvText: null,
      passwordHash: null,
      codeHash: null,
      name: null,
      headline: null,
    })
    .where(eq(authSignup.id, input.rowId));
}

export type CompletionLimits = { ipHmac: string; maxPerIpHour: number; now: Date };

/**
 * Confere o código da pendência manual e, certo, cria a conta.
 *
 * Erro de código é gravado (a transação termina normalmente, sem desfazer a
 * contagem): cinco erros travam o código mesmo sob tentativas paralelas, que
 * esperam a trava da linha e leem a contagem já somada.
 */
export async function confirmManualSignup(
  input: CompletionLimits & { tokenHash: string; code: string | null; codeKey: string; cvLabel: string },
): Promise<CompletionOutcome> {
  return getDb().transaction(async (tx) => {
    const [probe] = await tx
      .select({ email: authSignup.email, kind: authSignup.kind })
      .from(authSignup)
      .where(eq(authSignup.tokenHash, input.tokenHash))
      .limit(1);
    if (!probe || probe.kind !== "manual") return { ok: false, error: "expired" } as const;
    await lockEmail(tx, probe.email);
    const [row] = await tx
      .select()
      .from(authSignup)
      .where(eq(authSignup.tokenHash, input.tokenHash))
      .limit(1)
      .for("update");
    if (!row) return { ok: false, error: "expired" } as const;

    if (row.completedAt !== null) {
      const decision = decideCompletion({
        pending: row,
        emailTaken: false,
        completedFromIpLastHour: 0,
        maxPerIpHour: input.maxPerIpHour,
        now: input.now,
      });
      if ("ok" in decision) return decision;
      return decision.kind === "already" ? decision : { ok: false, error: "expired" };
    }
    if (isExpired(row.expiresAt, input.now)) return { ok: false, error: "expired" } as const;
    if (row.codeAttempts >= CODE_MAX_ATTEMPTS) return { ok: false, error: "code_locked" } as const;
    // Com ou sem código (a pendência de conta existente não tem), a resposta é a
    // mesma: a tela não pode revelar qual das duas está do outro lado.
    if (row.codeSentAt !== null && codeExpired(row.codeSentAt, input.now)) {
      return { ok: false, error: "expired" } as const;
    }
    if (input.code === null || !verifyCode(input.code, row.codeHash, input.codeKey)) {
      const wrong = wrongAttempt(row.codeAttempts);
      await tx.update(authSignup).set({ codeAttempts: wrong.attempts }).where(eq(authSignup.id, row.id));
      await recordInTx(tx, { kind: "signup_code_failed", email: row.email, detail: wrong.failure.error, now: input.now });
      return wrong.failure;
    }

    const role = validateRole(row.role);
    if (!role.ok || row.passwordHash === null || row.name === null || !row.termsVersion || !row.privacyVersion) {
      return { ok: false, error: "expired" } as const;
    }
    const decision = decideCompletion({
      pending: row,
      emailTaken: await accountExists(tx, row.email),
      completedFromIpLastHour: await completedFromIp(tx, input.ipHmac, input.now),
      maxPerIpHour: input.maxPerIpHour,
      now: input.now,
    });
    if ("ok" in decision) {
      if (decision.error === "ip_cap") {
        await recordInTx(tx, { kind: "signup_ip_capped", email: row.email, detail: "manual", now: input.now });
      }
      return decision;
    }
    if (decision.kind === "already") return decision;

    const created = await createAccount(tx, {
      email: row.email,
      role: role.value,
      name: row.name,
      headline: row.headline,
      cvText: role.value === "candidate" ? row.cvText : null,
      cvLabel: input.cvLabel,
      passwordHash: row.passwordHash,
      termsVersion: row.termsVersion,
      privacyVersion: row.privacyVersion,
      origin: "manual",
      locale: row.locale,
      now: input.now,
    });
    await finishPending(tx, {
      rowId: row.id,
      userId: created.userId,
      ipHmac: input.ipHmac,
      role: role.value,
      termsVersion: row.termsVersion,
      privacyVersion: row.privacyVersion,
      now: input.now,
    });
    await recordInTx(tx, {
      kind: "signup_completed",
      email: row.email,
      userId: created.userId,
      detail: `manual ${role.value}; termos ${row.termsVersion}, privacidade ${row.privacyVersion}`,
      now: input.now,
    });
    return {
      kind: "created",
      userId: created.userId,
      candidateId: created.candidateId,
      role: role.value,
      email: row.email,
      locale: row.locale,
    };
  });
}

export type SocialCompletionInput = CompletionLimits & {
  tokenHash: string;
  role: SignupRole;
  name: string;
  headline: string | null;
  cvText: string | null;
  cvLabel: string;
  locale: string;
  termsVersion: string;
  privacyVersion: string;
};

/**
 * Conclui a pendência social: conta com o e-mail que o provedor verificou,
 * ligada à identidade dele, e o perfil — num commit só (US-004, US-005).
 */
export async function completeSocialSignup(input: SocialCompletionInput): Promise<CompletionOutcome> {
  return getDb().transaction(async (tx) => {
    const [probe] = await tx
      .select({ email: authSignup.email, kind: authSignup.kind })
      .from(authSignup)
      .where(eq(authSignup.tokenHash, input.tokenHash))
      .limit(1);
    if (!probe || probe.kind !== "social") return { ok: false, error: "expired" } as const;
    await lockEmail(tx, probe.email);
    const [row] = await tx
      .select()
      .from(authSignup)
      .where(eq(authSignup.tokenHash, input.tokenHash))
      .limit(1)
      .for("update");
    if (!row || row.provider === null || row.subject === null) return { ok: false, error: "expired" } as const;
    const provider: OidcProviderId = row.provider === "linkedin" ? "linkedin" : "google";

    const decision = decideCompletion({
      pending: row,
      emailTaken: row.completedAt === null && (await accountExists(tx, row.email)),
      completedFromIpLastHour: row.completedAt === null ? await completedFromIp(tx, input.ipHmac, input.now) : 0,
      maxPerIpHour: input.maxPerIpHour,
      now: input.now,
    });
    if ("ok" in decision) {
      if (decision.error === "ip_cap") {
        await recordInTx(tx, { kind: "signup_ip_capped", email: row.email, detail: `social ${provider}`, now: input.now });
      }
      return decision;
    }
    if (decision.kind === "already") return decision;

    // A identidade ganhou dona entre o consentimento e o envio (outra aba,
    // vínculo pela conta): o cadastro não pode tomá-la. Comece de novo — o
    // login com ela agora entra na conta que a tem.
    const [taken] = await tx
      .select({ id: authIdentity.id })
      .from(authIdentity)
      .where(and(eq(authIdentity.provider, provider), eq(authIdentity.subject, row.subject)))
      .limit(1);
    if (taken) return { ok: false, error: "expired" } as const;

    const created = await createAccount(tx, {
      email: row.email,
      role: input.role,
      name: input.name,
      headline: input.headline,
      cvText: input.role === "candidate" ? input.cvText : null,
      cvLabel: input.cvLabel,
      passwordHash: null,
      termsVersion: input.termsVersion,
      privacyVersion: input.privacyVersion,
      origin: provider,
      locale: input.locale,
      now: input.now,
    });
    // `automatic`: a identidade entrou pela verificação do provedor, não pela
    // tela da conta. Só o identificador e o e-mail verificado (ADR-003).
    await tx.insert(authIdentity).values({
      userId: created.userId,
      provider,
      subject: row.subject,
      emailAtLink: row.email,
      origin: "automatic",
      linkedAt: input.now.toISOString(),
      lastUsedAt: input.now.toISOString(),
    });
    await finishPending(tx, {
      rowId: row.id,
      userId: created.userId,
      ipHmac: input.ipHmac,
      role: input.role,
      termsVersion: input.termsVersion,
      privacyVersion: input.privacyVersion,
      now: input.now,
    });
    await recordInTx(tx, {
      kind: "signup_completed",
      email: row.email,
      userId: created.userId,
      detail: `${provider} ${input.role}; termos ${input.termsVersion}, privacidade ${input.privacyVersion}`,
      now: input.now,
    });
    return {
      kind: "created",
      userId: created.userId,
      candidateId: created.candidateId,
      role: input.role,
      email: row.email,
      locale: input.locale,
    };
  });
}
