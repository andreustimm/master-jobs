/**
 * Database retention for data that can be reconstructed.
 *
 * The useful job description is `job.description_text`. Adapter HTML, the
 * original API payload and successfully parsed page HTML are temporary input,
 * not product state. Keeping all three copies made the corpus hundreds of MB.
 *
 * User decisions and authored vacancies are outside this routine. A closed
 * job is removed only when it has no protected interaction or human origin.
 *
 * Sign-up records (`auth_signup`, #464, ADR-009) are purged here too: a pending
 * sign-up older than 24 h can no longer be confirmed and still holds CV text,
 * and a completed one is only needed for the per-IP cap (one hour) and a short
 * audit window, so it goes after 30 days. The account itself lives in
 * `auth_user` and is untouched.
 */
import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  inArray,
  isNotNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { getDb, type DB } from "./client.ts";
import {
  application,
  authSignup,
  job,
  jobAnalysis,
  jobPage,
  jobRetentionTombstone,
  mailSuggestion,
  recruiterDirectoryQuery,
  recruiterInvite,
  recruiterSuggestion,
  scrapeTask,
  source,
  verifyTask,
} from "./schema.ts";
import { MANUAL_SOURCE_KINDS } from "../sources/types.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const DEFAULT_CLOSED_JOB_DAYS = 90;
export const DEFAULT_JOB_RETENTION_DAYS = 14;
export const DEFAULT_PAGE_HTML_DAYS = 0;
/** Pending sign-up never confirmed: discarded after this (PRD, ADR-009). */
export const SIGNUP_PENDING_HOURS = 24;
/** Completed sign-up record: kept this long, then purged (ADR-009). */
export const SIGNUP_COMPLETED_DAYS = 30;
/** Dead recruiter invitation (expired, cancelled, superseded): kept this long after it ended (#465, ADR-016). */
export const DEAD_INVITE_DAYS = 30;
/** Directory search log: only the per-recruiter limit reads it, over ten minutes (ADR-017). */
export const DIRECTORY_QUERY_DAYS = 1;

export type DatabaseCleanupOptions = {
  /** False is a read-only inventory. Mutation always requires an explicit true. */
  apply?: boolean;
  closedJobDays?: number;
  pageHtmlDays?: number;
  /** Injected in tests so cutoff decisions are deterministic. */
  now?: Date;
};

export type CleanupCandidates = {
  onlineJobs: number;
  onlinePayloadBytes: number;
  parsedPages: number;
  parsedPageHtmlBytes: number;
  closedJobs: number;
  reclaimableBytes: number;
  /** `auth_signup` rows past retention: pending > 24 h or completed > 30 days. */
  expiredSignups: number;
  /** Recruiter invitations that ended more than 30 days ago. */
  deadInvites: number;
};

export type DatabaseCleanupResult = {
  policy: { closedJobDays: number; pageHtmlDays: number };
  candidates: CleanupCandidates;
  applied: null | {
    compactedJobs: number;
    clearedPages: number;
    prunedJobs: number;
    purgedSignups: number;
    purgedInvites: number;
    purgedDirectoryQueries: number;
  };
};

/**
 * Recruiter invitations that can no longer become access, ended more than 30
 * days ago (ADR-016). `pending` and `accepted` stay: the first may still be
 * used, the second is the origin of a grant. The candidate's history keeps the
 * email, and its `invite_id` becomes null through the foreign key.
 */
function deadInvite(now: Date): SQL {
  return and(
    inArray(recruiterInvite.status, ["expired", "cancelled", "superseded"]),
    lt(recruiterInvite.decidedAt, cutoff(now, DEAD_INVITE_DAYS)),
  )!;
}

/**
 * Which `auth_signup` rows are past retention.
 *
 * Pending is judged by `created_at`, not `expires_at`: a social pending expires
 * in 15 minutes but the PRD discards any unconfirmed sign-up after 24 h, and a
 * single cutoff keeps "expired" (refused by the service) separate from
 * "purged" (gone from the table).
 */
function expiredSignup(now: Date): SQL {
  const pendingBefore = new Date(now.getTime() - SIGNUP_PENDING_HOURS * HOUR_MS).toISOString();
  const completedBefore = cutoff(now, SIGNUP_COMPLETED_DAYS);
  return sql`(
    (${authSignup.completedAt} is null and ${authSignup.createdAt} < ${pendingBefore})
    or (${authSignup.completedAt} is not null and ${authSignup.completedAt} < ${completedBefore})
  )`;
}

function wholeNonNegative(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} precisa ser um inteiro maior ou igual a zero.`);
  }
  return value;
}

function cutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function payloadNeedsCompaction(descriptionHtml: SQLWrapper, raw: SQLWrapper): SQL {
  return sql`(
    ${descriptionHtml} is not null or (
      ${raw}::jsonb <> '{}'::jsonb and not (
        coalesce(jsonb_typeof(${raw}::jsonb -> 'workplaceType') = 'string', false)
        and ${raw}::jsonb = jsonb_build_object('workplaceType', ${raw}::jsonb -> 'workplaceType')
      )
    )
  )`;
}

type Transaction = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * User decisions and user-created vacancies survive every prune path.
 * Protect periodic verification too: an existing task can become user-origin
 * without changing its job FK, so that update would not lock the parent row.
 */
function hasNoHumanInteraction(id: SQLWrapper, sourceId: SQLWrapper, authorId: SQLWrapper, archivedAt: SQLWrapper): SQL {
  const manualKinds = sql.join(MANUAL_SOURCE_KINDS.map((kind) => sql`${kind}`), sql`, `);
  return sql`(
    ${authorId} is null
    and ${archivedAt} is null
    and not exists (select 1 from ${source} s where s.id = ${sourceId} and s.kind in (${manualKinds}))
    and not exists (select 1 from ${application} a where a.job_id = ${id})
    and not exists (select 1 from ${jobAnalysis} a where a.job_id = ${id})
    and not exists (select 1 from ${mailSuggestion} m where m.job_id = ${id})
    and not exists (select 1 from ${recruiterSuggestion} r where r.job_id = ${id})
    and not exists (select 1 from ${verifyTask} v where v.job_id = ${id})
    and not exists (select 1 from ${scrapeTask} q where q.job_id = ${id})
  )`;
}

/** Called only after row locks; rechecks eligibility in the DELETE statement. */
async function deleteLockedJobs(tx: Transaction, ids: number[], eligible: SQL): Promise<{ id: number }[]> {
  return tx.delete(job)
    .where(and(sql`${job.id} = any(${`{${ids.join(",")}}`}::int[])`, eligible))
    .returning({ id: job.id });
}

/** Read-only estimate. Earlier markers remain history and do not exempt a new publication. */
export async function inventoryOldJobs(now = new Date()): Promise<{
  older: number;
  potentiallyRemovable: number;
  protected: number;
  alreadyMarked: number;
}> {
  const before = cutoff(now, DEFAULT_JOB_RETENTION_DAYS);
  // Drizzle unqualifies columns in a single-table SELECT projection; explicit
  // outer aliases keep correlated subqueries bound to the job, not their inner row.
  const noInteraction = hasNoHumanInteraction(sql`"job"."id"`, sql`"job"."source_id"`, sql`"job"."posted_by_user_id"`, sql`"job"."archived_at"`);
  const hasMarker = sql`exists (select 1 from ${jobRetentionTombstone} t where t.fingerprint = "job"."fingerprint")`;
  const [row] = await getDb().select({
    older: sql<number>`count(*)::int`,
    potentiallyRemovable: sql<number>`count(*) filter (where ${noInteraction})::int`,
    alreadyMarked: sql<number>`count(*) filter (where ${noInteraction} and ${hasMarker})::int`,
  }).from(job).where(lt(job.firstSeenAt, before));
  const older = Number(row?.older ?? 0);
  const potentiallyRemovable = Number(row?.potentiallyRemovable ?? 0);
  const alreadyMarked = Number(row?.alreadyMarked ?? 0);
  return { older, potentiallyRemovable, alreadyMarked, protected: older - potentiallyRemovable };
}

/**
 * Expires one bounded batch and records identities in the same transaction.
 * The table lock conflicts with observation's lock: ingestion cannot read an
 * absent tombstone and then insert after this transaction commits. Callers
 * must separately enforce backup, manifest persistence and operational gates.
 */
export async function expireOldJobsBatch(options: { now?: Date; limit?: number } = {}): Promise<{
  batchId: string;
  jobs: { id: number; fingerprint: string; sourceId: string; externalId: string }[];
}> {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("limit deve estar entre 1 e 500.");
  const now = options.now ?? new Date();
  const batchId = randomUUID();
  const before = cutoff(now, DEFAULT_JOB_RETENTION_DAYS);
  const eligible = and(
    lt(job.firstSeenAt, before),
    hasNoHumanInteraction(job.id, job.sourceId, job.postedByUserId, job.archivedAt),
  );
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`lock table ${job} in share row exclusive mode`);
    const locked = await tx.select({ id: job.id }).from(job).where(eligible).orderBy(job.id).limit(limit).for("update", { skipLocked: true });
    if (!locked.length) return { batchId, jobs: [] };
    // A fresh READ COMMITTED snapshot after the row locks observes interactions
    // that committed while selection waited; the predicate is applied again.
    const ids = locked.map((row) => row.id);
    const selected = await tx.select({
      id: job.id, fingerprint: job.fingerprint, sourceId: job.sourceId,
      externalId: job.externalId, firstSeenAt: job.firstSeenAt,
      externalUsable: sql<boolean>`(
        btrim("job"."external_id") <> '' and "job"."external_id" = btrim("job"."external_id")
        and not exists (select 1 from ${job} other where other.source_id = "job"."source_id"
          and other.external_id = "job"."external_id" and other.id <> "job"."id")
        and not exists (select 1 from ${jobRetentionTombstone} t where t.source_id = "job"."source_id"
          and t.external_id = "job"."external_id" and t.fingerprint <> "job"."fingerprint")
      )`,
    }).from(job).where(and(inArray(job.id, ids), eligible));
    if (!selected.length) return { batchId, jobs: [] };
    // An external id reused by distinct postings must never suppress either
    // solely by that id. Mark older tombstones ambiguous as well.
    const ambiguous = selected.filter((row) => !row.externalUsable && row.externalId.trim());
    if (ambiguous.length) {
      await tx.update(jobRetentionTombstone).set({ externalUsable: false }).where(or(...ambiguous.map((row) => and(
        eq(jobRetentionTombstone.sourceId, row.sourceId), eq(jobRetentionTombstone.externalId, row.externalId),
      ))));
    }
    // Append a manifest row for each removed publication. An older posting
    // with the same fingerprint keeps its own identity and batch evidence.
    const inserted = await tx.insert(jobRetentionTombstone).values(selected.map((row) => ({
        fingerprint: row.fingerprint, sourceId: row.sourceId, externalId: row.externalId,
        externalUsable: row.externalUsable, firstSeenAt: row.firstSeenAt, expiredAt: now.toISOString(),
        originalJobId: row.id, batchId,
    }))).returning({ fingerprint: jobRetentionTombstone.fingerprint });
    if (inserted.length !== selected.length) throw new Error("Retenção: manifesto incompleto, lote revertido.");
    const removed = await deleteLockedJobs(tx, selected.map((row) => row.id), eligible!);
    if (removed.length !== selected.length) throw new Error("Retenção concorrente: lote revertido por mudança de elegibilidade.");
    return { batchId, jobs: selected.map(({ id, fingerprint, sourceId, externalId }) => ({ id, fingerprint, sourceId, externalId })) };
  });
}

/**
 * The only authorized way to delete a job: closed before `closedBefore` and
 * without a protected interaction or human origin. Must run inside a transaction.
 *
 * Two statements on purpose. A single `DELETE ... WHERE NOT EXISTS
 * (application)` evaluates the predicate with the snapshot taken when the
 * statement starts. An application inserted concurrently holds a key-share
 * lock on the job; the DELETE waits for it and, once the other transaction
 * commits, proceeds — the job row was locked, not changed, so nothing is
 * rechecked — and `application.job_id ON DELETE CASCADE` erases the decision
 * that just committed. `tests/db-decision-integrity.test.ts` reproduces it.
 *
 * Locking first (`FOR UPDATE`) waits for every application already referencing
 * those rows and blocks new ones until commit. The DELETE is then a new
 * statement in READ COMMITTED, so its snapshot sees every application that
 * committed while we waited, and the predicate is evaluated again. A late
 * application fails on the foreign key instead of vanishing: the user sees
 * an error, never a silent loss.
 */
export async function deleteClosedJobsWithoutApplication(
  tx: Transaction,
  closedBefore: string,
): Promise<{ id: number }[]> {
  const eligible = and(
    lt(job.closedAt, closedBefore),
    hasNoHumanInteraction(job.id, job.sourceId, job.postedByUserId, job.archivedAt),
  );
  const locked = await tx
    .select({ id: job.id })
    .from(job)
    .where(eligible)
    .orderBy(job.id)
    .for("update");
  if (locked.length === 0) return [];
  return deleteLockedJobs(tx, locked.map((row) => row.id), eligible!);
}

/**
 * Inventories and, only with `apply`, removes reconstructable payloads.
 *
 * Turso counts aggregate scans as row reads, so the inventory is one explicit
 * operation, not something called by each dashboard request. The mutation is
 * transactional: either all retention rules take effect or none do.
 */
export async function runDatabaseCleanup(
  options: DatabaseCleanupOptions = {},
): Promise<DatabaseCleanupResult> {
  const closedJobDays = wholeNonNegative(
    options.closedJobDays ?? DEFAULT_CLOSED_JOB_DAYS,
    "closedJobDays",
  );
  const pageHtmlDays = wholeNonNegative(
    options.pageHtmlDays ?? DEFAULT_PAGE_HTML_DAYS,
    "pageHtmlDays",
  );
  const now = options.now ?? new Date();
  const closedBefore = cutoff(now, closedJobDays);
  const pageBefore = cutoff(now, pageHtmlDays);
  const db = getDb();
  const manualKindsSql = sql.join(
    MANUAL_SOURCE_KINDS.map((kind) => sql`${kind}`),
    sql`, `,
  );
  const onlineSourceCondition = sql`s.kind not in (${manualKindsSql})`;
  const [inventory] = await db.execute<{
    online_jobs: number;
    online_payload_bytes: number;
    parsed_pages: number;
    parsed_page_html_bytes: number;
    closed_jobs: number;
  }>(sql`
    select
      (
        select count(*) from production.job j
        join production.source s on s.id = j.source_id
        where ${onlineSourceCondition}
          and ${payloadNeedsCompaction(sql`j.description_html`, sql`j.raw`)}
      ) as online_jobs,
      (
        select coalesce(sum(
          coalesce(octet_length(j.description_html), 0) + coalesce(octet_length(j.raw::text), 0)
        ), 0)
        from production.job j
        join production.source s on s.id = j.source_id
        where ${onlineSourceCondition}
          and ${payloadNeedsCompaction(sql`j.description_html`, sql`j.raw`)}
      ) as online_payload_bytes,
      (
        select count(*) from production.job_page p
        where p.parsed_at is not null and p.parsed_at <= ${pageBefore}
          and p.html is not null
      ) as parsed_pages,
      (
        select coalesce(sum(length(p.html)), 0) from production.job_page p
        where p.parsed_at is not null and p.parsed_at <= ${pageBefore}
          and p.html is not null
      ) as parsed_page_html_bytes,
      (
        select count(*) from production.job j
        where j.closed_at < ${closedBefore}
        and ${hasNoHumanInteraction(sql`j.id`, sql`j.source_id`, sql`j.posted_by_user_id`, sql`j.archived_at`)}
      ) as closed_jobs
  `);

  const [signups] = await db
    .select({ n: sql<number>`count(*)` })
    .from(authSignup)
    .where(expiredSignup(now));

  const [invites] = await db.select({ n: sql<number>`count(*)` }).from(recruiterInvite).where(deadInvite(now));

  const candidates: CleanupCandidates = {
    onlineJobs: Number(inventory?.online_jobs ?? 0),
    onlinePayloadBytes: Number(inventory?.online_payload_bytes ?? 0),
    parsedPages: Number(inventory?.parsed_pages ?? 0),
    parsedPageHtmlBytes: Number(inventory?.parsed_page_html_bytes ?? 0),
    closedJobs: Number(inventory?.closed_jobs ?? 0),
    reclaimableBytes:
      Number(inventory?.online_payload_bytes ?? 0) +
      Number(inventory?.parsed_page_html_bytes ?? 0),
    expiredSignups: Number(signups?.n ?? 0),
    deadInvites: Number(invites?.n ?? 0),
  };

  if (!options.apply) {
    return {
      policy: { closedJobDays, pageHtmlDays },
      candidates,
      applied: null,
    };
  }

  const applied = await db.transaction(async (tx) => {
    const onlineSourceIds = tx
      .select({ id: source.id })
      .from(source)
      .where(notInArray(source.kind, [...MANUAL_SOURCE_KINDS]));

    const compacted = await tx
      .update(job)
      .set({
        descriptionHtml: null,
        // Keep the one declared workplace signal needed by the durable board
        // filter while dropping the rest of the adapter response.
        raw: sql`case
          when coalesce(jsonb_typeof(${job.raw}::jsonb -> 'workplaceType') = 'string', false)
            then jsonb_build_object('workplaceType', ${job.raw}::jsonb -> 'workplaceType')::json
          else '{}'::json
        end`,
      })
      .where(
        and(
          sql`${job.sourceId} in ${onlineSourceIds}`,
          payloadNeedsCompaction(job.descriptionHtml, job.raw),
        ),
      )
      .returning({ id: job.id });

    const cleared = await tx
      .update(jobPage)
      .set({ html: null })
      .where(
        and(
          isNotNull(jobPage.html),
          isNotNull(jobPage.parsedAt),
          lte(jobPage.parsedAt, pageBefore),
        ),
      )
      .returning({ id: jobPage.jobId });

    const pruned = await deleteClosedJobsWithoutApplication(tx, closedBefore);

    const purged = await tx
      .delete(authSignup)
      .where(expiredSignup(now))
      .returning({ id: authSignup.id });

    const deadInvites = await tx
      .delete(recruiterInvite)
      .where(deadInvite(now))
      .returning({ id: recruiterInvite.id });

    const directoryQueries = await tx
      .delete(recruiterDirectoryQuery)
      .where(lt(recruiterDirectoryQuery.at, cutoff(now, DIRECTORY_QUERY_DAYS)))
      .returning({ id: recruiterDirectoryQuery.id });

    return {
      compactedJobs: compacted.length,
      clearedPages: cleared.length,
      prunedJobs: pruned.length,
      purgedSignups: purged.length,
      purgedInvites: deadInvites.length,
      purgedDirectoryQueries: directoryQueries.length,
    };
  });

  return {
    policy: { closedJobDays, pageHtmlDays },
    candidates,
    applied,
  };
}
