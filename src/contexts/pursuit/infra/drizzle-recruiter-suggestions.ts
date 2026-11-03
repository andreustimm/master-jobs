/**
 * Sugestões de vaga do recrutador sobre Drizzle (#465, ADR-011, ADR-015,
 * ADR-017).
 *
 * Criar e juntar-se rodam sob a mesma trava por candidato do acesso
 * (`hashtext('recruiter-access'), candidate_id`): a contagem do limite e a
 * checagem de repetição não correm contra outra sugestão do mesmo candidato.
 * O aceite trava a LINHA da sugestão, escopada ao candidato da sessão, e só
 * ele escreve em `application` — pelo mesmo caminho do funil
 * (`setApplicationStatusInTransaction`), nunca por INSERT direto (regra 2).
 *
 * A concessão (`recruiter_grant`) não é lida aqui: o id da vigente vem da
 * fachada de autenticação, que é dona do predicado de acesso (ADR-012).
 */
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb, type DbTransaction } from "../../../core/db/client.ts";
import { setApplicationStatusInTransaction } from "../../../core/db/repo.ts";
import { application, authUser, candidate, job, jobScore, recruiterSuggestion, recruiterSuggestionBy } from "../../../core/db/schema.ts";
import { firstNonEmpty } from "../../../core/sources/http.ts";
import {
  appendRecruiterHistory,
  capDecision,
  currentRecruiterGrantId,
  lockRecruiterAccess,
} from "../../auth/index.ts";
import { primaryScoreFilter } from "../../matching/index.ts";
import { OUT_OF_FUNNEL } from "../domain/application.ts";
import {
  SUGGESTIONS_PAGE_SIZE,
  SUGGESTION_CAP_WINDOW_MS,
  SUGGESTION_DAILY_CAP,
  decideAccept,
  decideSuggest,
  digestDue,
  type SuggestError,
  type SuggestionStatus,
} from "../domain/recruiter-suggestion.ts";
import { pageWithin } from "../domain/recruiter-view.ts";

export type SuggestOutcome =
  | { ok: true; kind: "create" | "join"; suggestionId: number }
  | { ok: false; error: SuggestError; retryAt?: string };

export type DecideOutcome = { ok: true } | { ok: false; error: "not_found" | "already_decided" };

/** O lote de um aviso: o que entrou nele, para quem e em que idioma. */
export type DigestBatch = {
  byIds: number[];
  /** O instante gravado em `notified_at`; desfazer só apaga o que ainda for este. */
  stamp: string;
  to: string | null;
  locale: string | null;
  recruiterUserId: number;
  recruiterName: string;
  items: { title: string; company: string }[];
};

export type CandidateSuggestionRow = {
  id: number;
  status: SuggestionStatus;
  createdAt: string;
  decidedAt: string | null;
  jobId: number;
  title: string;
  company: string;
  jobClosed: boolean;
  fit: number | null;
  recruiters: { name: string; note: string | null; grantId: number | null; at: string }[];
};

export type RecruiterSuggestionRow = {
  byId: number;
  suggestedAt: string;
  status: SuggestionStatus;
  decidedAt: string | null;
  jobId: number;
  title: string;
  company: string;
  jobClosed: boolean;
};

export type Paged<T> = { rows: T[]; total: number; page: number; pages: number };

/** `?page=` como a URL o entrega; `pageWithin` decide a página que existe. */
export type PageParam = string | string[] | undefined;

function pagesOf(total: number): number {
  return Math.max(1, Math.ceil(total / SUGGESTIONS_PAGE_SIZE));
}

/**
 * Como o recrutador aparece para o candidato: o nome de exibição da conta, o
 * e-mail dela ou, se a conta sumiu, o e-mail que a sugestão guardou.
 */
const displayName = sql<string>`coalesce(nullif(btrim(${authUser.fullName}), ''), ${authUser.email}, ${recruiterSuggestionBy.recruiterEmail})`;

/** "Título · Empresa" no histórico: a vaga como era quando o fato aconteceu. */
function jobSnapshot(title: string, company: string): string {
  return `${title} · ${company}`;
}

function asStatus(value: string): SuggestionStatus {
  return value === "accepted" || value === "declined" ? value : "pending";
}

/** Os autores de uma sugestão, com o e-mail que o histórico guarda de cada um. */
async function authorsOf(tx: DbTransaction, suggestionId: number) {
  return tx
    .select({ recruiterEmail: recruiterSuggestionBy.recruiterEmail, grantId: recruiterSuggestionBy.grantId })
    .from(recruiterSuggestionBy)
    .where(eq(recruiterSuggestionBy.suggestionId, suggestionId))
    .orderBy(asc(recruiterSuggestionBy.id));
}

export const drizzleRecruiterSuggestions = {
  /**
   * Cria a sugestão ou junta o recrutador à pendente de outro (US-018). Sob a
   * trava do candidato: a concessão ainda vale, a vaga está aberta, este
   * recrutador não tem uma pendente nem decidida para a vaga e ainda cabe no
   * limite de 24 h. Nada aqui lê nem escreve `application`.
   */
  async suggest(input: {
    candidateId: number;
    jobId: number;
    recruiterUserId: number;
    recruiterEmail: string;
    note: string | null;
    nowIso: string;
  }): Promise<SuggestOutcome> {
    return getDb().transaction(async (tx): Promise<SuggestOutcome> => {
      await lockRecruiterAccess(tx, input.candidateId);
      const grantId = await currentRecruiterGrantId(tx, input.recruiterUserId, input.candidateId, input.nowIso);
      if (grantId === null) return { ok: false, error: "not_found" };

      const [posting] = await tx
        .select({ closedAt: job.closedAt, archivedAt: job.archivedAt, title: job.title, company: job.companyName })
        .from(job)
        .where(eq(job.id, input.jobId))
        .limit(1);
      if (!posting) return { ok: false, error: "not_found" };

      const [mine] = await tx
        .select({ status: recruiterSuggestion.status })
        .from(recruiterSuggestionBy)
        .innerJoin(recruiterSuggestion, eq(recruiterSuggestion.id, recruiterSuggestionBy.suggestionId))
        .where(
          and(
            eq(recruiterSuggestion.candidateId, input.candidateId),
            eq(recruiterSuggestion.jobId, input.jobId),
            eq(recruiterSuggestionBy.recruiterUserId, input.recruiterUserId),
          ),
        )
        .orderBy(desc(recruiterSuggestionBy.createdAt), desc(recruiterSuggestionBy.id))
        .limit(1);
      // A pendente de outro recrutador, travada: um recusar concorrente espera
      // este commit, e não decide uma sugestão a que este autor ainda não chegou.
      const [pending] = await tx
        .select({ id: recruiterSuggestion.id })
        .from(recruiterSuggestion)
        .where(
          and(
            eq(recruiterSuggestion.candidateId, input.candidateId),
            eq(recruiterSuggestion.jobId, input.jobId),
            eq(recruiterSuggestion.status, "pending"),
          ),
        )
        .limit(1)
        .for("update");
      const since = new Date(Date.parse(input.nowIso) - SUGGESTION_CAP_WINDOW_MS).toISOString();
      const counted = await tx
        .select({ at: recruiterSuggestionBy.createdAt })
        .from(recruiterSuggestionBy)
        .innerJoin(recruiterSuggestion, eq(recruiterSuggestion.id, recruiterSuggestionBy.suggestionId))
        .where(
          and(
            eq(recruiterSuggestion.candidateId, input.candidateId),
            eq(recruiterSuggestionBy.recruiterUserId, input.recruiterUserId),
            gt(recruiterSuggestionBy.createdAt, since),
          ),
        );

      const decision = decideSuggest({
        job: { closedAt: posting.closedAt, archivedAt: posting.archivedAt },
        mine: mine ? asStatus(mine.status) : null,
        pendingSuggestionId: pending?.id ?? null,
        cap: capDecision(
          counted.map((row) => row.at),
          Date.parse(input.nowIso),
          SUGGESTION_DAILY_CAP,
          SUGGESTION_CAP_WINDOW_MS,
        ),
      });
      if (decision.kind === "refuse") {
        return { ok: false, error: decision.error, ...(decision.retryAt ? { retryAt: decision.retryAt } : {}) };
      }

      let suggestionId: number;
      if (decision.kind === "join") {
        suggestionId = decision.suggestionId;
      } else {
        const [created] = await tx
          .insert(recruiterSuggestion)
          .values({ candidateId: input.candidateId, jobId: input.jobId, status: "pending", createdAt: input.nowIso })
          .returning({ id: recruiterSuggestion.id });
        suggestionId = created!.id;
      }
      await tx.insert(recruiterSuggestionBy).values({
        suggestionId,
        recruiterUserId: input.recruiterUserId,
        recruiterEmail: input.recruiterEmail,
        grantId,
        note: input.note,
        createdAt: input.nowIso,
      });
      await appendRecruiterHistory(tx, [
        {
          candidateId: input.candidateId,
          grantId,
          suggestionId,
          recruiterEmail: input.recruiterEmail,
          kind: "suggestion_received",
          actor: "recruiter",
          actorUserId: input.recruiterUserId,
          detail: jobSnapshot(posting.title, posting.company),
          at: input.nowIso,
        },
      ]);
      return { ok: true, kind: decision.kind, suggestionId };
    });
  },

  /**
   * Aceita ou recusa (US-021, US-022), escopado ao candidato da sessão: id de
   * outro candidato é `not_found`, igual ao que não existe. Aceitar cria a
   * candidatura em Backlog, com canal `recruiter`, só quando a vaga não está no
   * funil; a que existe fica com o status e o canal dela. Recusar não lê nem
   * escreve o funil.
   */
  async decide(input: {
    suggestionId: number;
    candidateId: number;
    decision: "accept" | "decline";
    actorUserId: number;
    nowIso: string;
  }): Promise<DecideOutcome> {
    return getDb().transaction(async (tx): Promise<DecideOutcome> => {
      const [row] = await tx
        .select({ id: recruiterSuggestion.id, status: recruiterSuggestion.status, jobId: recruiterSuggestion.jobId })
        .from(recruiterSuggestion)
        .where(and(eq(recruiterSuggestion.id, input.suggestionId), eq(recruiterSuggestion.candidateId, input.candidateId)))
        .limit(1)
        .for("update");
      if (!row) return { ok: false, error: "not_found" };
      const status = asStatus(row.status);

      let applicationId: number | null = null;
      if (input.decision === "decline") {
        if (status !== "pending") return { ok: false, error: "already_decided" };
      } else {
        const [existing] = await tx
          .select({ id: application.id, status: application.status })
          .from(application)
          .where(and(eq(application.candidateId, input.candidateId), eq(application.jobId, row.jobId)))
          .limit(1)
          .for("update");
        // "Fora do funil" é a vaga que a pessoa tirou de lá: aceitar a devolve,
        // como uma primeira observação — não é uma candidatura a preservar.
        const inFunnel = existing !== undefined && existing.status !== OUT_OF_FUNNEL;
        const outcome = decideAccept({ status, applicationExists: inFunnel });
        if (outcome === "already_decided") return { ok: false, error: "already_decided" };
        if (outcome === "insert_backlog") {
          await setApplicationStatusInTransaction(
            tx,
            input.candidateId,
            row.jobId,
            "backlog",
            `sugestão de recrutador #${row.id}`,
            input.nowIso,
            "recruiter",
          );
          const [created] = await tx
            .select({ id: application.id })
            .from(application)
            .where(and(eq(application.candidateId, input.candidateId), eq(application.jobId, row.jobId)))
            .limit(1);
          applicationId = created!.id;
        } else {
          applicationId = existing!.id;
        }
      }

      // A linha está travada e foi lida pendente: o UPDATE condicional não
      // perde para ninguém, e a condição fica como a regra escrita.
      await tx
        .update(recruiterSuggestion)
        .set({
          status: input.decision === "accept" ? "accepted" : "declined",
          applicationId,
          decidedAt: input.nowIso,
        })
        .where(and(eq(recruiterSuggestion.id, row.id), eq(recruiterSuggestion.status, "pending")));

      // A sugestão some com a vaga (FK em cascata): ela existe aqui.
      const [posting] = await tx
        .select({ title: job.title, company: job.companyName })
        .from(job)
        .where(eq(job.id, row.jobId))
        .limit(1);
      const authors = await authorsOf(tx, row.id);
      await appendRecruiterHistory(
        tx,
        authors.map((author) => ({
          candidateId: input.candidateId,
          grantId: author.grantId,
          suggestionId: row.id,
          recruiterEmail: author.recruiterEmail,
          kind: input.decision === "accept" ? ("suggestion_accepted" as const) : ("suggestion_declined" as const),
          actor: "candidate" as const,
          actorUserId: input.actorUserId,
          detail: jobSnapshot(posting!.title, posting!.company),
          at: input.nowIso,
        })),
      );
      return { ok: true };
    });
  },

  /**
   * Reserva o aviso de um recrutador a um candidato (US-020.EC-5): se não
   * houve outro na última hora, marca `notified_at` nas sugestões pendentes
   * ainda sem aviso e devolve o lote. Sob a trava do candidato, duas reservas
   * concorrentes não mandam dois e-mails; se o envio falhar, `releaseDigest`
   * devolve o lote para a próxima varredura.
   */
  async claimDigest(input: { recruiterUserId: number; candidateId: number; nowIso: string }): Promise<DigestBatch | null> {
    return getDb().transaction(async (tx): Promise<DigestBatch | null> => {
      await lockRecruiterAccess(tx, input.candidateId);
      const pair = and(
        eq(recruiterSuggestion.candidateId, input.candidateId),
        eq(recruiterSuggestionBy.recruiterUserId, input.recruiterUserId),
      );
      const [last] = await tx
        .select({ at: sql<string | null>`max(${recruiterSuggestionBy.notifiedAt})` })
        .from(recruiterSuggestionBy)
        .innerJoin(recruiterSuggestion, eq(recruiterSuggestion.id, recruiterSuggestionBy.suggestionId))
        .where(and(pair, isNotNull(recruiterSuggestionBy.notifiedAt)));
      if (!digestDue(last?.at ?? null, Date.parse(input.nowIso))) return null;

      const rows = await tx
        .select({ id: recruiterSuggestionBy.id, title: job.title, company: job.companyName })
        .from(recruiterSuggestionBy)
        .innerJoin(recruiterSuggestion, eq(recruiterSuggestion.id, recruiterSuggestionBy.suggestionId))
        .innerJoin(job, eq(job.id, recruiterSuggestion.jobId))
        .where(and(pair, isNull(recruiterSuggestionBy.notifiedAt), eq(recruiterSuggestion.status, "pending")))
        .orderBy(asc(recruiterSuggestionBy.createdAt), asc(recruiterSuggestionBy.id));
      if (rows.length === 0) return null;

      const byIds = rows.map((row) => row.id);
      await tx
        .update(recruiterSuggestionBy)
        .set({ notifiedAt: input.nowIso })
        .where(inArray(recruiterSuggestionBy.id, byIds));

      const [account] = await tx
        .select({ email: authUser.email, locale: authUser.locale })
        .from(authUser)
        .where(eq(authUser.candidateId, input.candidateId))
        .orderBy(asc(authUser.id))
        .limit(1);
      const [person] = await tx
        .select({ email: candidate.email })
        .from(candidate)
        .where(eq(candidate.id, input.candidateId))
        .limit(1);
      const [recruiter] = await tx
        .select({ name: displayName })
        .from(recruiterSuggestionBy)
        .leftJoin(authUser, eq(authUser.id, recruiterSuggestionBy.recruiterUserId))
        .where(eq(recruiterSuggestionBy.id, byIds[0]!))
        .limit(1);
      return {
        byIds,
        stamp: input.nowIso,
        to: firstNonEmpty(account?.email, person?.email),
        locale: account?.locale ?? null,
        recruiterUserId: input.recruiterUserId,
        recruiterName: recruiter!.name,
        items: rows.map((row) => ({ title: row.title, company: row.company })),
      };
    });
  },

  /** Desfaz a reserva de um aviso que não saiu: o lote volta a ficar sem aviso. */
  async releaseDigest(byIds: readonly number[], stamp: string): Promise<void> {
    if (byIds.length === 0) return;
    await getDb()
      .update(recruiterSuggestionBy)
      .set({ notifiedAt: null })
      .where(and(inArray(recruiterSuggestionBy.id, [...byIds]), eq(recruiterSuggestionBy.notifiedAt, stamp)));
  },

  /** Os pares recrutador e candidato com sugestão pendente ainda sem aviso. */
  async pairsAwaitingDigest(): Promise<{ recruiterUserId: number; candidateId: number }[]> {
    const rows = await getDb()
      .selectDistinct({ recruiterUserId: recruiterSuggestionBy.recruiterUserId, candidateId: recruiterSuggestion.candidateId })
      .from(recruiterSuggestionBy)
      .innerJoin(recruiterSuggestion, eq(recruiterSuggestion.id, recruiterSuggestionBy.suggestionId))
      .where(
        and(
          isNull(recruiterSuggestionBy.notifiedAt),
          isNotNull(recruiterSuggestionBy.recruiterUserId),
          eq(recruiterSuggestion.status, "pending"),
        ),
      )
      .orderBy(asc(recruiterSuggestion.candidateId), asc(recruiterSuggestionBy.recruiterUserId));
    return rows.map((row) => ({ recruiterUserId: row.recruiterUserId as number, candidateId: row.candidateId }));
  },

  /** As sugestões do candidato: pendentes primeiro, depois as decididas, mais novas antes. */
  async candidateList(candidateId: number, requested: PageParam): Promise<Paged<CandidateSuggestionRow>> {
    const db = getDb();
    const where = eq(recruiterSuggestion.candidateId, candidateId);
    const [counted] = await db.select({ n: count() }).from(recruiterSuggestion).where(where);
    const total = Number(counted!.n);
    const page = pageWithin(requested, total, SUGGESTIONS_PAGE_SIZE);
    const suggestions = await db
      .select({
        id: recruiterSuggestion.id,
        status: recruiterSuggestion.status,
        createdAt: recruiterSuggestion.createdAt,
        decidedAt: recruiterSuggestion.decidedAt,
        jobId: job.id,
        title: job.title,
        company: job.companyName,
        closedAt: job.closedAt,
        archivedAt: job.archivedAt,
        fit: jobScore.fit,
      })
      .from(recruiterSuggestion)
      .innerJoin(job, eq(job.id, recruiterSuggestion.jobId))
      // A nota da trilha principal do candidato, como no funil: uma linha por vaga.
      .leftJoin(jobScore, and(eq(jobScore.jobId, job.id), eq(jobScore.candidateId, candidateId), primaryScoreFilter()))
      .where(where)
      .orderBy(
        desc(sql`(${recruiterSuggestion.status} = 'pending')`),
        desc(recruiterSuggestion.createdAt),
        desc(recruiterSuggestion.id),
      )
      .limit(SUGGESTIONS_PAGE_SIZE)
      .offset((page - 1) * SUGGESTIONS_PAGE_SIZE);
    const ids = suggestions.map((row) => row.id);
    const authors =
      ids.length === 0
        ? []
        : await db
            .select({
              suggestionId: recruiterSuggestionBy.suggestionId,
              name: displayName,
              note: recruiterSuggestionBy.note,
              grantId: recruiterSuggestionBy.grantId,
              at: recruiterSuggestionBy.createdAt,
            })
            .from(recruiterSuggestionBy)
            .leftJoin(authUser, eq(authUser.id, recruiterSuggestionBy.recruiterUserId))
            .where(inArray(recruiterSuggestionBy.suggestionId, ids))
            .orderBy(asc(recruiterSuggestionBy.createdAt), asc(recruiterSuggestionBy.id));
    return {
      total,
      page,
      pages: pagesOf(total),
      rows: suggestions.map((row) => ({
        id: row.id,
        status: asStatus(row.status),
        createdAt: row.createdAt,
        decidedAt: row.decidedAt,
        jobId: row.jobId,
        title: row.title,
        company: row.company,
        jobClosed: row.closedAt !== null || row.archivedAt !== null,
        fit: row.fit,
        recruiters: authors
          .filter((author) => author.suggestionId === row.id)
          .map(({ name, note, grantId, at }) => ({ name, note, grantId, at })),
      })),
    };
  },

  /** Quantas sugestões o candidato tem e quantas esperam a decisão dele (a navegação). */
  async counts(candidateId: number): Promise<{ pending: number; total: number }> {
    const [row] = await getDb()
      .select({
        pending: sql<number>`count(*) filter (where ${recruiterSuggestion.status} = 'pending')`.mapWith(Number),
        total: count(),
      })
      .from(recruiterSuggestion)
      .where(eq(recruiterSuggestion.candidateId, candidateId));
    return { pending: row!.pending, total: Number(row!.total) };
  },

  /**
   * As sugestões DESTE recrutador ao candidato, só as da concessão vigente
   * (US-017.AC-3, EC-3): a sugestão de uma concessão encerrada fica com o
   * candidato e some para o recrutador. Mais novas primeiro.
   */
  async recruiterList(input: {
    recruiterUserId: number;
    candidateId: number;
    grantId: number;
    page: PageParam;
  }): Promise<Paged<RecruiterSuggestionRow>> {
    const db = getDb();
    const where = and(
      eq(recruiterSuggestionBy.recruiterUserId, input.recruiterUserId),
      eq(recruiterSuggestionBy.grantId, input.grantId),
      eq(recruiterSuggestion.candidateId, input.candidateId),
    );
    const [counted] = await db
      .select({ n: count() })
      .from(recruiterSuggestionBy)
      .innerJoin(recruiterSuggestion, eq(recruiterSuggestion.id, recruiterSuggestionBy.suggestionId))
      .where(where);
    const total = Number(counted!.n);
    const page = pageWithin(input.page, total, SUGGESTIONS_PAGE_SIZE);
    const rows = await db
      .select({
        byId: recruiterSuggestionBy.id,
        suggestedAt: recruiterSuggestionBy.createdAt,
        status: recruiterSuggestion.status,
        decidedAt: recruiterSuggestion.decidedAt,
        jobId: job.id,
        title: job.title,
        company: job.companyName,
        closedAt: job.closedAt,
        archivedAt: job.archivedAt,
      })
      .from(recruiterSuggestionBy)
      .innerJoin(recruiterSuggestion, eq(recruiterSuggestion.id, recruiterSuggestionBy.suggestionId))
      .innerJoin(job, eq(job.id, recruiterSuggestion.jobId))
      .where(where)
      .orderBy(desc(recruiterSuggestionBy.createdAt), desc(recruiterSuggestionBy.id))
      .limit(SUGGESTIONS_PAGE_SIZE)
      .offset((page - 1) * SUGGESTIONS_PAGE_SIZE);
    return {
      total,
      page,
      pages: pagesOf(total),
      rows: rows.map((row) => ({
        byId: row.byId,
        suggestedAt: row.suggestedAt,
        status: asStatus(row.status),
        decidedAt: row.decidedAt,
        jobId: row.jobId,
        title: row.title,
        company: row.company,
        jobClosed: row.closedAt !== null || row.archivedAt !== null,
      })),
    };
  },

  /** Pendentes deste recrutador por candidato, só nas concessões vigentes dele (US-013.AC-1). */
  async pendingByCandidate(recruiterUserId: number, grantIds: readonly number[]): Promise<Map<number, number>> {
    if (grantIds.length === 0) return new Map();
    const rows = await getDb()
      .select({ candidateId: recruiterSuggestion.candidateId, n: count() })
      .from(recruiterSuggestionBy)
      .innerJoin(recruiterSuggestion, eq(recruiterSuggestion.id, recruiterSuggestionBy.suggestionId))
      .where(
        and(
          eq(recruiterSuggestionBy.recruiterUserId, recruiterUserId),
          inArray(recruiterSuggestionBy.grantId, [...grantIds]),
          eq(recruiterSuggestion.status, "pending"),
        ),
      )
      .groupBy(recruiterSuggestion.candidateId);
    return new Map(rows.map((row) => [row.candidateId, Number(row.n)]));
  },

  /**
   * Vagas abertas do acervo por título ou empresa, para sugerir (TechSpec,
   * `/recruiter/[id]/suggest`). O texto vira um padrão literal: `%` e `_`
   * digitados não viram curinga.
   */
  async searchOpenJobs(query: string, limit: number): Promise<{ id: number; title: string; company: string; location: string | null }[]> {
    const text = query.trim().slice(0, 120);
    const pattern = `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    return getDb()
      .select({ id: job.id, title: job.title, company: job.companyName, location: job.locationRaw })
      .from(job)
      .where(
        and(
          isNull(job.closedAt),
          isNull(job.archivedAt),
          text === "" ? undefined : sql`(${job.title} ilike ${pattern} or ${job.companyName} ilike ${pattern})`,
        ),
      )
      .orderBy(desc(job.id))
      .limit(limit);
  },
};

export type RecruiterSuggestionStore = typeof drizzleRecruiterSuggestions;
