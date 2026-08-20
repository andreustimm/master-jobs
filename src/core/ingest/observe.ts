/**
 * Canonical observation of a job posting.
 *
 * Every ingestion channel ends here. That is what keeps deduplication, company
 * resolution, application-link fallback, reopening and score invalidation from
 * drifting as new import paths are added.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { company, job, jobScore } from "../db/schema.ts";
import type { RawJob } from "../sources/types.ts";
import { contentHash, fingerprint, slugifyCompany, toIsoDate } from "./normalize.ts";

export type JobObservationOutcome =
  | "inserted"
  | "unchanged"
  | "changed"
  | "reopened";

export type ObserveRawJobOptions = {
  fingerprintOverride?: string;
  observedAt?: string;
};

export type JobObservation = {
  jobId: number;
  fingerprint: string;
  outcome: JobObservationOutcome;
  contentChanged: boolean;
  /** All candidate-scoped scores removed because their input changed. */
  invalidatedScores: number;
};

function resolveApplyUrl(raw: RawJob): string {
  const explicit = raw.applyUrl?.trim();
  return explicit ? explicit : raw.url;
}

async function resolveCompany(name: string): Promise<number | null> {
  const slug = slugifyCompany(name);
  if (!slug) return null;

  const db = getDb();
  await db
    .insert(company)
    .values({ slug, name })
    .onConflictDoNothing({ target: company.slug });
  const [stored] = await db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.slug, slug))
    .limit(1);
  return stored?.id ?? null;
}

/**
 * Scores are derived from job content and scoped by candidate. A content edit
 * invalidates every candidate's row for this job; choosing one candidate here
 * would leave every other ranking stale.
 */
async function invalidateScores(jobId: number): Promise<number> {
  const deleted = await getDb()
    .delete(jobScore)
    .where(eq(jobScore.jobId, jobId))
    .returning({ candidateId: jobScore.candidateId });
  return deleted.length;
}

export async function observeRawJob(
  raw: RawJob,
  sourceId: string,
  options: ObserveRawJobOptions = {},
): Promise<JobObservation> {
  const db = getDb();
  const observedAt = options.observedAt ?? new Date().toISOString();
  const identity = options.fingerprintOverride ?? fingerprint(raw);
  const nextContentHash = contentHash(raw);

  let [existing] = await db
    .select({ id: job.id, contentHash: job.contentHash, closedAt: job.closedAt })
    .from(job)
    .where(eq(job.fingerprint, identity))
    .limit(1);

  const companyId = await resolveCompany(raw.companyName);
  const values = {
    fingerprint: identity,
    contentHash: nextContentHash,
    sourceId,
    externalId: raw.externalId,
    companyId,
    companyName: raw.companyName,
    title: raw.title,
    descriptionHtml: raw.descriptionHtml ?? null,
    descriptionText: raw.descriptionText ?? null,
    locationRaw: raw.locationRaw ?? null,
    remote: raw.remote ?? null,
    employmentType: raw.employmentType ?? null,
    seniorityRaw: raw.seniorityRaw ?? null,
    compMin: raw.compMin ?? null,
    compMax: raw.compMax ?? null,
    compCurrency: raw.compCurrency ?? null,
    compPeriod: raw.compPeriod ?? null,
    url: raw.url,
    // Empty strings are missing data too; `??` alone would preserve them.
    applyUrl: resolveApplyUrl(raw),
    postedAt: toIsoDate(raw.postedAt),
    lastSeenAt: observedAt,
    raw: raw.raw,
  };

  if (!existing) {
    const [inserted] = await db
      .insert(job)
      .values({ ...values, firstSeenAt: observedAt })
      // Different source workers can observe the same cross-board fingerprint
      // concurrently. The unique key elects the creator; the loser continues
      // below as an ordinary observation instead of failing its whole source.
      .onConflictDoNothing({ target: job.fingerprint })
      .returning({ id: job.id });
    if (inserted) {
      return {
        jobId: inserted.id,
        fingerprint: identity,
        outcome: "inserted",
        contentChanged: false,
        invalidatedScores: 0,
      };
    }

    [existing] = await db
      .select({ id: job.id, contentHash: job.contentHash, closedAt: job.closedAt })
      .from(job)
      .where(eq(job.fingerprint, identity))
      .limit(1);
    if (!existing) throw new Error("job fingerprint conflict returned no row");
  }

  const contentChanged = existing.contentHash !== nextContentHash;
  const wasClosed = existing.closedAt !== null;

  // Store the latest complete observation even when scoring content stayed the
  // same: apply URLs and source metadata can change independently of the text.
  await db
    .update(job)
    .set({ ...values, closedAt: null })
    .where(eq(job.id, existing.id));

  const invalidatedScores = contentChanged
    ? await invalidateScores(existing.id)
    : 0;
  return {
    jobId: existing.id,
    fingerprint: identity,
    outcome: wasClosed ? "reopened" : contentChanged ? "changed" : "unchanged",
    contentChanged,
    invalidatedScores,
  };
}
