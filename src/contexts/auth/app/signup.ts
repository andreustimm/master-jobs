/**
 * Cadastro aberto: manual com código, ou social com o e-mail do provedor
 * (#464, ADR-002, ADR-006, ADR-007).
 *
 * Orquestra; não decide. As regras são de `domain/signup-rules.ts`, a
 * transação que cria conta e perfil é da loja (`infra/drizzle-signups.ts`), e
 * tudo entra por `SignupDeps` e `SignupConfig`, montados em `index.ts` — este
 * arquivo não lê ambiente, banco nem relógio por conta própria (regra 4).
 *
 * Erro é valor (`SignupResult`), nunca exceção; só falha inesperada de E/S sobe
 * para a fronteira de erro.
 *
 * O que ele garante, em ordem:
 *
 * 1. **Nada é criado antes do passo final.** Validação, extração do PDF e hash
 *    da senha acontecem antes de qualquer gravação (US-016.EC-8); a conta nasce
 *    só no envio social ou no código certo.
 * 2. **A tela não revela cadastro.** E-mail com conta recebe o aviso no lugar
 *    do código, e a resposta é a mesma (US-016.EC-3).
 * 3. **Boas-vindas só para quem se cadastrou**, uma vez, no idioma escolhido; a
 *    falha de envio fica registrada e não desfaz a conta (US-018).
 */
import { DEFAULT_LOCALE, isLocale, type LocaleId } from "../../../core/i18n/index.ts";
import type { CvPdf } from "../../../core/pdf.ts";
import { landingAfterSignup } from "../domain/landing.ts";
import type { OidcProviderId } from "../domain/oidc-config.ts";
import {
  CODE_MAX_ATTEMPTS,
  CODE_MINUTES,
  chooseCvSource,
  codeExpired,
  hashCode,
  isExpired,
  normalizeCode,
  pdfErrorToSignup,
  requireTerms,
  resendWaitSeconds,
  validateEmail,
  validatePassword,
  validateProfileFields,
  validateRole,
  type SignupFailure,
  type SignupResult,
  type SignupRole,
} from "../domain/signup-rules.ts";
import type {
  CompletionOutcome,
  ManualStartInput,
  ManualStartOutcome,
  PendingView,
  ResendOutcome,
  SocialCompletionInput,
} from "../infra/drizzle-signups.ts";
import type { Mailer } from "../ports-mailer.ts";
import type { AuthRepository, Identity, SessionStore } from "../ports.ts";
import { accountExistsEmail, signupCodeEmail, welcomeEmail } from "./account-emails.ts";
import { openSession } from "./session.ts";

export type { SignupError, SignupResult } from "../domain/signup-rules.ts";

export type SignupConfig = {
  /**
   * O e-mail sai deste ambiente (Resend, sink de teste ou terminal local)? No
   * Preview ele fica omitido, e o cadastro manual fica indisponível (ADR-011).
   */
  manualAvailable: boolean;
  /** Origem pública confiável para os links dos e-mails (G17); `null` recusa o manual. */
  origin: string | null;
  /** Chave do HMAC do IP e do código (ADR-009); `null` fecha o cadastro. */
  ipSecret: string | null;
  maxPerIpHour: number;
  legalVersions(): { terms: string; privacy: string };
};

export type SignupDeps = {
  store: {
    startManual(input: ManualStartInput): Promise<ManualStartOutcome>;
    resend(input: { tokenHash: string; codeHash: string; now: Date }): Promise<ResendOutcome>;
    confirmManual(input: {
      tokenHash: string;
      code: string | null;
      codeKey: string;
      cvLabel: string;
      ipHmac: string;
      maxPerIpHour: number;
      now: Date;
    }): Promise<CompletionOutcome>;
    completeSocial(input: SocialCompletionInput): Promise<CompletionOutcome>;
    findPending(tokenHash: string): Promise<PendingView | null>;
  };
  tokens: { create(): string; hash(token: string): string };
  ipHmac(ip: string, secret: string): string;
  hashPassword(password: string): Promise<string>;
  generateCode(): string;
  readPdf(entry: unknown): Promise<CvPdf>;
  sessions: SessionStore;
  repository: AuthRepository;
  identityOfUser(userId: number): Promise<Identity | null>;
  mailer(): Mailer;
  /** Depois do commit: pede a repontuação do currículo novo. */
  afterCandidateCreated(candidateId: number): Promise<void>;
  now(): Date;
};

/** O que a conclusão entrega a quem grava o cookie e redireciona. */
export type SignedIn = { token: string; expiresAt: string; location: string; candidateId: number | null };

/** Rótulo da primeira versão do currículo: a data, sem idioma (como no onboarding). */
function cvLabel(now: Date): string {
  return `CV ${now.toISOString().slice(0, 10)}`;
}

function localeOf(raw: string): LocaleId {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

function failure(error: SignupFailure["error"]): SignupFailure {
  return { ok: false, error };
}

/* ------------------------------ Validação --------------------------------- */

export type ProfileForm = {
  role: unknown;
  name: string;
  headline: string;
  cvPasted: string;
  /** A entrada crua do `FormData`; `readCvPdf` decide se é um PDF. */
  cvFile: unknown;
  termsAccepted: boolean;
};

type ValidProfile = { role: SignupRole; name: string; headline: string | null; cvText: string | null };

function hasFile(entry: unknown): boolean {
  return typeof File !== "undefined" && entry instanceof File && entry.size > 0;
}

/**
 * Papel, nome, headline, aceite e currículo — os campos comuns aos dois
 * caminhos. Os baratos primeiro: recusar o aceite não pode custar a extração
 * de um PDF.
 */
async function validateProfile(form: ProfileForm, deps: Pick<SignupDeps, "readPdf">): Promise<SignupResult<ValidProfile>> {
  const role = validateRole(form.role);
  if (!role.ok) return role;
  const fields = validateProfileFields(role.value, { name: form.name, headline: form.headline });
  if (!fields.ok) return fields;
  const terms = requireTerms(form.termsAccepted);
  if (!terms.ok) return terms;
  if (role.value === "recruiter") {
    return { ok: true, value: { role: role.value, name: fields.value.name, headline: null, cvText: null } };
  }
  const source = chooseCvSource({ hasPdf: hasFile(form.cvFile), pasted: form.cvPasted });
  if (!source.ok) return source;
  let cvText: string;
  if (source.value.kind === "text") {
    cvText = source.value.text;
  } else {
    const pdf = await deps.readPdf(form.cvFile);
    if (!pdf.ok) return failure(pdfErrorToSignup(pdf.code));
    cvText = pdf.text;
  }
  return { ok: true, value: { role: role.value, name: fields.value.name, headline: fields.value.headline, cvText } };
}

/* ------------------------------ Início manual ----------------------------- */

export type ManualStartForm = ProfileForm & {
  email: string;
  password: string;
  locale: LocaleId;
  clientIp: string;
};

/**
 * Valida o formulário manual, grava a pendência e envia o código (ou o aviso
 * de conta existente). `token` é `null` quando o envio foi absorvido como duplo
 * clique: o cookie que já está no navegador continua valendo.
 */
export async function startManual(
  form: ManualStartForm,
  config: SignupConfig,
  deps: SignupDeps,
): Promise<SignupResult<{ email: string; token: string | null }>> {
  if (!config.manualAvailable || config.ipSecret === null || config.origin === null) return failure("unavailable_here");
  const profile = await validateProfile(form, deps);
  if (!profile.ok) return profile;
  const email = validateEmail(form.email);
  if (!email.ok) return email;
  const password = validatePassword(form.password);
  if (!password.ok) return password;

  const versions = config.legalVersions();
  const now = deps.now();
  const code = deps.generateCode();
  const token = deps.tokens.create();
  // O hash da senha roda mesmo quando o e-mail já tem conta: o tempo de
  // resposta não pode separar os dois casos.
  const passwordHash = await deps.hashPassword(password.value);

  const outcome = await deps.store.startManual({
    email: email.value,
    locale: form.locale,
    role: profile.value.role,
    name: profile.value.name,
    headline: profile.value.headline,
    cvText: profile.value.cvText,
    passwordHash,
    termsVersion: versions.terms,
    privacyVersion: versions.privacy,
    ipHmac: deps.ipHmac(form.clientIp, config.ipSecret),
    tokenHash: deps.tokens.hash(token),
    codeHash: hashCode(code, config.ipSecret),
    now,
  });
  if (outcome.decision === "too_many") return failure("too_many_codes");
  if (outcome.decision === "code" || outcome.decision === "account_exists_notice") {
    await sendStartMail(outcome.decision, { email: email.value, locale: form.locale, code, origin: config.origin }, deps);
  }
  return { ok: true, value: { email: email.value, token: outcome.tokenIssued ? token : null } };
}

async function sendStartMail(
  kind: "code" | "account_exists_notice",
  input: { email: string; locale: LocaleId; code: string; origin: string },
  deps: Pick<SignupDeps, "mailer" | "repository">,
): Promise<void> {
  const mail =
    kind === "code"
      ? signupCodeEmail({ locale: input.locale, code: input.code, minutes: CODE_MINUTES })
      : accountExistsEmail({
          locale: input.locale,
          signInUrl: `${input.origin}/login`,
          recoveryUrl: `${input.origin}/login/forgot`,
        });
  const result = await deps.mailer().send({ to: input.email, subject: mail.subject, text: mail.text });
  if (!result.ok) {
    // A tela segue igual; quem não recebe pede de novo. O motivo fica para o
    // admin, sem o corpo — ele é o código.
    await deps.repository.record({
      kind: "email_send_failed",
      email: input.email,
      detail: kind === "code" ? "signup_code" : "account_exists",
    });
  }
}

/* --------------------------------- Reenvio -------------------------------- */

export async function resendCode(
  input: { token: string | null },
  config: SignupConfig,
  deps: SignupDeps,
): Promise<SignupResult<{ email: string }>> {
  if (!config.manualAvailable || config.ipSecret === null || config.origin === null) return failure("unavailable_here");
  if (input.token === null) return failure("expired");
  const code = deps.generateCode();
  const outcome = await deps.store.resend({
    tokenHash: deps.tokens.hash(input.token),
    codeHash: hashCode(code, config.ipSecret),
    now: deps.now(),
  });
  if (!outcome.ok) return outcome;
  await sendStartMail(outcome.send, { email: outcome.email, locale: localeOf(outcome.locale), code, origin: config.origin }, deps);
  return { ok: true, value: { email: outcome.email } };
}

/* --------------------------------- Código --------------------------------- */

/** Confere o código e, certo, cria a conta e abre a sessão (US-017). */
export async function confirmCode(
  input: { token: string | null; code: string; clientIp: string },
  config: SignupConfig,
  deps: SignupDeps,
): Promise<SignupResult<SignedIn>> {
  if (!config.manualAvailable || config.ipSecret === null) return failure("unavailable_here");
  if (input.token === null) return failure("expired");
  const now = deps.now();
  const outcome = await deps.store.confirmManual({
    tokenHash: deps.tokens.hash(input.token),
    code: normalizeCode(input.code),
    codeKey: config.ipSecret,
    cvLabel: cvLabel(now),
    ipHmac: deps.ipHmac(input.clientIp, config.ipSecret),
    maxPerIpHour: config.maxPerIpHour,
    now,
  });
  return signIn(outcome, "manual", config, deps);
}

/* --------------------------------- Social --------------------------------- */

export type SocialForm = ProfileForm & { token: string | null; locale: LocaleId; clientIp: string };

/** O envio da tela no modo social: cria conta, identidade e perfil (US-004, US-005). */
export async function completeSocial(
  form: SocialForm,
  config: SignupConfig,
  deps: SignupDeps,
): Promise<SignupResult<SignedIn>> {
  if (config.ipSecret === null) return failure("unavailable_here");
  if (form.token === null) return failure("expired");
  const tokenHash = deps.tokens.hash(form.token);
  const pending = await deps.store.findPending(tokenHash);
  if (pending === null || pending.kind !== "social") return failure("expired");

  const profile = await validateProfile(form, deps);
  if (!profile.ok) return profile;
  const versions = config.legalVersions();
  const now = deps.now();
  const outcome = await deps.store.completeSocial({
    tokenHash,
    role: profile.value.role,
    name: profile.value.name,
    headline: profile.value.headline,
    cvText: profile.value.cvText,
    cvLabel: cvLabel(now),
    locale: form.locale,
    termsVersion: versions.terms,
    privacyVersion: versions.privacy,
    ipHmac: deps.ipHmac(form.clientIp, config.ipSecret),
    maxPerIpHour: config.maxPerIpHour,
    now,
  });
  return signIn(outcome, pending.provider ?? "google", config, deps);
}

/* -------------------------------- Conclusão ------------------------------- */

async function signIn(
  outcome: CompletionOutcome,
  path: "manual" | OidcProviderId,
  config: SignupConfig,
  deps: SignupDeps,
): Promise<SignupResult<SignedIn>> {
  if ("ok" in outcome) return outcome;
  const identity = await deps.identityOfUser(outcome.userId);
  // Desabilitada entre o commit e aqui: a conta existe, mas não entra.
  if (identity === null) return failure("expired");

  if (outcome.kind === "already") {
    // Segundo envio do mesmo cadastro (duplo clique, duas abas): entra na conta
    // que o primeiro criou, sem segundo e-mail de boas-vindas (US-018.EC-2).
    const { token, session } = await openSession(identity, deps, { kind: "login", detail: `cadastro ${path} (repetido)` });
    const role = session.candidateId !== null ? "candidate" : "recruiter";
    return { ok: true, value: { token, expiresAt: session.expiresAt, location: landingAfterSignup(role), candidateId: session.candidateId } };
  }

  const { token, session } = await openSession(identity, deps, { kind: "login", detail: `cadastro ${path}` });
  if (outcome.candidateId !== null) await deps.afterCandidateCreated(outcome.candidateId);
  await sendWelcome(outcome, config, deps);
  return {
    ok: true,
    value: { token, expiresAt: session.expiresAt, location: landingAfterSignup(outcome.role), candidateId: outcome.candidateId },
  };
}

/**
 * Boas-vindas (US-018): uma por conta criada pelo cadastro, no idioma da tela.
 * Conta criada por admin nunca passa por aqui (US-018.AC-2).
 */
async function sendWelcome(
  created: Extract<CompletionOutcome, { kind: "created" }>,
  config: SignupConfig,
  deps: Pick<SignupDeps, "mailer" | "repository">,
): Promise<void> {
  if (config.origin === null) {
    await deps.repository.record({ kind: "email_send_failed", userId: created.userId, detail: "welcome: sem origem pública" });
    return;
  }
  const mail = welcomeEmail({ locale: localeOf(created.locale), role: created.role, signInUrl: `${config.origin}/login` });
  const result = await deps.mailer().send({ to: created.email, subject: mail.subject, text: mail.text });
  if (!result.ok) await deps.repository.record({ kind: "email_send_failed", userId: created.userId, detail: "welcome" });
}

/* ---------------------------------- Telas --------------------------------- */

export type SignupScreen =
  | { mode: "social"; email: string; provider: OidcProviderId }
  | { mode: "manual"; pendingCodeEmail: string | null; socialExpired: boolean };

/**
 * O que `/signup` mostra para o cookie desta visita: o modo social com o
 * e-mail verificado, ou o formulário manual — com "Já tenho um código" quando
 * há pendência manual válida (US-017.EC-6) e o aviso de cadastro social vencido.
 */
export async function signupScreen(token: string | null, deps: Pick<SignupDeps, "store" | "tokens" | "now">): Promise<SignupScreen> {
  const pending = token === null ? null : await deps.store.findPending(deps.tokens.hash(token));
  const now = deps.now();
  const live = pending !== null && pending.completedAt === null && !isExpired(pending.expiresAt, now);
  if (pending?.kind === "social" && live && pending.provider !== null) {
    return { mode: "social", email: pending.email, provider: pending.provider };
  }
  return {
    mode: "manual",
    pendingCodeEmail: pending?.kind === "manual" && live ? pending.email : null,
    socialExpired: pending?.kind === "social" && pending.completedAt === null && !live,
  };
}

export type VerifyScreen =
  | { state: "active"; email: string; resendInSeconds: number; codeExpired: boolean; attemptsLeft: number }
  | { state: "expired" };

/** O que `/signup/verify` mostra: o e-mail, a espera do reenvio, ou "comece de novo". */
export async function verifyScreen(token: string | null, deps: Pick<SignupDeps, "store" | "tokens" | "now">): Promise<VerifyScreen> {
  const pending = token === null ? null : await deps.store.findPending(deps.tokens.hash(token));
  const now = deps.now();
  if (pending === null || pending.kind !== "manual" || pending.completedAt !== null || isExpired(pending.expiresAt, now)) {
    return { state: "expired" };
  }
  return {
    state: "active",
    email: pending.email,
    resendInSeconds: resendWaitSeconds(pending.codeSentAt, now),
    codeExpired: pending.codeSentAt !== null && codeExpired(pending.codeSentAt, now),
    attemptsLeft: Math.max(0, CODE_MAX_ATTEMPTS - pending.codeAttempts),
  };
}
