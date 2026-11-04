/**
 * Canonical observation of a job posting.
 *
 * Every ingestion channel ends here. That is what keeps deduplication, company
 * resolution, application-link fallback, reopening and score invalidation from
 * drifting as new import paths are added.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, type DB } from "../db/client.ts";
import { isDuplicateKey } from "../db/retry.ts";
import { company, job, jobRetentionTombstone, source } from "../db/schema.ts";
import { deleteJobScores } from "../scoring/apply.ts";
import { MANUAL_SOURCE_KINDS, type RawJob } from "../sources/types.ts";
import { ambiguousExternalIds, isRetiredObservation, resolveObservedIdentity, usableExternalId, type RetiredIdentity } from "./identity.ts";
import { decideReopen } from "./lifecycle.ts";
import { contentHash, fingerprint, slugifyCompany, toIsoDate } from "./normalize.ts";

export type JobObservationOutcome =
  | "inserted"
  | "unchanged"
  | "changed"
  | "reopened";

type Database = Pick<DB, "select" | "insert" | "update" | "delete" | "execute">;
type Transaction = Parameters<Parameters<DB["transaction"]>[0]>[0];

async function lockObservation(db: Database): Promise<void> {
  // The block cache assumes no other observer changes identities during this
  // transaction. Serialize blocks, then take the lock that conflicts with
  // administrative expiry. Both locks are released at commit or rollback.
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended('master-jobs:observation', 0))`);
  await db.execute(sql`lock table ${job} in row exclusive mode`);
}

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
  /**
   * The source's own id for this posting, when it may serve as identity
   * (#291): the sync looks the row up by (source, external id) before the
   * fingerprint. Absent, only the fingerprint identifies — term captures,
   * manual entries and imports keep that behaviour.
   */
  externalKey?: string;
  /**
   * Rows of this source with `externalKey`, read in bulk by the caller.
   * Omitted while `externalKey` is set, the observation reads them itself.
   */
  byExternal?: KnownJob[];
};

export type KnownJob = {
  id: number;
  sourceId: string;
  sourceKind: string;
  fingerprint: string;
  contentHash: string;
  closedAt: string | null;
  archivedAt: string | null;
};

const KNOWN_COLUMNS = {
  id: job.id,
  sourceId: job.sourceId,
  sourceKind: source.kind,
  fingerprint: job.fingerprint,
  contentHash: job.contentHash,
  closedAt: job.closedAt,
  archivedAt: job.archivedAt,
};

/** The stored rows for these fingerprints, in one query. */
export async function loadKnownJobs(fingerprints: string[], db: Database = getDb()): Promise<Map<string, KnownJob>> {
  const known = new Map<string, KnownJob>();
  if (fingerprints.length === 0) return known;
  const rows = await db
    .select(KNOWN_COLUMNS)
    .from(job)
    .innerJoin(source, eq(source.id, job.sourceId))
    .where(inArray(job.fingerprint, [...new Set(fingerprints)]));
  for (const row of rows) known.set(row.fingerprint, row);
  return known;
}

/** The stored rows of one source for these external ids, in one query. */
export async function loadKnownByExternal(sourceId: string, externalIds: string[], db: Database = getDb()): Promise<Map<string, KnownJob[]>> {
  const known = new Map<string, KnownJob[]>();
  if (externalIds.length === 0) return known;
  const rows = await db
    .select({ ...KNOWN_COLUMNS, externalId: job.externalId })
    .from(job)
    .innerJoin(source, eq(source.id, job.sourceId))
    .where(and(eq(job.sourceId, sourceId), inArray(job.externalId, [...new Set(externalIds)])));
  for (const { externalId, ...row } of rows) {
    const list = known.get(externalId) ?? [];
    list.push(row);
    known.set(externalId, list);
  }
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
): Promise<ObservationResult[]> {
  const companies = options.companies ?? new Map<string, number>();
  const observations: ObservationResult[] = [];
  const identities = raws.map((raw) => fingerprint(raw));
  // A capture refreshes postings other sources own; its external ids are not
  // the owner's, so only the sync identifies by them. Ambiguity is judged over
  // the whole listing, not per block.
  const byExternalId = !options.keepExistingSource;
  const ambiguous = byExternalId
    ? ambiguousExternalIds(raws.map((raw, index) => ({ externalId: raw.externalId, fingerprint: identities[index]! })))
    : new Set<string>();
  for (let start = 0; start < raws.length; start += KNOWN_BLOCK) {
    const block = raws.slice(start, start + KNOWN_BLOCK);
    const blockIdentities = identities.slice(start, start + KNOWN_BLOCK);
    const externalKeys = block.map((raw) => (byExternalId ? usableExternalId(raw.externalId, ambiguous) : null));
    const blockCompanies = new Map(companies);
    const blockResults = await getDb().transaction(async (tx) => {
    // Retention takes a conflicting table lock before selecting/deleting. Take
    // this lock before reading identities, so each statement sees committed
    // tombstones after any pending retention batch has completed.
    await lockObservation(tx);
    const [sourceRow] = await tx.select({ kind: source.kind }).from(source).where(eq(source.id, sourceId)).limit(1);
    if (!sourceRow) throw new Error(`Fonte inexistente: ${sourceId}`);
    const known = await loadKnownJobs(blockIdentities, tx);
    const external = await loadKnownByExternal(sourceId, externalKeys.filter((key): key is string => key !== null), tx);
    const tombstones = await loadTombstones(tx, blockIdentities, sourceId, externalKeys);
    const results: ObservationResult[] = [];
    // Keys whose batch read can no longer be trusted: the observation reads
    // them again instead of taking "absent" from the map.
    const staleKnown = new Set<string>();
    const staleExternal = new Set<string>();
    for (const [index, raw] of block.entries()) {
      const identity = blockIdentities[index]!;
      const externalKey = externalKeys[index] ?? undefined;
      const observation = await observeRawJobInTransaction(tx, raw, sourceId, {
        ...options,
        companies: blockCompanies,
        known: staleKnown.has(identity) ? undefined : (known.get(identity) ?? null),
        externalKey,
        byExternal:
          externalKey === undefined || staleExternal.has(externalKey) ? undefined : (external.get(externalKey) ?? []),
      }, tombstones, sourceRow.kind);
      results.push(observation);
      // The write may have changed this row's fingerprint or external id
      // (#291), and a listing can repeat a posting. Every entry of this
      // posting or of the row it touched is stale from here on: trusting it
      // would let a later posting of the block land on a row that no longer
      // carries its key — and on the application hanging from it.
      staleKnown.add(identity);
      if (externalKey !== undefined) staleExternal.add(externalKey);
      for (const [key, row] of known) if (row.id === observation.jobId) staleKnown.add(key);
      for (const [key, rows] of external) if (rows.some((row) => row.id === observation.jobId)) staleExternal.add(key);
    }
    return results;
    });
    for (const [slug, id] of blockCompanies) companies.set(slug, id);
    observations.push(...blockResults);
  }
  return observations;
}

async function findKnownJob(db: Database, identity: string): Promise<KnownJob | undefined> {
  const [row] = await db.select(KNOWN_COLUMNS).from(job).innerJoin(source, eq(source.id, job.sourceId)).where(eq(job.fingerprint, identity)).limit(1);
  return row;
}

async function findKnownByExternal(db: Database, sourceId: string, externalKey: string): Promise<KnownJob[]> {
  return (await loadKnownByExternal(sourceId, [externalKey], db)).get(externalKey) ?? [];
}

async function loadTombstones(db: Database, fingerprints: string[], sourceId: string, externalKeys: (string | null)[]): Promise<RetiredIdentity[]> {
  const keys = externalKeys.filter((key): key is string => key !== null);
  const byFingerprint = inArray(jobRetentionTombstone.fingerprint, [...new Set(fingerprints)]);
  const byExternal = keys.length ? and(eq(jobRetentionTombstone.sourceId, sourceId), inArray(jobRetentionTombstone.externalId, [...new Set(keys)])) : undefined;
  return db.select({
    fingerprint: jobRetentionTombstone.fingerprint,
    sourceId: jobRetentionTombstone.sourceId,
    externalId: jobRetentionTombstone.externalId,
    externalUsable: jobRetentionTombstone.externalUsable,
  }).from(jobRetentionTombstone).where(or(byFingerprint, byExternal));
}

export type JobObservation = {
  jobId: number;
  outcome: JobObservationOutcome;
  fingerprint: string;
  contentChanged: boolean;
  /** All candidate-scoped scores removed because their input changed. */
  invalidatedScores: number;
};
export type ObservationResult = JobObservation | {
  jobId: null;
  outcome: "retired";
  fingerprint: string;
  contentChanged: false;
  invalidatedScores: 0;
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
function retainedRawPayload(sourceKind: string, payload: unknown): unknown {
  if ((MANUAL_SOURCE_KINDS as readonly string[]).includes(sourceKind)) return payload;

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

async function resolveCompany(db: Database, name: string, cache?: Map<string, number>): Promise<number | null> {
  const slug = slugifyCompany(name);
  if (!slug) return null;
  const cached = cache?.get(slug);
  if (cached !== undefined) return cached;

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
async function invalidateScores(db: Database, jobId: number): Promise<number> {
  return deleteJobScores(db, jobId);
}

export async function observeRawJob(
  raw: RawJob,
  sourceId: string,
  options: ObserveRawJobOptions = {},
): Promise<JobObservation> {
  const companies = new Map(options.companies);
  const result = await getDb().transaction(async (tx) => {
    await lockObservation(tx);
    const [sourceRow] = await tx.select({ kind: source.kind }).from(source).where(eq(source.id, sourceId)).limit(1);
    if (!sourceRow) throw new Error(`Fonte inexistente: ${sourceId}`);
    const identity = options.fingerprintOverride ?? fingerprint(raw);
    const markers = await loadTombstones(tx, [identity], sourceId, [options.externalKey ?? null]);
    // Caller caches may predate the lock and cannot prove current identity.
    return observeRawJobInTransaction(tx, raw, sourceId, { ...options, companies, known: undefined, byExternal: undefined }, markers, sourceRow.kind);
  });
  if (result.outcome === "retired") throw new Error("A vaga foi descartada pela retenção; importe manualmente para incluí-la novamente.");
  if (options.companies) for (const [slug, id] of companies) options.companies.set(slug, id);
  return result;
}

async function observeRawJobInTransaction(
  db: Transaction,
  raw: RawJob,
  sourceId: string,
  options: ObserveRawJobOptions,
  tombstones: RetiredIdentity[],
  sourceKind: string,
): Promise<ObservationResult> {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const identity = options.fingerprintOverride ?? fingerprint(raw);
  const nextContentHash = contentHash(raw);

  const byFingerprint = options.known === undefined ? await findKnownJob(db, identity) : (options.known ?? undefined);
  const byExternal =
    options.externalKey === undefined
      ? []
      : (options.byExternal ?? (await findKnownByExternal(db, sourceId, options.externalKey)));
  const decision = resolveObservedIdentity({ fingerprint: identity, byExternal, byFingerprint: byFingerprint ?? null });
  let existing = decision.existing ?? undefined;
  const humanAuthored = (MANUAL_SOURCE_KINDS as readonly string[]).includes(sourceKind);

  // A feed must not take ownership of, or replace text/notes on, a vacancy
  // entered by a person merely because its fingerprint matches.
  if (existing && !humanAuthored && (MANUAL_SOURCE_KINDS as readonly string[]).includes(existing.sourceKind)) {
    return { jobId: existing.id, fingerprint: existing.fingerprint, outcome: "unchanged", contentChanged: false, invalidatedScores: 0 };
  }

  if (isRetiredObservation({
    fingerprint: identity,
    sourceId,
    externalKey: options.externalKey ?? null,
    hasLiveMatch: existing !== undefined,
    humanAuthored,
    tombstones,
  })) {
    return { jobId: null, fingerprint: identity, outcome: "retired", contentChanged: false, invalidatedScores: 0 };
  }

  const companyId = await resolveCompany(db, raw.companyName, options.companies);
  // Who owns the posting, where it lives and the owner's payload (a manual
  // job keeps the person's notes there). A term capture refreshing a job
  // another source owns leaves these alone.
  const ownership = {
    sourceId,
    externalId: raw.externalId,
    url: raw.url,
    // Empty strings are missing data too; `??` alone would preserve them.
    applyUrl: resolveApplyUrl(raw),
    raw: retainedRawPayload(sourceKind, raw.raw),
  };
  const content = {
    fingerprint: decision.fingerprint,
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

    existing = await findKnownJob(db, identity);
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
  const target = existing;
  // Store the latest complete observation even when scoring content stayed the
  // same: apply URLs and source metadata can change independently of the text.
  const write = (targetDb: Database, fingerprintToWrite: string) =>
    targetDb
      .update(job)
      .set({
        ...observed,
        fingerprint: fingerprintToWrite,
        closedAt: null,
        ...(reopen.kind === "reopen" && reopen.clearsArchive ? { archivedAt: null } : {}),
      })
      .where(eq(job.id, target.id));
  let written = observed.fingerprint;
  try {
    // A unique violation aborts a PostgreSQL transaction. A savepoint keeps
    // the enclosing batch usable when another worker claimed this fingerprint.
    if (written === target.fingerprint) await write(db, written);
    else await db.transaction((savepoint) => write(savepoint, written));
  } catch (error) {
    // Another worker inserted the new fingerprint between the read and this
    // write. The row keeps its old one, exactly as if the read had seen it.
    if (!isDuplicateKey(error) || written === target.fingerprint) throw error;
    written = target.fingerprint;
    await write(db, written);
  }

  const invalidatedScores = contentChanged
    ? await invalidateScores(db, existing.id)
    : 0;
  return {
    jobId: existing.id,
    fingerprint: written,
    outcome: wasClosed ? "reopened" : contentChanged ? "changed" : "unchanged",
    contentChanged,
    invalidatedScores,
  };
}
