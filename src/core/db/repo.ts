/**
 * Query helpers shared by the CLI and the Next.js server components.
 *
 * Keeping them here (instead of inline in pages) means an agent changing a
 * query changes it once, and the CLI and dashboard can never disagree about
 * what "shortlisted" or "open" means.
 */
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "./client.ts";
import {
  application,
  jobPage,
  applicationEvent,
  job,
  jobScore,
  positioningTask,
  source,
  type ApplicationStatus,
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

/** The main board: open jobs joined with score and pipeline state. */
export async function listBoard(opts: BoardFilters = {}): Promise<BoardRow[]> {
  const db = getDb();
  const conditions = [isNull(job.closedAt)];

  conditions.push(gte(sql`coalesce(${jobScore.fit}, 0)`, opts.minFit ?? 0));

  if (opts.cluster) conditions.push(eq(jobScore.cluster, opts.cluster));

  if (opts.q) {
    const needle = `%${opts.q.toLowerCase()}%`;
    conditions.push(
      sql`(lower(${job.title}) like ${needle} or lower(${job.companyName}) like ${needle})`,
    );
  }

  if (opts.sourceKind) {
    conditions.push(sql`${job.sourceId} like ${`${opts.sourceKind}:%`}`);
  }

  // An empty JSON array is how "no blockers" is stored.
  if (opts.hideBlocked) conditions.push(sql`coalesce(${jobScore.blockers}, '[]') = '[]'`);

  if (opts.freshDays && opts.freshDays > 0) {
    const cutoff = new Date(Date.now() - opts.freshDays * 86_400_000).toISOString();
    // Fall back to first_seen_at: several sources omit a publication date, and
    // dropping those silently would hide fresh jobs rather than stale ones.
    conditions.push(sql`coalesce(${job.postedAt}, ${job.firstSeenAt}) >= ${cutoff}`);
  }

  if (opts.hasComp) conditions.push(sql`coalesce(${job.compMax}, ${job.compMin}, 0) > 0`);

  if (opts.hasDescription) {
    conditions.push(sql`length(coalesce(${job.descriptionText}, '')) >= 200`);
  }

  if (opts.namedEmployer) {
    conditions.push(sql`lower(${job.companyName}) <> lower(coalesce(${source.label}, ''))`);
  }

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
      pageText: sql<string | null>`substr(${jobPage.text}, 1, ${PREVIEW_CHARS})`,
      pageTextLength: sql<number>`length(coalesce(${jobPage.text}, ''))`,
      pageExtracted: jobPage.extracted,
      pageFetchedAt: jobPage.fetchedAt,
      status: application.status,
      appliedAt: application.appliedAt,
    })
    .from(job)
    .leftJoin(jobScore, eq(jobScore.jobId, job.id))
    .leftJoin(application, eq(application.jobId, job.id))
    .leftJoin(source, eq(source.id, job.sourceId))
    .leftJoin(jobPage, eq(jobPage.jobId, job.id))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(opts.limit ?? 200)
    .offset(opts.offset ?? 0);

  // Pipeline status has no index worth a SQL branch at this size.
  if (opts.status === "unfiled") return rows.filter((r) => r.status === null);
  if (opts.status && opts.status !== "any") {
    return rows.filter((r) => r.status === opts.status);
  }
  return rows;
}

/**
 * How many rows match, without fetching them.
 *
 * Needed for pagination: the page shows 50 of N, and N cannot come from the
 * page itself. Re-uses the same predicate builder so a filter can never mean
 * one thing in the list and another in the count.
 */
export async function countBoard(opts: BoardFilters = {}): Promise<number> {
  // Status lives outside SQL (see listBoard), so a status filter must count
  // through the same path rather than a separate COUNT.
  if (opts.status && opts.status !== "any") {
    const rows = await listBoard({ ...opts, limit: 5000, offset: 0 });
    return rows.length;
  }
  const rows = await listBoard({ ...opts, limit: 5000, offset: 0 });
  return rows.length;
}

/** Counts for the filter chips, so the UI can show what each option yields. */
export async function boardFacets(base: BoardFilters = {}) {
  const [all, blocked, fresh, withComp, named, described] = await Promise.all([
    listBoard({ ...base, limit: 5000 }),
    listBoard({ ...base, hideBlocked: true, limit: 5000 }),
    listBoard({ ...base, freshDays: 3, limit: 5000 }),
    listBoard({ ...base, hasComp: true, limit: 5000 }),
    listBoard({ ...base, namedEmployer: true, limit: 5000 }),
    listBoard({ ...base, hasDescription: true, limit: 5000 }),
  ]);
  return {
    total: all.length,
    unblocked: blocked.length,
    fresh: fresh.length,
    withComp: withComp.length,
    named: named.length,
    described: described.length,
    clusters: [...new Set(all.map((r) => r.cluster).filter(Boolean))] as string[],
    sources: [...new Set(all.map((r) => r.sourceId.split(":")[0]))] as string[],
  };
}

/** Move a job through the pipeline and record the transition. */
export async function setApplicationStatus(
  jobId: number,
  status: ApplicationStatus,
  detail?: string,
): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(application)
    .where(eq(application.jobId, jobId))
    .limit(1);

  const stamp = new Date().toISOString();
  const previous = existing[0];

  if (!previous) {
    const inserted = await db
      .insert(application)
      .values({
        jobId,
        status,
        appliedAt: status === "applied" ? stamp : null,
        updatedAt: stamp,
      })
      .returning({ id: application.id });
    const created = inserted[0];
    if (created) {
      await db.insert(applicationEvent).values({
        applicationId: created.id,
        kind: "status_change",
        toStatus: status,
        detail: detail ?? null,
      });
    }
    return;
  }

  await db
    .update(application)
    .set({
      status,
      updatedAt: stamp,
      // Stamp the application date the first time it reaches `applied`.
      appliedAt: status === "applied" && !previous.appliedAt ? stamp : previous.appliedAt,
    })
    .where(eq(application.id, previous.id));

  await db.insert(applicationEvent).values({
    applicationId: previous.id,
    kind: "status_change",
    fromStatus: previous.status,
    toStatus: status,
    detail: detail ?? null,
  });
}

/** Funnel counts for the dashboard header. */
export async function pipelineCounts(): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ status: application.status, n: sql<number>`count(*)` })
    .from(application)
    .groupBy(application.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export async function openTasks() {
  const db = getDb();
  return db
    .select()
    .from(positioningTask)
    .where(sql`${positioningTask.status} in ('todo','doing')`)
    .orderBy(positioningTask.priority, positioningTask.horizon);
}

/** Everything the detail view needs, in one round trip. */
export async function getJobDetail(jobId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(job)
    .leftJoin(jobScore, eq(jobScore.jobId, job.id))
    .leftJoin(application, eq(application.jobId, job.id))
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

/** Headline numbers for the cockpit. */
export async function corpusStats() {
  const db = getDb();
  const [row] = await db
    .select({
      open: sql<number>`(select count(*) from job where closed_at is null)`,
      companies: sql<number>`(select count(*) from company)`,
      sources: sql<number>`(select count(*) from source where enabled = 1)`,
      above45: sql<number>`(select count(*) from job_score s join job j on j.id = s.job_id where j.closed_at is null and s.fit >= 45)`,
      above60: sql<number>`(select count(*) from job_score s join job j on j.id = s.job_id where j.closed_at is null and s.fit >= 60)`,
      above70: sql<number>`(select count(*) from job_score s join job j on j.id = s.job_id where j.closed_at is null and s.fit >= 70)`,
      best: sql<number>`(select coalesce(max(fit), 0) from job_score s join job j on j.id = s.job_id where j.closed_at is null)`,
    })
    .from(sql`(select 1)`);
  return row;
}

/** Cluster distribution above a cut, for the cockpit chart. */
export async function clusterBreakdown(minFit = 45) {
  const db = getDb();
  return db
    .select({
      cluster: jobScore.cluster,
      n: sql<number>`count(*)`,
      best: sql<number>`max(${jobScore.fit})`,
    })
    .from(jobScore)
    .innerJoin(job, eq(job.id, jobScore.jobId))
    .where(and(isNull(job.closedAt), gte(jobScore.fit, minFit)))
    .groupBy(jobScore.cluster)
    .orderBy(desc(sql`count(*)`));
}

/** The funnel, with the job each application points at. */
export async function pipelineRows() {
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
    .leftJoin(jobScore, eq(jobScore.jobId, job.id))
    .orderBy(desc(application.updatedAt));
}
