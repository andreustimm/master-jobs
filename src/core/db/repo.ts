/**
 * Query helpers shared by the CLI and the Next.js server components.
 *
 * Keeping them here (instead of inline in pages) means an agent changing a
 * query changes it once, and the CLI and dashboard can never disagree about
 * what "shortlisted" or "open" means.
 */
import { and, desc, eq, gte, isNull, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  IllegalApplicationTransitionError,
  transitionApplication,
} from "../../contexts/pursuit/domain/application.ts";
import { getDb, type DB } from "./client.ts";
import {
  application,
  jobPage,
  applicationEvent,
  candidateDocument,
  job,
  jobScore,
  source,
  type ApplicationStatus,
  verifyTask,
} from "./schema.ts";

export type BoardRow = {
  jobId: number;
  title: string;
  companyName: string;
  locationRaw: string | null;
  url: string;
  applyUrl: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  sourceId: string;
  sourceLabel: string | null;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  compPeriod: string | null;
  fit: number | null;
  cluster: string | null;
  titleScore: number | null;
  keywordScore: number | null;
  seniorityScore: number | null;
  geoScore: number | null;
  compScore: number | null;
  freshnessScore: number | null;
  benefitScore: number | null;
  blockers: unknown;
  reasons: unknown;
  descriptionLength: number;
  /** Description captured offline by the scraper, if any. */
  pageText: string | null;
  pageTextLength: number;
  pageExtracted: unknown;
  pageFetchedAt: string | null;
  status: string | null;
  appliedAt: string | null;
  /** Última reconferência do link: quando, o veredito e o código HTTP. */
  checkedAt: string | null;
  checkStatus: string | null;
  checkCode: number | null;
  /** Estado na fila de reconferência, quando há tarefa. */
  checkQueue: string | null;
};

/** How much captured description a list row carries. See the query below. */
export const PREVIEW_CHARS = 2500;

export type BoardFilters = {
  minFit?: number;
  cluster?: string;
  status?: ApplicationStatus | "unfiled" | "any";
  /** Free text over title and company. */
  q?: string;
  sourceKind?: string;
  /** Hide anything with a hard blocker — work authorisation, on-site, W2. */
  hideBlocked?: boolean;
  /** Only postings published within N days. */
  freshDays?: number;
  /** Only postings that disclose pay. */
  hasComp?: boolean;
  /**
   * Only postings where the employer is actually named.
   *
   * Jobgether — 4.639 of the corpus — anonymises the employer by design
   * ("on behalf of a partner company"), so `company_name` equals the source
   * label. Those jobs cannot be researched, cannot be matched against your
   * network, and cannot dedupe against the same role on the company's own
   * board. This filter is how you get them out of the way.
   */
  namedEmployer?: boolean;
  /**
   * Only postings whose description is long enough to score on keywords.
   *
   * A posting with no body scores 0 on a component worth 30 points, so its fit
   * is not low — it is *unmeasured*. Job alerts arrive this way by design
   * (ADR 0008 Trava 2 forbids following the link), so the distinction has to be
   * visible rather than silently depressing the rank.
   */
  hasDescription?: boolean;
  sort?: "fit" | "recent" | "comp";
  limit?: number;
  offset?: number;
};

function boardConditions(opts: BoardFilters): SQL[] {
  const conditions: SQL[] = [isNull(job.closedAt)];
  conditions.push(gte(sql`coalesce(${jobScore.fit}, 0)`, opts.minFit ?? 0));

  if (opts.cluster) conditions.push(eq(jobScore.cluster, opts.cluster));
  if (opts.q) {
    const needle = `%${opts.q.toLowerCase()}%`;
    conditions.push(
      sql`(lower(${job.title}) like ${needle} or lower(${job.companyName}) like ${needle})`,
    );
  }
  if (opts.sourceKind) conditions.push(sql`${job.sourceId} like ${`${opts.sourceKind}:%`}`);
  if (opts.hideBlocked) conditions.push(sql`coalesce(${jobScore.blockers}, '[]') = '[]'`);
  if (opts.freshDays && opts.freshDays > 0) {
    const cutoff = new Date(Date.now() - opts.freshDays * 86_400_000).toISOString();
    conditions.push(sql`coalesce(${job.postedAt}, ${job.firstSeenAt}) >= ${cutoff}`);
  }
  if (opts.hasComp) conditions.push(sql`coalesce(${job.compMax}, ${job.compMin}, 0) > 0`);
  if (opts.hasDescription) {
    conditions.push(sql`length(coalesce(${job.descriptionText}, '')) >= 200`);
  }
  if (opts.namedEmployer) {
    conditions.push(sql`lower(${job.companyName}) <> lower(coalesce(${source.label}, ''))`);
  }
  if (opts.status === "unfiled") conditions.push(isNull(application.id));
  else if (opts.status && opts.status !== "any") {
    conditions.push(eq(application.status, opts.status));
  }
  return conditions;
}

/** The main board: open jobs joined with score and pipeline state. */
/**
 * O predicado que amarra score e candidatura ao candidato da sessão.
 *
 * `null` significa sessão SEM escopo de candidato — um recrutador ou um admin
 * puro. Para eles o acervo existe, mas nota de aderência e estado de
 * candidatura não: são colunas de outra pessoa. `1 = 0` faz o `leftJoin` nunca
 * casar, e as colunas voltam nulas, que é exatamente o que elas são.
 *
 * Um `-1` sentinela faria o mesmo e mentiria sobre a intenção; o dia em que
 * alguém criasse um candidato com id negativo, o acervo dele vazaria para todo
 * mundo sem escopo.
 */
function scopedTo(column: SQLiteColumn, candidateId: number | null) {
  return candidateId === null ? sql`1 = 0` : eq(column, candidateId);
}

export async function listBoard(
  candidateId: number | null,
  opts: BoardFilters = {},
): Promise<BoardRow[]> {
  const db = getDb();
  const conditions = boardConditions(opts);

  const order =
    opts.sort === "recent"
      ? [desc(sql`coalesce(${job.postedAt}, ${job.firstSeenAt})`)]
      : opts.sort === "comp"
        ? [desc(sql`coalesce(${job.compMax}, ${job.compMin}, 0)`), desc(sql`coalesce(${jobScore.fit}, 0)`)]
        : [desc(sql`coalesce(${jobScore.fit}, 0)`), desc(job.firstSeenAt)];

  const rows = await db
    .select({
      jobId: job.id,
      title: job.title,
      companyName: job.companyName,
      locationRaw: job.locationRaw,
      url: job.url,
      applyUrl: job.applyUrl,
      postedAt: job.postedAt,
      firstSeenAt: job.firstSeenAt,
      sourceId: job.sourceId,
      sourceLabel: source.label,
      compMin: job.compMin,
      compMax: job.compMax,
      compCurrency: job.compCurrency,
      compPeriod: job.compPeriod,
      fit: jobScore.fit,
      cluster: jobScore.cluster,
      titleScore: jobScore.titleScore,
      keywordScore: jobScore.keywordScore,
      seniorityScore: jobScore.seniorityScore,
      geoScore: jobScore.geoScore,
      compScore: jobScore.compScore,
      freshnessScore: jobScore.freshnessScore,
      benefitScore: jobScore.benefitScore,
      blockers: jobScore.blockers,
      reasons: jobScore.reasons,
      descriptionLength: sql<number>`length(coalesce(${job.descriptionText}, ''))`,
      // Captured offline by the scraper. Present means the description can be
      // read without leaving the app — and without the employer seeing a visit.
      //
      // Truncated in SQL, not in the component: a board page carries dozens of
      // rows, Next serialises the data twice (HTML plus the RSC payload), and
      // full descriptions average 7.400 characters. Sending all of it would
      // cost a megabyte to render a list nobody reads in full. The job's own
      // page loads the complete text, where it is one row and free.
      // Manual comparisons already carry their complete description in the
      // canonical job row; they never pass through the scraper. Falling back
      // only for that source keeps them readable from the board without
      // inflating every row with a second copy of an adapter description.
      pageText: sql<string | null>`substr(coalesce(${jobPage.text}, case when ${job.sourceId} like 'manual:%' then ${job.descriptionText} end), 1, ${PREVIEW_CHARS})`,
      pageTextLength: sql<number>`length(coalesce(${jobPage.text}, case when ${job.sourceId} like 'manual:%' then ${job.descriptionText} end, ''))`,
      pageExtracted: jobPage.extracted,
      pageFetchedAt: jobPage.fetchedAt,
      status: application.status,
      appliedAt: application.appliedAt,
      checkedAt: job.checkedAt,
      checkStatus: job.checkStatus,
      checkCode: job.checkCode,
      checkQueue: verifyTask.status,
    })
    .from(job)
    .leftJoin(
      jobScore,
      and(eq(jobScore.jobId, job.id), scopedTo(jobScore.candidateId, candidateId)),
    )
    .leftJoin(
      application,
      and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)),
    )
    .leftJoin(source, eq(source.id, job.sourceId))
    .leftJoin(verifyTask, eq(verifyTask.jobId, job.id))
    .leftJoin(jobPage, eq(jobPage.jobId, job.id))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(opts.limit ?? 200)
    .offset(opts.offset ?? 0);

  return rows;
}

/**
 * How many rows match, without fetching them.
 *
 * Needed for pagination: the page shows 50 of N, and N cannot come from the
 * page itself. Re-uses the same predicate builder so a filter can never mean
 * one thing in the list and another in the count.
 */
export async function countBoard(
  candidateId: number | null,
  opts: BoardFilters = {},
): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(job)
    .leftJoin(
      jobScore,
      and(eq(jobScore.jobId, job.id), scopedTo(jobScore.candidateId, candidateId)),
    )
    .leftJoin(
      application,
      and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)),
    )
    .leftJoin(source, eq(source.id, job.sourceId))
    .where(and(...boardConditions(opts)));
  return Number(row?.count ?? 0);
}

/** Counts for the filter chips, so the UI can show what each option yields. */
export async function boardFacets(candidateId: number | null, base: BoardFilters = {}) {
  const sourceKind = sql<string>`case
    when instr(${job.sourceId}, ':') > 0 then substr(${job.sourceId}, 1, instr(${job.sourceId}, ':') - 1)
    else ${job.sourceId}
  end`;
  const dimensions = { ...base, limit: undefined, offset: undefined };
  const [total, unblocked, fresh, withComp, named, described, clusterRows, sourceRows] = await Promise.all([
    countBoard(candidateId, dimensions),
    countBoard(candidateId, { ...dimensions, hideBlocked: true }),
    countBoard(candidateId, { ...dimensions, freshDays: 3 }),
    countBoard(candidateId, { ...dimensions, hasComp: true }),
    countBoard(candidateId, { ...dimensions, namedEmployer: true }),
    countBoard(candidateId, { ...dimensions, hasDescription: true }),
    getDb()
      .select({ cluster: jobScore.cluster })
      .from(job)
      .leftJoin(
        jobScore,
        and(eq(jobScore.jobId, job.id), scopedTo(jobScore.candidateId, candidateId)),
      )
      .leftJoin(
        application,
        and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)),
      )
      .leftJoin(source, eq(source.id, job.sourceId))
      .where(and(...boardConditions(dimensions), sql`${jobScore.cluster} is not null`))
      .groupBy(jobScore.cluster)
      .then((rows) => rows.map((row) => row.cluster!).sort()),
    getDb()
      .select({ kind: sourceKind })
      .from(job)
      .leftJoin(
        jobScore,
        and(eq(jobScore.jobId, job.id), scopedTo(jobScore.candidateId, candidateId)),
      )
      .leftJoin(
        application,
        and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)),
      )
      .leftJoin(source, eq(source.id, job.sourceId))
      .where(and(...boardConditions(dimensions)))
      .groupBy(sourceKind)
      .then((rows) => rows.map((row) => row.kind).sort()),
  ]);
  return {
    total,
    unblocked,
    fresh,
    withComp,
    named,
    described,
    clusters: clusterRows,
    sources: sourceRows,
  };
}

/** Move a job through the pipeline and record the transition. */
type DbTransaction = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Persist one aggregate transition using the caller's transaction.
 *
 * Integration use cases that atomically update another context (for example,
 * accepting a mail suggestion) use this entry point so the suggestion,
 * application and event either all commit or all roll back.
 */
export async function setApplicationStatusInTransaction(
  tx: DbTransaction,
  candidateId: number,
  jobId: number,
  status: ApplicationStatus,
  detail?: string,
  stamp = new Date().toISOString(),
  /**
   * Por onde a candidatura foi. `direct` | `ats` | `referral` | `recruiter` |
   * `agency`.
   *
   * É propriedade da CANDIDATURA e não da transição, e é por isso que a escrita
   * dela não depende de o status ter mudado: registrar que uma candidatura já
   * enviada saiu por referral é informação nova sobre um fato antigo.
   *
   * A coluna existe desde o começo, o funil a renderiza e o `jho prep` manda
   * preenchê-la — e nada no sistema escrevia nela. Referral é ~7% dos
   * candidatos e ~40% das contratações; sem esse campo o funil não consegue
   * medir a única alavanca que o próprio produto diz ser a mais forte.
   */
  channel?: string,
): Promise<void> {
  const [previous] = await tx
      .select()
      .from(application)
      .where(
        and(
          eq(application.candidateId, candidateId),
          eq(application.jobId, jobId),
        ),
      )
      .limit(1);

  const transition = transitionApplication(
    previous ? { status: previous.status, appliedAt: previous.appliedAt } : null,
    status,
    stamp,
  );
  if (!transition.ok) {
    throw new IllegalApplicationTransitionError(
      transition.error.from,
      transition.error.to,
    );
  }
  if (!transition.changed) {
    // Status igual, mas o canal pode ser novo. Sair aqui sem gravar descartaria
    // em silêncio o que a pessoa acabou de informar.
    if (channel && previous) {
      await tx
        .update(application)
        .set({ channel, updatedAt: stamp })
        .where(eq(application.id, previous.id));
    }
    return;
  }

  let applicationId: number;
  if (previous) {
    const updated = await tx
        .update(application)
        .set({
          status: transition.state.status,
          appliedAt: transition.state.appliedAt,
          updatedAt: stamp,
          // Só sobrescreve quando veio um canal: um `track` sem `--channel` não
          // pode apagar o que já estava registrado.
          ...(channel ? { channel } : {}),
        })
        // The status is the aggregate's optimistic concurrency token. Two
        // commands may decide from the same snapshot, but only one can commit
        // that snapshot and append its matching event.
        .where(
          and(
            eq(application.id, previous.id),
            eq(application.status, previous.status),
          ),
        )
        .returning({ id: application.id });
    if (updated.length !== 1) {
      throw new ApplicationTransitionConflictError(candidateId, jobId);
    }
    applicationId = previous.id;
  } else {
    const [created] = await tx
        .insert(application)
        .values({
          candidateId,
          jobId,
          status: transition.state.status,
          appliedAt: transition.state.appliedAt,
          updatedAt: stamp,
          channel: channel ?? null,
        })
        .returning({ id: application.id });
    if (!created) throw new Error("application insert returned no row");
    applicationId = created.id;
  }

  await tx.insert(applicationEvent).values({
    applicationId,
    at: transition.event.at,
    kind: transition.event.kind,
    fromStatus: transition.event.fromStatus,
    toStatus: transition.event.toStatus,
    detail: detail ?? null,
  });
}

/** Move a job through the pipeline and record the transition. */
export async function setApplicationStatus(
  candidateId: number,
  jobId: number,
  status: ApplicationStatus,
  detail?: string,
  channel?: string,
): Promise<void> {
  const db = getDb();
  await db.transaction((tx) =>
    setApplicationStatusInTransaction(tx, candidateId, jobId, status, detail, undefined, channel),
  );
}

export class ApplicationTransitionConflictError extends Error {
  readonly code = "application_transition_conflict";

  constructor(candidateId: number, jobId: number) {
    super(`Application changed concurrently: candidate ${candidateId}, job ${jobId}`);
    this.name = "ApplicationTransitionConflictError";
  }
}

/** Record the exact candidate-owned document sent with an application. */
export async function setApplicationDocument(
  candidateId: number,
  jobId: number,
  documentId: number | null,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (documentId !== null) {
      const [owned] = await tx
        .select({ id: candidateDocument.id })
        .from(candidateDocument)
        .where(
          and(
            eq(candidateDocument.id, documentId),
            eq(candidateDocument.candidateId, candidateId),
          ),
        )
        .limit(1);
      if (!owned) throw new Error(`Documento ${documentId} não pertence ao candidato`);
    }

    const updated = await tx
      .update(application)
      .set({ candidateDocumentId: documentId, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(application.candidateId, candidateId),
          eq(application.jobId, jobId),
        ),
      )
      .returning({ id: application.id });
    if (updated.length !== 1) {
      throw new Error(`Candidatura não encontrada: candidato ${candidateId}, vaga ${jobId}`);
    }
  });
}

/** Funnel counts for the dashboard header. */
export async function pipelineCounts(candidateId: number): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ status: application.status, n: sql<number>`count(*)` })
    .from(application)
    .where(eq(application.candidateId, candidateId))
    .groupBy(application.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

/** Everything the detail view needs, in one round trip. */
export async function getJobDetail(candidateId: number, jobId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(job)
    .leftJoin(
      jobScore,
      and(eq(jobScore.jobId, job.id), scopedTo(jobScore.candidateId, candidateId)),
    )
    .leftJoin(
      application,
      and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)),
    )
    .leftJoin(source, eq(source.id, job.sourceId))
    .where(eq(job.id, jobId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    job: row.job,
    score: row.job_score,
    application: row.application,
    source: row.source,
  };
}

/** Global job and canonical score, deliberately excluding private funnel data. */
export async function getJobScoringDetail(candidateId: number, jobId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(job)
    .leftJoin(
      jobScore,
      and(eq(jobScore.jobId, job.id), scopedTo(jobScore.candidateId, candidateId)),
    )
    .leftJoin(source, eq(source.id, job.sourceId))
    .where(eq(job.id, jobId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    job: row.job,
    score: row.job_score,
    source: row.source,
  };
}

/** Headline numbers for the cockpit. */
export async function corpusStats(candidateId: number) {
  const db = getDb();
  const [row] = await db
    .select({
      open: sql<number>`(select count(*) from job where closed_at is null)`,
      companies: sql<number>`(select count(*) from company)`,
      sources: sql<number>`(select count(*) from source where enabled = 1)`,
      above45: sql<number>`(select count(*) from job_score s join job j on j.id = s.job_id where s.candidate_id = ${candidateId} and j.closed_at is null and s.fit >= 45)`,
      above60: sql<number>`(select count(*) from job_score s join job j on j.id = s.job_id where s.candidate_id = ${candidateId} and j.closed_at is null and s.fit >= 60)`,
      above70: sql<number>`(select count(*) from job_score s join job j on j.id = s.job_id where s.candidate_id = ${candidateId} and j.closed_at is null and s.fit >= 70)`,
      best: sql<number>`(select coalesce(max(fit), 0) from job_score s join job j on j.id = s.job_id where s.candidate_id = ${candidateId} and j.closed_at is null)`,
    })
    .from(sql`(select 1)`);
  return row;
}

/** Cluster distribution above a cut, for the cockpit chart. */
export async function clusterBreakdown(candidateId: number, minFit = 45) {
  const db = getDb();
  return db
    .select({
      cluster: jobScore.cluster,
      n: sql<number>`count(*)`,
      best: sql<number>`max(${jobScore.fit})`,
    })
    .from(jobScore)
    .innerJoin(job, eq(job.id, jobScore.jobId))
    .where(
      and(
        eq(jobScore.candidateId, candidateId),
        isNull(job.closedAt),
        gte(jobScore.fit, minFit),
      ),
    )
    .groupBy(jobScore.cluster)
    .orderBy(desc(sql`count(*)`));
}

/** The funnel, with the job each application points at. */
export async function pipelineRows(candidateId: number) {
  const db = getDb();
  return db
    .select({
      jobId: job.id,
      title: job.title,
      companyName: job.companyName,
      url: job.url,
      status: application.status,
      channel: application.channel,
      appliedAt: application.appliedAt,
      nextAction: application.nextAction,
      notes: application.notes,
      fit: jobScore.fit,
      updatedAt: application.updatedAt,
    })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .leftJoin(
      jobScore,
      and(eq(jobScore.jobId, job.id), scopedTo(jobScore.candidateId, candidateId)),
    )
    .where(eq(application.candidateId, candidateId))
    .orderBy(desc(application.updatedAt));
}
