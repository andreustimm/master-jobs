/**
 * Canonical observation of a job posting.
 *
 * Every ingestion channel ends here. That is what keeps deduplication, company
 * resolution, application-link fallback, reopening and score invalidation from
 * drifting as new import paths are added.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { company, job } from "../db/schema.ts";
import { deleteJobScores } from "../scoring/apply.ts";
import { MANUAL_SOURCE_KINDS, type RawJob } from "../sources/types.ts";
import { decideReopen } from "./lifecycle.ts";
import { contentHash, fingerprint, slugifyCompany, toIsoDate } from "./normalize.ts";

export type JobObservationOutcome =
  | "inserted"
  | "unchanged"
  | "changed"
  | "reopened";

export type ObserveRawJobOptions = {
  fingerprintOverride?: string;
  observedAt?: string;
  /**
   * Term captures observe jobs other sources own (ADR-011). An existing job
   * keeps its source, external id and links — the capture only refreshes the
   * posting — so the regular sync that lists it keeps closing it correctly.
   */
  keepExistingSource?: boolean;
  /**
   * The stored row for this fingerprint, read in bulk by the caller with
   * `loadKnownJobs`; `null` means the batch read found none. Omitted, the
   * observation reads it itself. A sync run from far away pays one network
   * round trip per query, so the per-job read is what made a board of 4.000
   * postings outlast the sweep's hour.
   */
  known?: KnownJob | null;
  /**
   * Company ids already resolved in this run, by slug. A slug never changes
   * owner and companies are never deleted, so the cache cannot go stale.
   */
  companies?: Map<string, number>;
};

export type KnownJob = {
  id: number;
  contentHash: string;
  closedAt: string | null;
  archivedAt: string | null;
};

const KNOWN_COLUMNS = {
  id: job.id,
  contentHash: job.contentHash,
  closedAt: job.closedAt,
  archivedAt: job.archivedAt,
};

/** The stored rows for these fingerprints, in one query. */
export async function loadKnownJobs(fingerprints: string[]): Promise<Map<string, KnownJob>> {
  const known = new Map<string, KnownJob>();
  if (fingerprints.length === 0) return known;
  const rows = await getDb()
    .select({ ...KNOWN_COLUMNS, fingerprint: job.fingerprint })
    .from(job)
    .where(inArray(job.fingerprint, [...new Set(fingerprints)]));
  for (const { fingerprint: key, ...row } of rows) known.set(key, row);
  return known;
}

/**
 * Postings looked up per query. Large enough that the lookup is noise next to
 * the writes, small enough that a row read at the start of a block is still
 * current when its turn comes.
 */
const KNOWN_BLOCK = 100;

/**
 * Observe a channel's postings in order, reading the stored rows in blocks.
 *
 * Same outcomes as calling `observeRawJob` one by one; only the reads are
 * batched. Results come back in input order.
 */
export async function observeRawJobs(
  raws: RawJob[],
  sourceId: string,
  options: Pick<ObserveRawJobOptions, "observedAt" | "keepExistingSource" | "companies"> = {},
): Promise<JobObservation[]> {
  const companies = options.companies ?? new Map<string, number>();
  const observations: JobObservation[] = [];
  for (let start = 0; start < raws.length; start += KNOWN_BLOCK) {
    const block = raws.slice(start, start + KNOWN_BLOCK);
    const identities = block.map((raw) => fingerprint(raw));
    const known = await loadKnownJobs(identities);
    for (const [index, raw] of block.entries()) {
      const identity = identities[index]!;
      observations.push(
        await observeRawJob(raw, sourceId, { ...options, companies, known: known.get(identity) ?? null }),
      );
      // A listing can repeat a posting. The second sighting must not trust
      // the row read before the first one wrote: without the entry it tries
      // an insert, loses to the unique key and reads the current row.
      known.delete(identity);
    }
  }
  return observations;
}

async function findKnownJob(identity: string): Promise<KnownJob | undefined> {
  const [row] = await getDb().select(KNOWN_COLUMNS).from(job).where(eq(job.fingerprint, identity)).limit(1);
  return row;
}

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

/**
 * Payload authored by a person can contain notes and extraction provenance.
 * Network adapter payloads are reconstructable and commonly duplicate the
 * entire description, sometimes more than once. Keep the former, discard the
 * latter after normalization.
 */
function retainedRawPayload(sourceId: string, payload: unknown): unknown {
  const kind = sourceId.split(":", 1)[0] ?? "";
  if ((MANUAL_SOURCE_KINDS as readonly string[]).includes(kind)) return payload;

  // The work-mode filter needs the declared workplace type after the large
  // adapter response is discarded. Keep that one normalized signal; location
  // and `remote` alone cannot distinguish hybrid from on-site.
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const workplaceType = (payload as Record<string, unknown>).workplaceType;
    if (typeof workplaceType === "string" && workplaceType.trim()) {
      return { workplaceType };
    }
  }
  return {};
}

async function resolveCompany(name: string, cache?: Map<string, number>): Promise<number | null> {
  const slug = slugifyCompany(name);
  if (!slug) return null;
  const cached = cache?.get(slug);
  if (cached !== undefined) return cached;

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
  if (stored) cache?.set(slug, stored.id);
  return stored?.id ?? null;
}

/**
 * Scores are derived from job content and scoped by candidate. A content edit
 * invalidates every candidate's row for this job; choosing one candidate here
 * would leave every other ranking stale.
 */
async function invalidateScores(jobId: number): Promise<number> {
  return deleteJobScores(getDb(), jobId);
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

  let existing = options.known === undefined ? await findKnownJob(identity) : (options.known ?? undefined);

  const companyId = await resolveCompany(raw.companyName, options.companies);
  // Who owns the posting, where it lives and the owner's payload (a manual
  // job keeps the person's notes there). A term capture refreshing a job
  // another source owns leaves these alone.
  const ownership = {
    sourceId,
    externalId: raw.externalId,
    url: raw.url,
    // Empty strings are missing data too; `??` alone would preserve them.
    applyUrl: resolveApplyUrl(raw),
    raw: retainedRawPayload(sourceId, raw.raw),
  };
  const content = {
    fingerprint: identity,
    contentHash: nextContentHash,
    companyId,
    companyName: raw.companyName,
    title: raw.title,
    // HTML is only an input to the adapter's text extraction. The normalized
    // text below is the canonical description used by scoring and UI.
    descriptionHtml: null,
    descriptionText: raw.descriptionText ?? null,
    locationRaw: raw.locationRaw ?? null,
    remote: raw.remote ?? null,
    employmentType: raw.employmentType ?? null,
    seniorityRaw: raw.seniorityRaw ?? null,
    compMin: raw.compMin ?? null,
    compMax: raw.compMax ?? null,
    compCurrency: raw.compCurrency ?? null,
    compPeriod: raw.compPeriod ?? null,
    postedAt: toIsoDate(raw.postedAt),
    lastSeenAt: observedAt,
  };
  const values = { ...content, ...ownership };

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

    existing = await findKnownJob(identity);
    if (!existing) throw new Error("job fingerprint conflict returned no row");
  }

  const contentChanged = existing.contentHash !== nextContentHash;
  // Seen again means alive: the same rule the link check applies. Reopening
  // also undoes archiving, or the job would come back half hidden (ADR 0020).
  const reopen = decideReopen({
    verdict: "alive",
    closedAt: existing.closedAt,
    archivedAt: existing.archivedAt,
  });
  const wasClosed = reopen.kind === "reopen";

  const observed = options.keepExistingSource ? content : values;

  // Store the latest complete observation even when scoring content stayed the
  // same: apply URLs and source metadata can change independently of the text.
  await db
    .update(job)
    .set({
      ...observed,
      closedAt: null,
      ...(reopen.kind === "reopen" && reopen.clearsArchive ? { archivedAt: null } : {}),
    })
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
