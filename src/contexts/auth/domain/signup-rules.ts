/**
 * Regras do cadastro aberto (#464, ADR-002, ADR-006, ADR-007).
 *
 * Puro: recebe o instante, as contagens e o que a pessoa digitou; devolve a
 * decisão. Quem lê o banco, gera o código e manda o e-mail é `app/signup.ts`
 * com a loja `infra/drizzle-signups.ts` (regra 4).
 *
 * O que as regras garantem:
 *
 * - **Admin nunca nasce do cadastro.** O papel é comparado literalmente com
 *   `candidate` e `recruiter`; qualquer outra coisa — `admin`, vazio, com
 *   espaço — é papel inválido (US-012.EC-1).
 * - **O código é credencial.** Só o HMAC dele é guardado, a comparação é em
 *   tempo constante, ele vale 15 minutos e cai depois de 5 erros (ADR-006).
 * - **Os limites são contados, não estimados.** Cinco códigos por e-mail por
 *   hora, reenvio a cada 60 s, três contas por IP por hora — e só conta o
 *   cadastro concluído, nunca a pendência nem a conta criada por admin.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { HEADLINE_MAX, NAME_MAX, CV_MIN, parsePublicName } from "../../../core/candidate-identity.ts";
import type { CvPdfError } from "../../../core/pdf.ts";
import { normalizeEmail } from "./identity-resolution.ts";
import { checkPassword } from "./password.ts";

/** Os papéis que o cadastro oferece. Admin fica de fora por desenho (ADR-002). */
export const SIGNUP_ROLES = ["candidate", "recruiter"] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

export type SignupKind = "manual" | "social";

/** Validade da pendência social, do consentimento ao envio do formulário (PRD). */
export const SOCIAL_SIGNUP_MINUTES = 15;
/** Validade da pendência manual: depois disso o cadastro é descartado (ADR-006). */
export const MANUAL_SIGNUP_HOURS = 24;
/** Validade de um código enviado. */
export const CODE_MINUTES = 15;
/** Erros que invalidam o código. */
export const CODE_MAX_ATTEMPTS = 5;
/** Espera mínima entre dois envios para o mesmo cadastro. */
export const RESEND_SECONDS = 60;
/** Códigos (ou avisos de conta existente) por e-mail numa hora. */
export const CODES_PER_EMAIL_HOUR = 5;
/** Dígitos do código. */
export const CODE_DIGITS = 6;
/**
 * Janela em que um segundo envio do mesmo cadastro concluído entra na conta que
 * o primeiro criou (US-004.EC-3, US-017.EC-4). Depois dela, o token do cookie
 * não abre sessão nenhuma: ele provou o cadastro, não serve de senha.
 */
export const ALREADY_COMPLETED_MINUTES = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Os motivos de recusa que a tela sabe mostrar. Os da TechSpec, mais os do
 * formulário de perfil que o onboarding já tinha (nome e headline) e
 * `cv_required`, porque o candidato sai do cadastro com currículo (ADR-007).
 */
export type SignupError =
  | "invalid_email"
  | "weak_password"
  | "role_invalid"
  | "terms_required"
  | "name_required"
  | "name_too_long"
  | "name_contact"
  | "headline_too_long"
  | "cv_required"
  | "cv_too_short"
  | "cv_both"
  | "pdf_missing"
  | "pdf_too_large"
  | "pdf_not_pdf"
  | "pdf_no_text"
  | "too_many_codes"
  | "resend_wait"
  | "ip_cap"
  | "expired"
  | "wrong_code"
  | "code_locked"
  | "unavailable_here"
  | "email_taken";

export type SignupFailure = {
  ok: false;
  error: SignupError;
  /** Com `wrong_code`: quantas tentativas restam. */
  attemptsLeft?: number;
  /** Com `resend_wait`: segundos até o reenvio valer. */
  retryInSeconds?: number;
};

export type SignupResult<T> = { ok: true; value: T } | SignupFailure;

function fail(error: SignupError, extra: Omit<SignupFailure, "ok" | "error"> = {}): SignupFailure {
  return { ok: false, error, ...extra };
}

/* --------------------------------- Papel ---------------------------------- */

/**
 * O papel escolhido. Comparação exata, sem `trim` nem minúsculas: o valor vem
 * de um botão de rádio, e qualquer coisa diferente das duas opções é
 * requisição forjada, não digitação (US-004.EC-6).
 */
export function validateRole(raw: unknown): SignupResult<SignupRole> {
  return raw === "candidate" || raw === "recruiter" ? { ok: true, value: raw } : fail("role_invalid");
}

/* ------------------------------- Pendência -------------------------------- */

/** Quando a pendência vence: 15 minutos (social) ou 24 horas (manual). */
export function pendingExpiresAt(kind: SignupKind, createdAt: Date): Date {
  const span = kind === "social" ? SOCIAL_SIGNUP_MINUTES * MINUTE_MS : MANUAL_SIGNUP_HOURS * HOUR_MS;
  return new Date(createdAt.getTime() + span);
}

/** Vencida a partir do primeiro milissegundo depois de `expiresAt`. */
export function isExpired(expiresAt: string, now: Date): boolean {
  return now.getTime() > Date.parse(expiresAt);
}

/* ---------------------------------- Campos -------------------------------- */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
/** RFC 5321: um endereço não passa disso. */
const EMAIL_MAX = 254;

/** O e-mail normalizado como o das contas, ou `invalid_email`. */
export function validateEmail(raw: string): SignupResult<string> {
  const email = normalizeEmail(raw);
  if (email.length > EMAIL_MAX || !EMAIL_SHAPE.test(email)) return fail("invalid_email");
  return { ok: true, value: email };
}

/** A mesma regra da troca de senha: mínimo de 12 caracteres (US-016.EC-2). */
export function validatePassword(raw: string): SignupResult<string> {
  return checkPassword(raw).ok ? { ok: true, value: raw } : fail("weak_password");
}

/** Sem o aceite dos Termos e da Política, nada segue (US-004.EC-9). */
export function requireTerms(accepted: boolean): SignupResult<true> {
  return accepted ? { ok: true, value: true } : fail("terms_required");
}

export type ProfileFields = { name: string; headline: string | null };

/**
 * Nome (os dois papéis) e headline (só candidato).
 *
 * O candidato usa a regra do perfil público — o nome vira o título de
 * `/p/<endereço>`, então e-mail e telefone são recusados. O recrutador não tem
 * perfil público: o nome é o de exibição da conta, com teto e nada mais.
 */
export function validateProfileFields(
  role: SignupRole,
  raw: { name: string; headline: string },
): SignupResult<ProfileFields> {
  if (role === "recruiter") {
    const name = raw.name.trim();
    if (name === "") return fail("name_required");
    if (name.length > NAME_MAX) return fail("name_too_long");
    return { ok: true, value: { name, headline: null } };
  }
  const parsed = parsePublicName(raw.name);
  if (!parsed.ok) {
    return fail(parsed.code === "nameRequired" ? "name_required" : parsed.code === "nameTooLong" ? "name_too_long" : "name_contact");
  }
  const headline = raw.headline.trim();
  if (headline.length > HEADLINE_MAX) return fail("headline_too_long");
  return { ok: true, value: { name: parsed.name, headline: headline === "" ? null : headline } };
}

/**
 * De onde vem o currículo do candidato: PDF ou texto colado, nunca os dois, e
 * nunca nenhum (ADR-007 recusou o currículo opcional). O texto colado segue o
 * mínimo do onboarding; o PDF é lido depois, por `readCvPdf`, que tem o mesmo
 * mínimo — por isso a checagem barata vem antes da extração.
 */
export function chooseCvSource(input: {
  hasPdf: boolean;
  pasted: string;
}): SignupResult<{ kind: "pdf" } | { kind: "text"; text: string }> {
  const pasted = input.pasted.trim();
  if (input.hasPdf && pasted !== "") return fail("cv_both");
  if (input.hasPdf) return { ok: true, value: { kind: "pdf" } };
  if (pasted === "") return fail("cv_required");
  if (pasted.length < CV_MIN) return fail("cv_too_short");
  return { ok: true, value: { kind: "text", text: pasted } };
}

const PDF_ERRORS: Readonly<Record<CvPdfError, SignupError>> = {
  pdfMissing: "pdf_missing",
  pdfTooLarge: "pdf_too_large",
  pdfNotPdf: "pdf_not_pdf",
  pdfNoText: "pdf_no_text",
};

/** A recusa de `readCvPdf` no vocabulário do cadastro. */
export function pdfErrorToSignup(code: CvPdfError): SignupError {
  return PDF_ERRORS[code];
}

/* ------------------------------ Limite por IP ----------------------------- */

/**
 * Quantas vagas da janela de uma hora estes cadastros ocupam.
 *
 * Só o cadastro CONCLUÍDO conta (US-006.EC-4): pendência não é conta. Conta
 * criada por admin não tem linha em `auth_signup`, então nunca chega aqui
 * (US-006.EC-2).
 */
export function capSlotsUsed(rows: ReadonlyArray<{ completedAt: string | null }>, now: Date): number {
  const since = now.getTime() - HOUR_MS;
  return rows.filter((row) => row.completedAt !== null && Date.parse(row.completedAt) > since).length;
}

/** O IP já usou as vagas da hora? `max` vem de `parseSignupLimits`. */
export function capReached(completedLastHour: number, max: number): boolean {
  return completedLastHour >= max;
}

/* ---------------------------------- Código -------------------------------- */

/**
 * Os dígitos do que a pessoa colou ou digitou. Espaço, traço e texto em volta
 * somem; o resultado vale só com exatamente 6 dígitos (US-017.EC-3).
 */
export function normalizeCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === CODE_DIGITS ? digits : null;
}

/**
 * HMAC do código. A chave é segredo do servidor: uma cópia do banco não
 * devolve o código testando o milhão de possibilidades, que é o que um hash sem
 * chave permitiria.
 */
export function hashCode(code: string, key: string): string {
  return createHmac("sha256", key).update(`signup-code:${code}`).digest("hex");
}

/** Comparação em tempo constante; hash ausente ou malformado nunca confere. */
export function verifyCode(code: string, hash: string | null, key: string): boolean {
  if (hash === null || !/^[0-9a-f]{64}$/.test(hash)) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(hashCode(code, key), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** O código venceu? Vale até 15 minutos depois do envio, inclusive. */
export function codeExpired(sentAt: string, now: Date): boolean {
  return now.getTime() > Date.parse(sentAt) + CODE_MINUTES * MINUTE_MS;
}

/**
 * O erro de uma tentativa errada, com quantas restam. A quinta errada trava o
 * código; daí em diante só um código novo serve (US-017.EC-1).
 */
export function wrongAttempt(previousAttempts: number): { attempts: number; failure: SignupFailure } {
  const attempts = previousAttempts + 1;
  if (attempts >= CODE_MAX_ATTEMPTS) return { attempts, failure: fail("code_locked") };
  return { attempts, failure: fail("wrong_code", { attemptsLeft: CODE_MAX_ATTEMPTS - attempts }) };
}

/** Segundos até o reenvio valer; zero quando já vale (US-017.EC-8). */
export function resendWaitSeconds(sentAt: string | null, now: Date): number {
  if (sentAt === null) return 0;
  const remaining = Date.parse(sentAt) + RESEND_SECONDS * 1000 - now.getTime();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Cinco envios na última hora fecham o e-mail até a janela andar (US-016.EC-6). */
export function tooManyCodes(sentLastHour: number): boolean {
  return sentLastHour >= CODES_PER_EMAIL_HOUR;
}

/* ------------------------------ Início manual ----------------------------- */

/**
 * O que um envio do formulário manual faz.
 *
 * - `too_many`: o e-mail já recebeu cinco mensagens na hora;
 * - `duplicate`: a última saiu há menos de 60 s — é o duplo clique ou a
 *   segunda aba (US-016.EC-5): os dados são atualizados, nada é enviado;
 * - `code`: manda um código novo, que invalida o anterior (US-016.EC-4);
 * - `account_exists_notice`: o e-mail já tem conta — manda o aviso, sem
 *   código, e a tela segue idêntica (US-016.EC-3).
 *
 * O limite e o duplo envio valem igual com e sem conta: decidir de outro jeito
 * para quem tem conta faria a tela revelar o cadastro.
 */
export type ManualStartDecision = "too_many" | "duplicate" | "code" | "account_exists_notice";

export function decideManualStart(input: {
  accountExists: boolean;
  sentLastHour: number;
  lastSentAt: string | null;
  now: Date;
}): ManualStartDecision {
  if (tooManyCodes(input.sentLastHour)) return "too_many";
  if (resendWaitSeconds(input.lastSentAt, input.now) > 0) return "duplicate";
  return input.accountExists ? "account_exists_notice" : "code";
}

/* -------------------------------- Conclusão ------------------------------- */

export type PendingForCompletion = {
  expiresAt: string;
  completedAt: string | null;
  userId: number | null;
};

export type CompletionDecision =
  | { kind: "create" }
  | { kind: "already"; userId: number }
  | SignupFailure;

/**
 * A conclusão (envio social ou código certo) cria a conta?
 *
 * Em ordem: já concluída há pouco entra na mesma conta (duplo envio); vencida
 * recusa; e-mail que ganhou conta por outro caminho recusa sem duplicar
 * (US-004.EC-4, US-017.EC-7); IP sem vaga na hora recusa (US-006.AC-2).
 */
export function decideCompletion(input: {
  pending: PendingForCompletion;
  emailTaken: boolean;
  completedFromIpLastHour: number;
  maxPerIpHour: number;
  now: Date;
}): CompletionDecision {
  const { pending, now } = input;
  if (pending.completedAt !== null) {
    const recent = now.getTime() - Date.parse(pending.completedAt) <= ALREADY_COMPLETED_MINUTES * MINUTE_MS;
    return recent && pending.userId !== null ? { kind: "already", userId: pending.userId } : fail("expired");
  }
  if (isExpired(pending.expiresAt, now)) return fail("expired");
  if (input.emailTaken) return fail("email_taken");
  if (capReached(input.completedFromIpLastHour, input.maxPerIpHour)) return fail("ip_cap");
  return { kind: "create" };
}
