/**
 * O contrato entre os casos de uso do acesso de recrutador
 * (`app/recruiter-access.ts`) e o banco (`infra/drizzle-recruiter-access.ts`),
 * #465.
 *
 * Não é porta de variação — só há Postgres —, é a forma de o caso de uso
 * receber o store por composição e de o teste o dirigir com mailer e relógio
 * próprios (regra 4). Mora fora de `app/` e de `infra/` para nenhum dos dois
 * importar o outro.
 */
import type { AccessError, GrantDisplay } from "./domain/recruiter-access.ts";

/** Por que o acesso acabou, como o e-mail ao recrutador conta (`accessEndedEmail`). */
export type AccessEndCause = "candidate" | "admin" | "expired";

export type AccessFailure = { ok: false; error: AccessError; retryAt?: string };

/** Para quem vai o e-mail ao recrutador e em que idioma. */
export type RecruiterNotice = {
  recruiterEmail: string;
  recruiterUserId: number | null;
  recruiterLocale: string | null;
  candidateId: number;
  candidateName: string;
};

export type InviteNotice = {
  inviteId: number;
  email: string;
  candidateId: number;
  candidateName: string;
  /** O convite sai no idioma da conta do candidato (US-002.AC-2). */
  candidateLocale: string | null;
  validUntil: string;
  needsRecruiterAccount: boolean;
};

export type EndedNotice = RecruiterNotice & { cause: AccessEndCause };

/**
 * `ended` acompanha também a recusa: a transação fecha as concessões vencidas
 * do par antes de decidir, e o aviso de fim delas sai de qualquer jeito.
 */
export type GrantStoreResult =
  | (AccessFailure & { ended: EndedNotice[] })
  | {
      ok: true;
      kind: "grant";
      notice: RecruiterNotice & { expiresAt: string | null; expiryTz: string | null };
      /** Concessões vencidas que a mesma transação encerrou para abrir espaço. */
      ended: EndedNotice[];
    }
  | { ok: true; kind: "invite"; notice: InviteNotice; ended: EndedNotice[] };

export type EndStoreResult = { ok: true; notice: EndedNotice } | AccessFailure;

export type EndDateStoreResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; notice: RecruiterNotice & { expiresAt: string | null; expiryTz: string | null } }
  | AccessFailure;

export type ResendStoreResult = { ok: true; notice: InviteNotice } | AccessFailure;

export type ChangeStoreResult = { ok: true; changed: boolean } | AccessFailure;

export type GrantRow = {
  id: number;
  recruiterEmail: string;
  recruiterName: string | null;
  display: GrantDisplay;
  createdAt: string;
  expiresAt: string | null;
  expiryTz: string | null;
  lastAccessedAt: string | null;
};

export type InviteRow = {
  id: number;
  email: string;
  createdAt: string;
  expiresAt: string;
  accessExpiresAt: string | null;
  expiryTz: string | null;
  /** `expired` também para o pendente cujo link já venceu e a varredura ainda não marcou. */
  status: "pending" | "expired";
  deliveryFailed: boolean;
};

export type HistoryRow = {
  id: number;
  kind: string;
  actor: string;
  actorName: string | null;
  recruiterEmail: string;
  detail: string | null;
  at: string;
};

export type HistoryPage = { rows: HistoryRow[]; page: number; pages: number; total: number };

export type AdminCandidateAccess = {
  grants: { id: number; recruiterEmail: string; recruiterName: string | null; createdAt: string; expiresAt: string | null; expiryTz: string | null }[];
  invites: { id: number; email: string; createdAt: string; expiresAt: string }[];
};

/** O que o caso de uso precisa do banco. Implementado em `infra/drizzle-recruiter-access.ts`. */
export type RecruiterAccessStore = {
  grantOrInvite(input: {
    candidateId: number;
    actorUserId: number;
    email: string;
    expiresAt: string | null;
    expiryTz: string | null;
    tokenHash: string;
    inviteExpiresAt: string;
    nowIso: string;
  }): Promise<GrantStoreResult>;
  endGrant(input: {
    grantId: number;
    /** Nulo só para o admin, que revoga de qualquer candidato. */
    candidateId: number | null;
    actor: "candidate" | "admin";
    actorUserId: number;
    nowIso: string;
  }): Promise<EndStoreResult>;
  setEndDate(input: {
    grantId: number;
    candidateId: number;
    actorUserId: number;
    expiresAt: string | null;
    expiryTz: string | null;
    nowIso: string;
  }): Promise<EndDateStoreResult>;
  resendInvite(input: {
    inviteId: number;
    candidateId: number;
    actorUserId: number;
    tokenHash: string;
    inviteExpiresAt: string;
    nowIso: string;
  }): Promise<ResendStoreResult>;
  cancelInvite(input: {
    inviteId: number;
    candidateId: number | null;
    actor: "candidate" | "admin";
    actorUserId: number;
    nowIso: string;
  }): Promise<ChangeStoreResult>;
  dismissInvite(input: { inviteId: number; candidateId: number; nowIso: string }): Promise<ChangeStoreResult>;
  markDeliveryFailed(inviteId: number, nowIso: string): Promise<void>;
  /** Fecha o que venceu: concessões (`expired`) e convites pendentes. */
  expireDue(nowIso: string): Promise<{ ended: EndedNotice[]; invitesExpired: number }>;
  grantsOf(candidateId: number, nowIso: string): Promise<GrantRow[]>;
  invitesOf(candidateId: number, nowIso: string): Promise<InviteRow[]>;
  history(candidateId: number, page: number, pageSize: number): Promise<{ rows: HistoryRow[]; total: number }>;
  adminOverview(candidateIds: readonly number[], nowIso: string): Promise<Map<number, AdminCandidateAccess>>;
};
