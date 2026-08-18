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
  fit: number | null;
  cluster: string | null;
  blockers: unknown;
  reasons: unknown;
  status: string | null;
  appliedAt: string | null;
};

/** The main board: open jobs, best fit first, joined with pipeline state. */
export async function listBoard(opts: {
  minFit?: number;
  status?: ApplicationStatus | "unfiled";
  limit?: number;
} = {}): Promise<BoardRow[]> {
  const db = getDb();
  const minFit = opts.minFit ?? 0;

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
      fit: jobScore.fit,
      cluster: jobScore.cluster,
      blockers: jobScore.blockers,
      reasons: jobScore.reasons,
      status: application.status,
      appliedAt: application.appliedAt,
    })
    .from(job)
    .leftJoin(jobScore, eq(jobScore.jobId, job.id))
    .leftJoin(application, eq(application.jobId, job.id))
    .where(and(isNull(job.closedAt), gte(sql`coalesce(${jobScore.fit}, 0)`, minFit)))
    .orderBy(desc(sql`coalesce(${jobScore.fit}, 0)`), desc(job.firstSeenAt))
    .limit(opts.limit ?? 200);

  if (opts.status === "unfiled") return rows.filter((r) => r.status === null);
  if (opts.status) return rows.filter((r) => r.status === opts.status);
  return rows;
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
