/**
 * Concessões de acesso de recrutador sobre Drizzle (#465, ADR-011, ADR-012).
 *
 * Um dos três arquivos autorizados a importar `recruiterGrant`
 * (`tests/architecture.test.ts`); os outros dois são `drizzle-store.ts`, que
 * lê o acesso na carga da sessão, e `drizzle-directory.ts`, que administra.
 * Aqui moram as peças que os dois compartilham — o predicado de acesso e o
 * encerramento —, para que exista um jeito só de dizer "ativa" e um jeito só
 * de encerrar.
 *
 * O histórico (`recruiter_access_event`) só recebe INSERT. Nenhuma função
 * deste arquivo, nem de outro, o atualiza ou apaga.
 */
import { and, asc, count, desc, eq, gt, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DB, type DbTransaction } from "../../../core/db/client.ts";
import { authUser, candidate, recruiterAccessEvent, recruiterGrant, recruiterInvite } from "../../../core/db/schema.ts";
import { firstNonEmpty } from "../../../core/sources/http.ts";
import {
  CANDIDATE_DAILY_CAP,
  CAP_WINDOW_MS,
  PENDING_INVITE_CAP,
  capDecision,
  grantDisplay,
  grantTarget,
  type AccessActor,
  type AccessEventKind,
  type GrantStatus,
} from "../domain/recruiter-access.ts";
import type { Role } from "../domain/types.ts";
import type {
  AdminCandidateAccess,
  EndedNotice,
  GrantRow,
  InviteNotice,
  InviteRow,
  RecruiterAccessStore,
  RecruiterNotice,
} from "../ports-recruiter-access.ts";

type Executor = DB | DbTransaction;

/**
 * A concessão vale agora: `active` e sem fim ou com fim depois de `nowIso`.
 *
 * É o corte de revogação, prazo e encerramento por conta removida (ADR-012).
 * Papel removido e conta desabilitada são cortados antes, na sessão. O texto
 * ISO em UTC compara em ordem cronológica, que é como todo instante é gravado.
 */
export function activeGrantCondition(nowIso: string): SQL {
  return and(
    eq(recruiterGrant.status, "active"),
    or(isNull(recruiterGrant.expiresAt), gt(recruiterGrant.expiresAt, nowIso)),
  )!;
}

/** Concessões que valem agora para um recrutador, com o id da concessão. */
export async function activeGrantsOf(
  db: Executor,
  recruiterUserId: number,
  nowIso: string,
): Promise<{ id: number; candidateId: number }[]> {
  return db
    .select({ id: recruiterGrant.id, candidateId: recruiterGrant.candidateId })
    .from(recruiterGrant)
    .where(and(eq(recruiterGrant.recruiterUserId, recruiterUserId), activeGrantCondition(nowIso)))
    .orderBy(recruiterGrant.id);
}

export type HistoryEntry = {
  candidateId: number;
  recruiterEmail: string;
  kind: AccessEventKind;
  actor: AccessActor;
  grantId?: number | null;
  inviteId?: number | null;
  actorUserId?: number | null;
  actorName?: string | null;
  detail?: string | null;
  at: string;
};

/** Acrescenta ao histórico. A única escrita que a tabela aceita. */
export async function appendHistory(db: Executor, entries: readonly HistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(recruiterAccessEvent).values(
    entries.map((entry) => ({
      candidateId: entry.candidateId,
      grantId: entry.grantId ?? null,
      inviteId: entry.inviteId ?? null,
      recruiterEmail: entry.recruiterEmail,
      kind: entry.kind,
      actor: entry.actor,
      actorUserId: entry.actorUserId ?? null,
      actorName: entry.actorName ?? null,
      detail: entry.detail ?? null,
      at: entry.at,
    })),
  );
}

/**
 * Grava uma concessão ativa e o `grant_created`, na transação de quem chama.
 *
 * Devolve `null` quando já existe concessão ativa para o par: o índice único
 * parcial decide, não uma leitura anterior, e por isso duplo envio não cria
 * duas nem grava dois eventos.
 */
export async function insertActiveGrant(
  tx: DbTransaction,
  input: {
    candidateId: number;
    recruiterUserId: number;
    recruiterEmail: string;
    createdBy: number | null;
    actor: AccessActor;
    at: string;
    inviteId?: number | null;
    expiresAt?: string | null;
    expiryTz?: string | null;
  },
): Promise<number | null> {
  const [row] = await tx
    .insert(recruiterGrant)
    .values({
      candidateId: input.candidateId,
      recruiterUserId: input.recruiterUserId,
      recruiterEmail: input.recruiterEmail,
      status: "active",
      inviteId: input.inviteId ?? null,
      createdBy: input.createdBy,
      createdAt: input.at,
      expiresAt: input.expiresAt ?? null,
      expiryTz: input.expiryTz ?? null,
    })
    .onConflictDoNothing({
      target: [recruiterGrant.candidateId, recruiterGrant.recruiterUserId],
      where: eq(recruiterGrant.status, "active"),
    })
    .returning({ id: recruiterGrant.id });
  if (!row) return null;
  await appendHistory(tx, [
    {
      candidateId: input.candidateId,
      grantId: row.id,
      inviteId: input.inviteId ?? null,
      recruiterEmail: input.recruiterEmail,
      kind: "grant_created",
      actor: input.actor,
      actorUserId: input.actor === "system" ? null : input.createdBy,
      at: input.at,
    },
  ]);
  return row.id;
}

export type EndedGrant = { id: number; candidateId: number; recruiterUserId: number | null; recruiterEmail: string };

export type EndGrantResult = { ok: true; grant: EndedGrant } | { ok: false; error: "already_ended" | "not_found" };

/**
 * Encerra uma concessão: UPDATE condicional em `status = 'active'` e o
 * histórico na mesma transação (ADR-012).
 *
 * De dois encerramentos concorrentes, o segundo espera o lock da linha, relê o
 * `where` depois do commit do primeiro e atualiza zero linhas: devolve
 * `already_ended`, e só o vencedor grava histórico e manda e-mail. O id que não
 * existe devolve `not_found`.
 */
export async function endGrant(
  db: DB,
  input: {
    grantId: number;
    status: Exclude<GrantStatus, "active">;
    kind: AccessEventKind;
    actor: AccessActor;
    actorUserId: number | null;
    actorName: string | null;
    revokedBy: number | null;
    at: string;
    /**
     * Só concessões deste candidato (US-008.EC-7): o id de outro devolve
     * `not_found`, igual ao que não existe. Ausente só para o admin.
     */
    candidateId?: number | null;
    /**
     * Ativa e ainda no prazo neste instante: a que venceu e a varredura não
     * marcou já terminou para o recrutador, e revogá-la mandaria um segundo
     * aviso de fim (US-008.EC-4).
     */
    liveAt?: string;
  },
): Promise<EndGrantResult> {
  const scope = input.candidateId == null ? undefined : eq(recruiterGrant.candidateId, input.candidateId);
  return db.transaction(async (tx) => {
    const [ended] = await tx
      .update(recruiterGrant)
      .set({ status: input.status, endedAt: input.at, revokedBy: input.revokedBy })
      .where(
        and(
          eq(recruiterGrant.id, input.grantId),
          scope,
          input.liveAt === undefined ? eq(recruiterGrant.status, "active") : activeGrantCondition(input.liveAt),
        ),
      )
      .returning({
        id: recruiterGrant.id,
        candidateId: recruiterGrant.candidateId,
        recruiterUserId: recruiterGrant.recruiterUserId,
        recruiterEmail: recruiterGrant.recruiterEmail,
      });
    if (!ended) {
      const [exists] = await tx
        .select({ id: recruiterGrant.id })
        .from(recruiterGrant)
        .where(and(eq(recruiterGrant.id, input.grantId), scope))
        .limit(1);
      return { ok: false as const, error: exists ? ("already_ended" as const) : ("not_found" as const) };
    }
    await appendHistory(tx, [
      {
        candidateId: ended.candidateId,
        grantId: ended.id,
        recruiterEmail: ended.recruiterEmail,
        kind: input.kind,
        actor: input.actor,
        actorUserId: input.actorUserId,
        actorName: input.actorName,
        at: input.at,
      },
    ]);
    return { ok: true as const, grant: ended };
  });
}

/**
 * Encerra todas as concessões ativas de uma conta que vai ser apagada, na
 * transação da exclusão e antes dela (ADR-012): depois do DELETE a FK zera
 * `recruiter_user_id`, e o CHECK recusaria concessão ativa sem recrutador.
 * O histórico guarda o e-mail, que sobrevive à conta.
 */
export async function endGrantsOfRemovedAccount(tx: DbTransaction, recruiterUserId: number, at: string): Promise<number> {
  const ended = await tx
    .update(recruiterGrant)
    .set({ status: "ended_account_removed", endedAt: at })
    .where(and(eq(recruiterGrant.recruiterUserId, recruiterUserId), eq(recruiterGrant.status, "active")))
    .returning({
      id: recruiterGrant.id,
      candidateId: recruiterGrant.candidateId,
      recruiterEmail: recruiterGrant.recruiterEmail,
    });
  await appendHistory(
    tx,
    ended.map((grant) => ({
      candidateId: grant.candidateId,
      grantId: grant.id,
      recruiterEmail: grant.recruiterEmail,
      kind: "access_ended_account_removed" as const,
      actor: "system" as const,
      at,
    })),
  );
  return ended.length;
}

/** Nome do administrador no momento do ato, para o histórico: nome de exibição ou, sem ele, o e-mail. */
export async function actorNameOf(db: Executor, userId: number): Promise<string | null> {
  const [row] = await db
    .select({ fullName: authUser.fullName, email: authUser.email })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);
  if (!row) return null;
  return firstNonEmpty(row.fullName, row.email);
}

/* -------------------------------------------------------------------------- */
/* Store do caso de uso (task_02): conceder, convidar, encerrar, listar        */
/* -------------------------------------------------------------------------- */

/** Os tipos de evento que gastam o limite diário quando o autor é o candidato (ADR-017). */
const COUNTED_KINDS = ["grant_created", "invite_sent", "invite_resent"] as const;

/**
 * Serializa as escritas de acesso de UM candidato (ADR-017, G13): conceder,
 * convidar, reenviar e sugerir tomam a mesma trava antes de contar. Duas
 * requisições no limite não leem a mesma contagem e passam juntas — a segunda
 * espera o commit da primeira e conta o evento que ela gravou.
 */
export async function lockCandidateAccess(db: Executor, candidateId: number): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('recruiter-access'), ${candidateId})`);
}

/** Nome para os e-mails, os endereços que são do próprio candidato e o idioma da conta dele. */
async function candidateFacts(
  db: Executor,
  candidateId: number,
): Promise<{ name: string; emails: string[]; locale: string | null }> {
  const [row] = await db
    .select({ name: candidate.name, email: candidate.email })
    .from(candidate)
    .where(eq(candidate.id, candidateId))
    .limit(1);
  const accounts = await db
    .select({ email: authUser.email, fullName: authUser.fullName, locale: authUser.locale })
    .from(authUser)
    .where(eq(authUser.candidateId, candidateId));
  const account = accounts[0];
  return {
    name: firstNonEmpty(row?.name, account?.fullName, account?.email) ?? "",
    emails: [...accounts.map((a) => a.email), ...(row?.email ? [row.email] : [])],
    locale: account?.locale ?? null,
  };
}

async function localesOf(db: Executor, userIds: readonly (number | null)[]): Promise<Map<number, string | null>> {
  const ids = [...new Set(userIds.filter((id): id is number => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: authUser.id, locale: authUser.locale }).from(authUser).where(inArray(authUser.id, ids));
  return new Map(rows.map((row) => [row.id, row.locale]));
}

type EndedRow = { id: number; candidateId: number; recruiterUserId: number | null; recruiterEmail: string };

/** Destinatário, idioma e nome do candidato para cada concessão encerrada. */
async function endedNotices(db: Executor, rows: readonly EndedRow[], cause: EndedNotice["cause"]): Promise<EndedNotice[]> {
  if (rows.length === 0) return [];
  const locales = await localesOf(db, rows.map((row) => row.recruiterUserId));
  const names = new Map<number, string>();
  for (const id of new Set(rows.map((row) => row.candidateId))) names.set(id, (await candidateFacts(db, id)).name);
  return rows.map((row) => ({
    recruiterEmail: row.recruiterEmail,
    recruiterUserId: row.recruiterUserId,
    recruiterLocale: row.recruiterUserId === null ? null : (locales.get(row.recruiterUserId) ?? null),
    candidateId: row.candidateId,
    candidateName: names.get(row.candidateId) ?? "",
    cause,
  }));
}

const ENDED_COLUMNS = {
  id: recruiterGrant.id,
  candidateId: recruiterGrant.candidateId,
  recruiterUserId: recruiterGrant.recruiterUserId,
  recruiterEmail: recruiterGrant.recruiterEmail,
};

/**
 * Fecha o que já venceu: concessão ativa com fim no passado vira `expired`, e
 * convite pendente com link vencido vira `expired`, cada um com o evento do
 * sistema. É o passo 1 e 2 da varredura (ADR-016) e também o que a concessão
 * nova faz antes de gravar, no recorte do par: os índices únicos parciais
 * contam a linha vencida como `active`/`pending` até alguém a marcar.
 */
async function expireWhere(
  tx: DbTransaction,
  nowIso: string,
  scope: { grants?: SQL; invites?: SQL } = {},
): Promise<{ ended: EndedRow[]; invitesExpired: number }> {
  const ended = await tx
    .update(recruiterGrant)
    .set({ status: "expired", endedAt: nowIso })
    .where(and(eq(recruiterGrant.status, "active"), lte(recruiterGrant.expiresAt, nowIso), scope.grants))
    .returning(ENDED_COLUMNS);
  await appendHistory(
    tx,
    ended.map((grant) => ({
      candidateId: grant.candidateId,
      grantId: grant.id,
      recruiterEmail: grant.recruiterEmail,
      kind: "access_expired" as const,
      actor: "system" as const,
      at: nowIso,
    })),
  );
  const invites = await tx
    .update(recruiterInvite)
    .set({ status: "expired", decidedAt: nowIso })
    .where(and(eq(recruiterInvite.status, "pending"), lte(recruiterInvite.expiresAt, nowIso), scope.invites))
    .returning({ id: recruiterInvite.id, candidateId: recruiterInvite.candidateId, email: recruiterInvite.email });
  await appendHistory(
    tx,
    invites.map((invite) => ({
      candidateId: invite.candidateId,
      inviteId: invite.id,
      recruiterEmail: invite.email,
      kind: "invite_expired" as const,
      actor: "system" as const,
      at: nowIso,
    })),
  );
  return { ended, invitesExpired: invites.length };
}

/** Os instantes das ações do candidato que contam no limite, dentro da janela. */
async function countedSince(tx: DbTransaction, candidateId: number, sinceIso: string): Promise<string[]> {
  const rows = await tx
    .select({ at: recruiterAccessEvent.at })
    .from(recruiterAccessEvent)
    .where(
      and(
        eq(recruiterAccessEvent.candidateId, candidateId),
        eq(recruiterAccessEvent.actor, "candidate"),
        inArray(recruiterAccessEvent.kind, [...COUNTED_KINDS]),
        gt(recruiterAccessEvent.at, sinceIso),
      ),
    );
  return rows.map((row) => row.at);
}

function dailyCap(counted: readonly string[], nowIso: string) {
  return capDecision(counted, Date.parse(nowIso), CANDIDATE_DAILY_CAP, CAP_WINDOW_MS);
}

/** Convites pendentes com link ainda válido, menos o que vai ser substituído. */
async function livePendingInvites(tx: DbTransaction, candidateId: number, nowIso: string, except?: number): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(recruiterInvite)
    .where(
      and(
        eq(recruiterInvite.candidateId, candidateId),
        eq(recruiterInvite.status, "pending"),
        gt(recruiterInvite.expiresAt, nowIso),
        except === undefined ? undefined : ne(recruiterInvite.id, except),
      ),
    );
  return Number(row?.n ?? 0);
}

/** A concessão que vale agora para este endereço ou para esta conta. */
async function liveGrantFor(
  tx: DbTransaction,
  candidateId: number,
  email: string,
  accountId: number | null,
  nowIso: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: recruiterGrant.id })
    .from(recruiterGrant)
    .where(
      and(
        eq(recruiterGrant.candidateId, candidateId),
        activeGrantCondition(nowIso),
        accountId === null
          ? eq(recruiterGrant.recruiterEmail, email)
          : or(eq(recruiterGrant.recruiterEmail, email), eq(recruiterGrant.recruiterUserId, accountId)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function accountByEmail(tx: DbTransaction, email: string) {
  const [row] = await tx
    .select({
      id: authUser.id,
      roles: authUser.roles,
      disabledAt: authUser.disabledAt,
      emailVerifiedAt: authUser.emailVerifiedAt,
      locale: authUser.locale,
    })
    .from(authUser)
    .where(eq(authUser.email, email))
    .limit(1);
  return row ?? null;
}

function rolesOf(value: unknown): Role[] {
  return Array.isArray(value) ? (value as Role[]) : [];
}

async function insertInvite(
  tx: DbTransaction,
  input: {
    candidateId: number;
    email: string;
    tokenHash: string;
    expiresAt: string;
    accessExpiresAt: string | null;
    expiryTz: string | null;
    createdBy: number;
    kind: "invite_sent" | "invite_resent";
    nowIso: string;
  },
): Promise<number> {
  const [row] = await tx
    .insert(recruiterInvite)
    .values({
      candidateId: input.candidateId,
      email: input.email,
      tokenHash: input.tokenHash,
      status: "pending",
      expiresAt: input.expiresAt,
      accessExpiresAt: input.accessExpiresAt,
      expiryTz: input.expiryTz,
      createdBy: input.createdBy,
      createdAt: input.nowIso,
    })
    .returning({ id: recruiterInvite.id });
  const inviteId = row!.id;
  await appendHistory(tx, [
    {
      candidateId: input.candidateId,
      inviteId,
      recruiterEmail: input.email,
      kind: input.kind,
      actor: "candidate",
      actorUserId: input.createdBy,
      at: input.nowIso,
    },
  ]);
  return inviteId;
}

export const drizzleRecruiterAccess: RecruiterAccessStore = {
  async grantOrInvite(input) {
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      await lockCandidateAccess(tx, input.candidateId);
      const facts = await candidateFacts(tx, input.candidateId);
      const account = await accountByEmail(tx, input.email);
      const roles = rolesOf(account?.roles);
      const target = grantTarget({
        email: input.email,
        candidateEmails: facts.emails,
        account:
          account === null
            ? null
            : { id: account.id, roles, disabled: account.disabledAt !== null, emailVerified: account.emailVerifiedAt !== null },
      });
      if (target === "self") return { ok: false as const, error: "self" as const, ended: [] };

      const stale = await expireWhere(tx, input.nowIso, {
        grants: and(
          eq(recruiterGrant.candidateId, input.candidateId),
          account === null
            ? eq(recruiterGrant.recruiterEmail, input.email)
            : or(eq(recruiterGrant.recruiterEmail, input.email), eq(recruiterGrant.recruiterUserId, account.id)),
        ),
        invites: and(eq(recruiterInvite.candidateId, input.candidateId), eq(recruiterInvite.email, input.email)),
      });

      if (await liveGrantFor(tx, input.candidateId, input.email, account?.id ?? null, input.nowIso)) {
        return { ok: false as const, error: "already_active" as const, ended: stale.ended };
      }
      const [pending] = await tx
        .select({ id: recruiterInvite.id })
        .from(recruiterInvite)
        .where(
          and(
            eq(recruiterInvite.candidateId, input.candidateId),
            eq(recruiterInvite.email, input.email),
            eq(recruiterInvite.status, "pending"),
          ),
        )
        .limit(1);
      if (pending) return { ok: false as const, error: "already_invited" as const, ended: stale.ended };

      const since = new Date(Date.parse(input.nowIso) - CAP_WINDOW_MS).toISOString();
      const cap = dailyCap(await countedSince(tx, input.candidateId, since), input.nowIso);
      if (!cap.ok) return { ok: false as const, error: "cap_reached" as const, retryAt: cap.retryAt, ended: stale.ended };

      if (target === "grant") {
        const grantId = await insertActiveGrant(tx, {
          candidateId: input.candidateId,
          recruiterUserId: account!.id,
          recruiterEmail: input.email,
          createdBy: input.actorUserId,
          actor: "candidate",
          at: input.nowIso,
          expiresAt: input.expiresAt,
          expiryTz: input.expiryTz,
        });
        if (grantId === null) return { ok: false as const, error: "already_active" as const, ended: stale.ended };
        return {
          ok: true as const,
          kind: "grant" as const,
          ended: stale.ended,
          notice: {
            recruiterEmail: input.email,
            recruiterUserId: account!.id,
            recruiterLocale: account!.locale,
            candidateId: input.candidateId,
            candidateName: facts.name,
            expiresAt: input.expiresAt,
            expiryTz: input.expiryTz,
          },
        };
      }

      if ((await livePendingInvites(tx, input.candidateId, input.nowIso)) >= PENDING_INVITE_CAP) {
        return { ok: false as const, error: "too_many_pending" as const, ended: stale.ended };
      }
      const inviteId = await insertInvite(tx, {
        candidateId: input.candidateId,
        email: input.email,
        tokenHash: input.tokenHash,
        expiresAt: input.inviteExpiresAt,
        accessExpiresAt: input.expiresAt,
        expiryTz: input.expiryTz,
        createdBy: input.actorUserId,
        kind: "invite_sent",
        nowIso: input.nowIso,
      });
      const notice: InviteNotice = {
        inviteId,
        email: input.email,
        candidateId: input.candidateId,
        candidateName: facts.name,
        candidateLocale: facts.locale,
        validUntil: input.inviteExpiresAt,
        needsRecruiterAccount: account !== null && !roles.includes("recruiter"),
      };
      return { ok: true as const, kind: "invite" as const, ended: stale.ended, notice };
    });
    // Os avisos de fim das vencidas que a transação fechou saem mesmo quando a
    // concessão nova é recusada: o histórico já registrou o fim.
    const ended = await endedNotices(db, result.ended, "expired");
    if (!result.ok) {
      return { ok: false, error: result.error, ended, ...("retryAt" in result ? { retryAt: result.retryAt } : {}) };
    }
    return { ...result, ended };
  },

  async endGrant(input) {
    const db = getDb();
    const result = await endGrant(db, {
      grantId: input.grantId,
      candidateId: input.candidateId,
      liveAt: input.nowIso,
      status: "revoked",
      kind: "access_revoked",
      actor: input.actor,
      actorUserId: input.actorUserId,
      actorName: input.actor === "admin" ? await actorNameOf(db, input.actorUserId) : null,
      revokedBy: input.actorUserId,
      at: input.nowIso,
    });
    if (!result.ok) return result;
    const [notice] = await endedNotices(db, [result.grant], input.actor);
    return { ok: true, notice: notice! };
  },

  async setEndDate(input) {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [grant] = await tx
        .select({
          status: recruiterGrant.status,
          expiresAt: recruiterGrant.expiresAt,
          expiryTz: recruiterGrant.expiryTz,
          recruiterEmail: recruiterGrant.recruiterEmail,
          recruiterUserId: recruiterGrant.recruiterUserId,
        })
        .from(recruiterGrant)
        .where(and(eq(recruiterGrant.id, input.grantId), eq(recruiterGrant.candidateId, input.candidateId)))
        .for("update")
        .limit(1);
      if (!grant) return { ok: false as const, error: "not_found" as const };
      const live = grant.status === "active" && (grant.expiresAt === null || grant.expiresAt > input.nowIso);
      if (!live) return { ok: false as const, error: "already_ended" as const };
      if (grant.expiresAt === input.expiresAt && (input.expiresAt === null || grant.expiryTz === input.expiryTz)) {
        return { ok: true as const, changed: false as const };
      }
      await tx
        .update(recruiterGrant)
        .set({ expiresAt: input.expiresAt, expiryTz: input.expiryTz })
        .where(eq(recruiterGrant.id, input.grantId));
      await appendHistory(tx, [
        {
          candidateId: input.candidateId,
          grantId: input.grantId,
          recruiterEmail: grant.recruiterEmail,
          kind: "end_date_changed",
          actor: "candidate",
          actorUserId: input.actorUserId,
          detail: input.expiresAt ?? "none",
          at: input.nowIso,
        },
      ]);
      const locales = await localesOf(tx, [grant.recruiterUserId]);
      const notice: RecruiterNotice & { expiresAt: string | null; expiryTz: string | null } = {
        recruiterEmail: grant.recruiterEmail,
        recruiterUserId: grant.recruiterUserId,
        recruiterLocale: grant.recruiterUserId === null ? null : (locales.get(grant.recruiterUserId) ?? null),
        candidateId: input.candidateId,
        candidateName: (await candidateFacts(tx, input.candidateId)).name,
        expiresAt: input.expiresAt,
        expiryTz: input.expiryTz,
      };
      return { ok: true as const, changed: true as const, notice };
    });
  },

  async resendInvite(input) {
    return getDb().transaction(async (tx) => {
      await lockCandidateAccess(tx, input.candidateId);
      const [invite] = await tx
        .select({
          status: recruiterInvite.status,
          email: recruiterInvite.email,
          accessExpiresAt: recruiterInvite.accessExpiresAt,
          expiryTz: recruiterInvite.expiryTz,
          expiresAt: recruiterInvite.expiresAt,
        })
        .from(recruiterInvite)
        .where(and(eq(recruiterInvite.id, input.inviteId), eq(recruiterInvite.candidateId, input.candidateId)))
        .for("update")
        .limit(1);
      if (!invite || invite.status === "cancelled" || invite.status === "superseded") {
        return { ok: false as const, error: "not_found" as const };
      }
      const account = await accountByEmail(tx, invite.email);
      if (
        invite.status === "accepted" ||
        (await liveGrantFor(tx, input.candidateId, invite.email, account?.id ?? null, input.nowIso))
      ) {
        return { ok: false as const, error: "already_active" as const };
      }
      const since = new Date(Date.parse(input.nowIso) - CAP_WINDOW_MS).toISOString();
      const cap = dailyCap(await countedSince(tx, input.candidateId, since), input.nowIso);
      if (!cap.ok) return { ok: false as const, error: "cap_reached" as const, retryAt: cap.retryAt };
      if ((await livePendingInvites(tx, input.candidateId, input.nowIso, input.inviteId)) >= PENDING_INVITE_CAP) {
        return { ok: false as const, error: "too_many_pending" as const };
      }

      await tx
        .update(recruiterInvite)
        .set({ status: "superseded", decidedAt: input.nowIso })
        .where(eq(recruiterInvite.id, input.inviteId));
      const inviteId = await insertInvite(tx, {
        candidateId: input.candidateId,
        email: invite.email,
        tokenHash: input.tokenHash,
        expiresAt: input.inviteExpiresAt,
        accessExpiresAt: invite.accessExpiresAt,
        expiryTz: invite.expiryTz,
        createdBy: input.actorUserId,
        kind: "invite_resent",
        nowIso: input.nowIso,
      });
      const facts = await candidateFacts(tx, input.candidateId);
      const notice: InviteNotice = {
        inviteId,
        email: invite.email,
        candidateId: input.candidateId,
        candidateName: facts.name,
        candidateLocale: facts.locale,
        validUntil: input.inviteExpiresAt,
        needsRecruiterAccount: account !== null && !rolesOf(account.roles).includes("recruiter"),
      };
      return { ok: true as const, notice };
    });
  },

  async cancelInvite(input) {
    const db = getDb();
    const scope = input.candidateId === null ? undefined : eq(recruiterInvite.candidateId, input.candidateId);
    const actorName = input.actor === "admin" ? await actorNameOf(db, input.actorUserId) : null;
    return db.transaction(async (tx) => {
      const [cancelled] = await tx
        .update(recruiterInvite)
        .set({ status: "cancelled", cancelledBy: input.actorUserId, decidedAt: input.nowIso })
        .where(and(eq(recruiterInvite.id, input.inviteId), scope, eq(recruiterInvite.status, "pending")))
        .returning({ candidateId: recruiterInvite.candidateId, email: recruiterInvite.email });
      if (cancelled) {
        await appendHistory(tx, [
          {
            candidateId: cancelled.candidateId,
            inviteId: input.inviteId,
            recruiterEmail: cancelled.email,
            kind: "invite_cancelled",
            actor: input.actor,
            actorUserId: input.actorUserId,
            actorName,
            at: input.nowIso,
          },
        ]);
        return { ok: true as const, changed: true };
      }
      const [current] = await tx
        .select({ status: recruiterInvite.status })
        .from(recruiterInvite)
        .where(and(eq(recruiterInvite.id, input.inviteId), scope))
        .limit(1);
      if (!current) return { ok: false as const, error: "not_found" as const };
      // Cancelar o que já está cancelado é o resultado pedido (US-009.EC-4).
      if (current.status === "cancelled") return { ok: true as const, changed: false };
      return { ok: false as const, error: "already_ended" as const };
    });
  },

  async dismissInvite(input) {
    const db = getDb();
    const [row] = await db
      .update(recruiterInvite)
      .set({ dismissedAt: input.nowIso })
      .where(
        and(
          eq(recruiterInvite.id, input.inviteId),
          eq(recruiterInvite.candidateId, input.candidateId),
          isNull(recruiterInvite.dismissedAt),
          or(
            eq(recruiterInvite.status, "expired"),
            and(eq(recruiterInvite.status, "pending"), lte(recruiterInvite.expiresAt, input.nowIso)),
          ),
        ),
      )
      .returning({ id: recruiterInvite.id });
    if (row) return { ok: true, changed: true };
    const [current] = await db
      .select({ dismissedAt: recruiterInvite.dismissedAt })
      .from(recruiterInvite)
      .where(and(eq(recruiterInvite.id, input.inviteId), eq(recruiterInvite.candidateId, input.candidateId)))
      .limit(1);
    if (current?.dismissedAt) return { ok: true, changed: false };
    return { ok: false, error: "not_found" };
  },

  async markDeliveryFailed(inviteId, nowIso) {
    await getDb().update(recruiterInvite).set({ deliveryFailedAt: nowIso }).where(eq(recruiterInvite.id, inviteId));
  },

  async expireDue(nowIso) {
    const db = getDb();
    const result = await db.transaction((tx) => expireWhere(tx, nowIso));
    return { ended: await endedNotices(db, result.ended, "expired"), invitesExpired: result.invitesExpired };
  },

  async grantsOf(candidateId, nowIso) {
    const rows = await getDb()
      .select({
        id: recruiterGrant.id,
        recruiterEmail: recruiterGrant.recruiterEmail,
        recruiterName: authUser.fullName,
        roles: authUser.roles,
        disabledAt: authUser.disabledAt,
        accountId: authUser.id,
        createdAt: recruiterGrant.createdAt,
        expiresAt: recruiterGrant.expiresAt,
        expiryTz: recruiterGrant.expiryTz,
        lastAccessedAt: recruiterGrant.lastAccessedAt,
      })
      .from(recruiterGrant)
      .leftJoin(authUser, eq(authUser.id, recruiterGrant.recruiterUserId))
      .where(and(eq(recruiterGrant.candidateId, candidateId), activeGrantCondition(nowIso)))
      .orderBy(desc(recruiterGrant.createdAt), desc(recruiterGrant.id));
    return rows.map(
      (row): GrantRow => ({
        id: row.id,
        recruiterEmail: row.recruiterEmail,
        recruiterName: row.recruiterName,
        display: grantDisplay(
          row.accountId === null ? null : { disabled: row.disabledAt !== null, roles: rolesOf(row.roles) },
        ),
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        expiryTz: row.expiryTz,
        lastAccessedAt: row.lastAccessedAt,
      }),
    );
  },

  async invitesOf(candidateId, nowIso) {
    const rows = await getDb()
      .select({
        id: recruiterInvite.id,
        email: recruiterInvite.email,
        status: recruiterInvite.status,
        createdAt: recruiterInvite.createdAt,
        expiresAt: recruiterInvite.expiresAt,
        accessExpiresAt: recruiterInvite.accessExpiresAt,
        expiryTz: recruiterInvite.expiryTz,
        deliveryFailedAt: recruiterInvite.deliveryFailedAt,
      })
      .from(recruiterInvite)
      .where(
        and(
          eq(recruiterInvite.candidateId, candidateId),
          inArray(recruiterInvite.status, ["pending", "expired"]),
          isNull(recruiterInvite.dismissedAt),
        ),
      )
      .orderBy(desc(recruiterInvite.createdAt), desc(recruiterInvite.id));
    return rows.map(
      (row): InviteRow => ({
        id: row.id,
        email: row.email,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        accessExpiresAt: row.accessExpiresAt,
        expiryTz: row.expiryTz,
        status: row.status === "pending" && row.expiresAt > nowIso ? "pending" : "expired",
        deliveryFailed: row.deliveryFailedAt !== null,
      }),
    );
  },

  async history(candidateId, page, pageSize) {
    const db = getDb();
    const where = eq(recruiterAccessEvent.candidateId, candidateId);
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: recruiterAccessEvent.id,
          kind: recruiterAccessEvent.kind,
          actor: recruiterAccessEvent.actor,
          actorName: recruiterAccessEvent.actorName,
          recruiterEmail: recruiterAccessEvent.recruiterEmail,
          detail: recruiterAccessEvent.detail,
          at: recruiterAccessEvent.at,
        })
        .from(recruiterAccessEvent)
        .where(where)
        .orderBy(desc(recruiterAccessEvent.at), desc(recruiterAccessEvent.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: count() }).from(recruiterAccessEvent).where(where),
    ]);
    return { rows, total: Number(total?.n ?? 0) };
  },

  async adminOverview(candidateIds, nowIso) {
    const out = new Map<number, AdminCandidateAccess>();
    if (candidateIds.length === 0) return out;
    const db = getDb();
    const ids = [...candidateIds];
    const [grants, invites] = await Promise.all([
      db
        .select({
          id: recruiterGrant.id,
          candidateId: recruiterGrant.candidateId,
          recruiterEmail: recruiterGrant.recruiterEmail,
          recruiterName: authUser.fullName,
          createdAt: recruiterGrant.createdAt,
          expiresAt: recruiterGrant.expiresAt,
          expiryTz: recruiterGrant.expiryTz,
        })
        .from(recruiterGrant)
        .leftJoin(authUser, eq(authUser.id, recruiterGrant.recruiterUserId))
        .where(and(inArray(recruiterGrant.candidateId, ids), activeGrantCondition(nowIso)))
        .orderBy(asc(recruiterGrant.id)),
      db
        .select({
          id: recruiterInvite.id,
          candidateId: recruiterInvite.candidateId,
          email: recruiterInvite.email,
          createdAt: recruiterInvite.createdAt,
          expiresAt: recruiterInvite.expiresAt,
        })
        .from(recruiterInvite)
        .where(and(inArray(recruiterInvite.candidateId, ids), eq(recruiterInvite.status, "pending")))
        .orderBy(asc(recruiterInvite.id)),
    ]);
    const entry = (id: number) => {
      let current = out.get(id);
      if (!current) {
        current = { grants: [], invites: [] };
        out.set(id, current);
      }
      return current;
    };
    for (const { candidateId, ...grant } of grants) entry(candidateId).grants.push(grant);
    for (const { candidateId, ...invite } of invites) entry(candidateId).invites.push(invite);
    return out;
  },
};
