/**
 * Casos de uso do acesso de recrutador pelo lado do candidato e do admin (#465,
 * ADR-001, ADR-004 – ADR-008, ADR-012, ADR-016, ADR-017).
 *
 * Orquestra; não decide nem grava. A regra (normalizar o e-mail, ler a data de
 * fim, conceder ou convidar, limite) é de `domain/recruiter-access.ts`; a
 * transação com trava, contagem e histórico é do store. Aqui fica a ordem:
 * validar, gravar, e só DEPOIS do commit mandar e-mail — falha de envio vira
 * `auth_event(email_send_failed)` e, no convite, `delivery_failed_at`, sem
 * desfazer o que já valeu.
 *
 * Nenhuma função recebe sessão: o candidato e o autor chegam já tirados dela
 * pela fachada (`index.ts`), que confere `access:manage` ou `user:manage`.
 */
import { DEFAULT_LOCALE, isLocale, type LocaleId } from "../../../core/i18n/index.ts";
import { INVITE_TTL_MS, normalizeEmail, parseEndDate } from "../domain/recruiter-access.ts";
import type { Mailer, OutgoingMail } from "../ports-mailer.ts";
import type {
  AccessFailure,
  EndedNotice,
  GrantRow,
  HistoryPage,
  InviteNotice,
  InviteRow,
  RecruiterAccessStore,
} from "../ports-recruiter-access.ts";
import type { AuthRepository } from "../ports.ts";
import {
  accessEndedEmail,
  accessGrantedEmail,
  endDateChangedEmail,
  inviteEmail,
  type RecruiterEmail,
} from "./recruiter-emails.ts";

/** Itens por página do histórico (TechSpec, "Constants"). */
export const HISTORY_PAGE_SIZE = 20;


export type RecruiterAccessDeps = {
  store: RecruiterAccessStore;
  mailer(): Mailer;
  audit: AuthRepository;
  now(): number;
  /**
   * Origem pública dos links (`resolvePublicOrigin`, G17). Nulo: nenhum link é
   * montado, e o e-mail que precisa de um conta como falha de envio.
   */
  origin: string | null;
  /** Token cru do convite e o SHA-256 dele; só o hash vai para o banco. */
  newToken(): { token: string; hash: string };
};

function localeOf(value: string | null): LocaleId {
  return isLocale(value ?? undefined) ? (value as LocaleId) : DEFAULT_LOCALE;
}

/** Tipo de mensagem gravado em `auth_event.detail` quando o envio falha. */
type MessageKind = "recruiter_invite" | "access_granted" | "end_date_changed" | "access_ended";

/**
 * Manda depois do commit. Erro do provedor e exceção do adapter dão no mesmo:
 * registro para o operador, e a ação continua valendo. O detalhe é só o tipo
 * da mensagem — nem destinatário nem dado do candidato.
 */
async function deliver(
  deps: RecruiterAccessDeps,
  to: string,
  mail: RecruiterEmail | null,
  failure: { kind: MessageKind; userId: number | null },
): Promise<boolean> {
  let delivered = false;
  if (mail !== null) {
    const outgoing: OutgoingMail = { to, subject: mail.subject, text: mail.text };
    try {
      delivered = (await deps.mailer().send(outgoing)).ok;
    } catch {
      delivered = false;
    }
  }
  if (!delivered) {
    await deps.audit.record({ kind: "email_send_failed", userId: failure.userId, detail: failure.kind });
  }
  return delivered;
}

function recruiterPage(deps: RecruiterAccessDeps, candidateId: number): string | null {
  return deps.origin === null ? null : `${deps.origin}/recruiter/${candidateId}`;
}

async function sendInvite(deps: RecruiterAccessDeps, notice: InviteNotice, token: string, actorUserId: number): Promise<void> {
  const url = deps.origin === null ? null : `${deps.origin}/signup/invite?token=${encodeURIComponent(token)}`;
  const mail =
    url === null
      ? null
      : inviteEmail({
          locale: localeOf(notice.candidateLocale),
          candidateName: notice.candidateName,
          url,
          validUntil: notice.validUntil,
          needsRecruiterAccount: notice.needsRecruiterAccount,
        });
  const delivered = await deliver(deps, notice.email, mail, { kind: "recruiter_invite", userId: actorUserId });
  if (!delivered) await deps.store.markDeliveryFailed(notice.inviteId, new Date(deps.now()).toISOString());
}

async function sendEnded(deps: RecruiterAccessDeps, notice: EndedNotice, actorUserId: number | null): Promise<void> {
  const mail = accessEndedEmail({
    locale: localeOf(notice.recruiterLocale),
    candidateName: notice.candidateName,
    cause: notice.cause,
  });
  await deliver(deps, notice.recruiterEmail, mail, { kind: "access_ended", userId: actorUserId });
}

function inviteExpiry(deps: RecruiterAccessDeps): string {
  return new Date(deps.now() + INVITE_TTL_MS).toISOString();
}

/* -------------------------------- Conceder -------------------------------- */

export type GrantResult = { ok: true; kind: "grant" | "invite" } | AccessFailure;

/**
 * Concede a quem já tem conta de recrutador ou convida quem não tem (US-001,
 * US-002). A resposta diz só `grant` ou `invite`: conta sem o papel, conta
 * desabilitada e endereço sem conta dão o mesmo `invite` (US-001.EC-7).
 */
export async function grantAccess(
  input: { candidateId: number; actorUserId: number; email: string; endDate: string; tz: string },
  deps: RecruiterAccessDeps,
): Promise<GrantResult> {
  const email = normalizeEmail(input.email);
  if (!email.ok) return { ok: false, error: email.error };
  const end = parseEndDate({ date: input.endDate, tz: input.tz, now: deps.now() });
  if (!end.ok) return { ok: false, error: end.error };

  const { token, hash } = deps.newToken();
  const result = await deps.store.grantOrInvite({
    candidateId: input.candidateId,
    actorUserId: input.actorUserId,
    email: email.value,
    expiresAt: end.value.expiresAt,
    expiryTz: end.value.expiresAt === null ? null : end.value.tz,
    tokenHash: hash,
    inviteExpiresAt: inviteExpiry(deps),
    nowIso: new Date(deps.now()).toISOString(),
  });
  for (const ended of result.ended) await sendEnded(deps, ended, null);
  if (!result.ok) return { ok: false, error: result.error, ...(result.retryAt ? { retryAt: result.retryAt } : {}) };
  if (result.kind === "invite") {
    await sendInvite(deps, result.notice, token, input.actorUserId);
    return { ok: true, kind: "invite" };
  }
  const url = recruiterPage(deps, result.notice.candidateId);
  const mail =
    url === null
      ? null
      : accessGrantedEmail({
          locale: localeOf(result.notice.recruiterLocale),
          candidateName: result.notice.candidateName,
          url,
          expiresAt: result.notice.expiresAt,
          expiryTz: result.notice.expiryTz,
        });
  await deliver(deps, result.notice.recruiterEmail, mail, { kind: "access_granted", userId: input.actorUserId });
  return { ok: true, kind: "grant" };
}

/* -------------------------------- Encerrar -------------------------------- */

export type SimpleResult = { ok: true } | AccessFailure;

/**
 * Revoga (US-008, US-023): UPDATE condicional dentro da transação do store; só
 * quem venceu a corrida manda o e-mail. `candidateId` nulo é o admin, que
 * alcança qualquer concessão e entra no histórico com o próprio nome.
 */
export async function revokeAccess(
  input: { grantId: number; candidateId: number | null; actor: "candidate" | "admin"; actorUserId: number },
  deps: RecruiterAccessDeps,
): Promise<SimpleResult> {
  const result = await deps.store.endGrant({ ...input, nowIso: new Date(deps.now()).toISOString() });
  if (!result.ok) return result;
  await sendEnded(deps, result.notice, input.actorUserId);
  return { ok: true };
}

/** Põe, move ou tira a data de fim (US-006.AC-3). A mesma data de novo não grava nem avisa. */
export async function changeEndDate(
  input: { grantId: number; candidateId: number; actorUserId: number; endDate: string; tz: string },
  deps: RecruiterAccessDeps,
): Promise<SimpleResult> {
  const end = parseEndDate({ date: input.endDate, tz: input.tz, now: deps.now() });
  if (!end.ok) return { ok: false, error: end.error };
  const result = await deps.store.setEndDate({
    grantId: input.grantId,
    candidateId: input.candidateId,
    actorUserId: input.actorUserId,
    expiresAt: end.value.expiresAt,
    expiryTz: end.value.expiresAt === null ? null : end.value.tz,
    nowIso: new Date(deps.now()).toISOString(),
  });
  if (!result.ok) return result;
  if (!result.changed) return { ok: true };
  const url = recruiterPage(deps, result.notice.candidateId);
  const mail =
    url === null
      ? null
      : endDateChangedEmail({
          locale: localeOf(result.notice.recruiterLocale),
          candidateName: result.notice.candidateName,
          url,
          expiresAt: result.notice.expiresAt,
          expiryTz: result.notice.expiryTz,
        });
  await deliver(deps, result.notice.recruiterEmail, mail, { kind: "end_date_changed", userId: input.actorUserId });
  return { ok: true };
}

/* --------------------------------- Convites -------------------------------- */

/** Novo link de 7 dias; o anterior vira `superseded` na mesma transação (US-009.AC-1). */
export async function resendInvite(
  input: { inviteId: number; candidateId: number; actorUserId: number },
  deps: RecruiterAccessDeps,
): Promise<SimpleResult> {
  const { token, hash } = deps.newToken();
  const result = await deps.store.resendInvite({
    ...input,
    tokenHash: hash,
    inviteExpiresAt: inviteExpiry(deps),
    nowIso: new Date(deps.now()).toISOString(),
  });
  if (!result.ok) return result;
  await sendInvite(deps, result.notice, token, input.actorUserId);
  return { ok: true };
}

/** Cancela sem avisar ninguém (US-009.EC-5). Cancelar de novo devolve ok sem mudar nada. */
export async function cancelInvite(
  input: { inviteId: number; candidateId: number | null; actor: "candidate" | "admin"; actorUserId: number },
  deps: RecruiterAccessDeps,
): Promise<SimpleResult> {
  const result = await deps.store.cancelInvite({ ...input, nowIso: new Date(deps.now()).toISOString() });
  return result.ok ? { ok: true } : result;
}

/** Tira da lista o convite vencido; o histórico não muda (US-009.AC-3). */
export async function dismissInvite(
  input: { inviteId: number; candidateId: number },
  deps: RecruiterAccessDeps,
): Promise<SimpleResult> {
  const result = await deps.store.dismissInvite({ ...input, nowIso: new Date(deps.now()).toISOString() });
  return result.ok ? { ok: true } : result;
}

/* --------------------------------- Varredura ------------------------------- */

/**
 * O trabalho horário da varredura (ADR-016): fecha concessões vencidas com um
 * e-mail cada e convites vencidos sem e-mail. Rodar de novo não acha nada.
 */
export async function expireRecruiterAccess(deps: RecruiterAccessDeps): Promise<{ expired: number; invitesExpired: number }> {
  const result = await deps.store.expireDue(new Date(deps.now()).toISOString());
  for (const notice of result.ended) await sendEnded(deps, notice, null);
  return { expired: result.ended.length, invitesExpired: result.invitesExpired };
}

/* --------------------------------- Leituras -------------------------------- */

export type CandidateAccessView = {
  grants: GrantRow[];
  invites: InviteRow[];
  history: HistoryPage;
};

/** Página do histórico a partir do parâmetro da URL: inteiro de 1 em diante, e o resto cai em 1. */
export function historyPageOf(raw: string | undefined): number {
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

/** A seção "Acesso de recrutadores" de `/account`: quem acessa, convites e histórico paginado. */
export async function candidateAccessView(
  input: { candidateId: number; historyPage: number },
  deps: Pick<RecruiterAccessDeps, "store" | "now">,
): Promise<CandidateAccessView> {
  const nowIso = new Date(deps.now()).toISOString();
  const [grants, invites, history] = await Promise.all([
    deps.store.grantsOf(input.candidateId, nowIso),
    deps.store.invitesOf(input.candidateId, nowIso),
    deps.store.history(input.candidateId, input.historyPage, HISTORY_PAGE_SIZE),
  ]);
  const pages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));
  return { grants, invites, history: { rows: history.rows, page: input.historyPage, pages, total: history.total } };
}
