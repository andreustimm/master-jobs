/**
 * Regras do acesso de recrutador concedido pelo candidato (#465), puras.
 *
 * Sem banco, rede nem relógio implícito (G05): o instante entra como `now` e o
 * fuso como texto. Quem decide aqui é o que mais custa errar — para qual
 * endereço o consentimento vale, quando o acesso acaba e se um convite pode
 * virar acesso —, e por isso cada regra é testada sem I/O
 * (`tests/recruiter-access-rules.test.ts`).
 */

/** Validade do link de convite (ADR-006). */
export const INVITE_TTL_MS = 7 * 86_400_000;
/** Concessões e convites por candidato em 24 h (ADR-006, ADR-017). */
export const CANDIDATE_DAILY_CAP = 10;
/** Convites pendentes por candidato (ADR-006). */
export const PENDING_INVITE_CAP = 20;
/** Janela do limite diário. */
export const CAP_WINDOW_MS = 86_400_000;
/** A data de fim fica a no máximo isto, em anos, de hoje (US-006.EC-2). */
export const END_DATE_MAX_YEARS = 5;
/** RFC 5321: o caminho inteiro do endereço cabe em 254 caracteres. */
export const EMAIL_MAX_LENGTH = 254;

export const GRANT_STATUSES = ["active", "revoked", "expired", "ended_account_removed"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export const INVITE_STATUSES = ["pending", "accepted", "expired", "cancelled", "superseded"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/** Os tipos de linha do histórico; o CHECK da tabela repete esta lista. */
export const ACCESS_EVENT_KINDS = [
  "invite_sent",
  "invite_resent",
  "invite_cancelled",
  "invite_expired",
  "invite_accepted",
  "grant_created",
  "end_date_changed",
  "access_revoked",
  "access_expired",
  "access_ended_account_removed",
  "suggestion_received",
  "suggestion_accepted",
  "suggestion_declined",
] as const;
export type AccessEventKind = (typeof ACCESS_EVENT_KINDS)[number];

export const ACCESS_ACTORS = ["candidate", "admin", "recruiter", "system"] as const;
export type AccessActor = (typeof ACCESS_ACTORS)[number];

export type AccessError =
  | "blank_email"
  | "invalid_email"
  | "self"
  | "already_active"
  | "already_invited"
  | "cap_reached"
  | "too_many_pending"
  | "date_invalid"
  | "date_past"
  | "date_too_far"
  | "already_ended"
  | "not_found";

export type AccessResult<T> = { ok: true; value: T } | { ok: false; error: AccessError; retryAt?: string };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * O endereço como o consentimento o guarda: sem espaço nas pontas e em
 * minúsculas.
 *
 * Nada além disso. Ponto e `+` no Gmail continuam distintos (US-004.EC-3): o
 * candidato consentiu com o endereço que digitou, e reescrever variações
 * entregaria o acesso a uma caixa que ele não nomeou.
 */
export function normalizeEmail(raw: string): AccessResult<string> {
  const value = raw.trim().toLowerCase();
  if (value === "") return { ok: false, error: "blank_email" };
  if (value.length > EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(value)) return { ok: false, error: "invalid_email" };
  return { ok: true, value };
}

/** O fuso pedido, se o runtime o conhece; senão UTC. */
function knownZone(tz: string): string {
  if (tz.trim() === "") return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Parte de data e hora de parede de um instante, no fuso. */
function wallClock(instant: number, tz: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Diferença entre a hora de parede no fuso e o UTC, em ms, naquele instante. */
function offsetAt(instant: number, tz: string): number {
  const w = wallClock(instant, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** O instante da meia-noite de parede (y-m-d 00:00) no fuso. Duas passadas cobrem o horário de verão. */
function midnightIn(y: number, m: number, d: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess - offsetAt(guess, tz);
  instant = guess - offsetAt(instant, tz);
  return instant;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** `YYYY-MM-DD` de hoje no fuso. */
function localToday(now: number, tz: string): string {
  const w = wallClock(now, tz);
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
}

/**
 * Data de fim do acesso, escolhida no navegador, para o instante que o banco
 * guarda (ADR-016).
 *
 * O acesso vale até o fim do dia escolhido (23:59:59.999) no fuso de quem
 * escolheu; o fuso é guardado ao lado para a tela e o e-mail mostrarem o mesmo
 * dia. Fuso desconhecido ou vazio vira UTC — o lado previsível, já que o
 * navegador é quem informa. Vazio é "sem fim".
 *
 * Recusa: formato que não seja `YYYY-MM-DD` de um dia real (`date_invalid`),
 * hoje ou antes no fuso (`date_past`) e mais de 5 anos à frente
 * (`date_too_far`).
 */
export function parseEndDate(input: { date: string; tz: string; now: number }): AccessResult<{
  expiresAt: string | null;
  tz: string;
}> {
  const tz = knownZone(input.tz);
  const date = input.date.trim();
  if (date === "") return { ok: true, value: { expiresAt: null, tz } };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return { ok: false, error: "date_invalid" };
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return { ok: false, error: "date_invalid" };
  }

  const today = localToday(input.now, tz);
  if (date <= today) return { ok: false, error: "date_past" };
  const limit = `${pad(Number(today.slice(0, 4)) + END_DATE_MAX_YEARS, 4)}${today.slice(4)}`;
  if (date > limit) return { ok: false, error: "date_too_far" };

  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = midnightIn(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz) - 1;
  return { ok: true, value: { expiresAt: new Date(end).toISOString(), tz } };
}

/**
 * Conceder direto ou convidar.
 *
 * Concede direto só a uma conta habilitada, com papel de recrutador e e-mail
 * provado (US-001). Qualquer outra situação — conta inexistente, desabilitada,
 * sem o papel ou sem e-mail confirmado — vira convite, e a tela responde igual
 * nos dois casos: o candidato não descobre que uma conta existe (US-001.EC-7).
 * O próprio endereço do candidato é recusado antes de tudo.
 */
export function grantTarget(input: {
  email: string;
  candidateEmails: readonly string[];
  account: { id: number; roles: readonly string[]; disabled: boolean; emailVerified: boolean } | null;
}): "self" | "grant" | "invite" {
  const email = input.email.trim().toLowerCase();
  if (input.candidateEmails.some((own) => own.trim().toLowerCase() === email)) return "self";
  const account = input.account;
  if (account && account.roles.includes("recruiter") && !account.disabled && account.emailVerified) return "grant";
  return "invite";
}

/**
 * Limite em janela móvel.
 *
 * Conta os instantes dentro de `(now - windowMs, now]`; o que caiu exatamente
 * na borda já saiu. Cheio, devolve quando a contagem volta a caber: o instante
 * em que sai da janela o registro cuja saída libera a vaga.
 */
export function capDecision(
  countedAt: readonly string[],
  now: number,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAt: string } {
  const inside = countedAt
    .map((iso) => Date.parse(iso))
    .filter((t) => !Number.isNaN(t) && t > now - windowMs && t <= now)
    .sort((a, b) => a - b);
  if (inside.length < limit) return { ok: true };
  const freeing = inside[inside.length - limit]!;
  return { ok: false, retryAt: new Date(freeing + windowMs).toISOString() };
}

export type InviteOutcome = "completed" | "mismatch" | "not_recruiter" | "period_over" | "invalid";

/**
 * Um convite pode virar acesso para esta conta?
 *
 * `invalid` cobre tudo que a página neutra trata igual (US-003.EC-1 a EC-3,
 * EC-10): convite desconhecido, já decidido, vencido ou de candidato
 * desabilitado — nada revela qual foi. Depois, o e-mail: só o endereço que o
 * candidato digitou, comparado normalizado e provado pela conta (US-004);
 * e-mail não confirmado conta como outro endereço. Em seguida a conta precisa
 * ser de recrutador habilitado, e o prazo escolhido no convite não pode ter
 * passado (US-006.EC-5).
 */
export function inviteCompletion(input: {
  invite: { status: InviteStatus; email: string; expiresAt: string; accessExpiresAt: string | null } | null;
  candidateEnabled: boolean;
  account: { email: string; roles: readonly string[]; disabled: boolean; emailVerified: boolean };
  now: number;
}): InviteOutcome {
  const { invite, account, now } = input;
  if (invite === null || invite.status !== "pending") return "invalid";
  const linkEnds = Date.parse(invite.expiresAt);
  if (Number.isNaN(linkEnds) || linkEnds <= now) return "invalid";
  if (!input.candidateEnabled) return "invalid";
  const invited = invite.email.trim().toLowerCase();
  if (account.email.trim().toLowerCase() !== invited || !account.emailVerified) return "mismatch";
  if (!account.roles.includes("recruiter") || account.disabled) return "not_recruiter";
  if (invite.accessExpiresAt !== null && Date.parse(invite.accessExpiresAt) <= now) return "period_over";
  return "completed";
}

export type GrantDisplay = "active" | "account_disabled" | "not_recruiter";

/**
 * Como a lista do candidato marca uma concessão ativa (US-007.EC-4, EC-6).
 *
 * Conta desabilitada ou sem o papel já não acessa nada — o predicado da sessão
 * corta —, mas a concessão continua ativa e revogável; a marca diz por quê.
 * Sem conta (nulo) não há recrutador capaz de usar o acesso.
 */
export function grantDisplay(recruiter: { disabled: boolean; roles: readonly string[] } | null): GrantDisplay {
  if (recruiter === null) return "not_recruiter";
  if (recruiter.disabled) return "account_disabled";
  if (!recruiter.roles.includes("recruiter")) return "not_recruiter";
  return "active";
}

/**
 * Endereço mascarado para a mensagem "este convite é para…" (US-003.EC-6):
 * a primeira letra, três pontos e o domínio. O tamanho do nome não vaza.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}
