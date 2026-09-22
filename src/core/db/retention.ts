/**
 * Database retention for data that can be reconstructed.
 *
 * The useful job description is `job.description_text`. Adapter HTML, the
 * original API payload and successfully parsed page HTML are temporary input,
 * not product state. Keeping all three copies made the corpus hundreds of MB.
 *
 * User-owned application history is outside this routine. A closed job is only
 * removed when no application references it, preserving the repository's
 * irreversible-data invariant.
 */
import {
  and,
  isNotNull,
  lt,
  lte,
  notInArray,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { getDb, type DB } from "./client.ts";
import { application, job, jobPage, source } from "./schema.ts";
import { MANUAL_SOURCE_KINDS } from "../sources/types.ts";

const DAY_MS = 86_400_000;
export const DEFAULT_CLOSED_JOB_DAYS = 90;
export const DEFAULT_PAGE_HTML_DAYS = 0;

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
};

export type DatabaseCleanupResult = {
  policy: { closedJobDays: number; pageHtmlDays: number };
  candidates: CleanupCandidates;
  applied: null | {
    compactedJobs: number;
    clearedPages: number;
    prunedJobs: number;
  };
};

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
 * The only authorized way to delete a job: closed before `closedBefore` and
 * without any application. Must run inside a transaction.
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
    sql`not exists (select 1 from ${application} a where a.job_id = ${job.id})`,
  );
  const locked = await tx
    .select({ id: job.id })
    .from(job)
    .where(eligible)
    .orderBy(job.id)
    .for("update");
  if (locked.length === 0) return [];
  return tx
    .delete(job)
    // One array parameter, not one parameter per id: a large prune would
    // otherwise hit the protocol's 65 535-parameter ceiling.
    .where(and(sql`${job.id} = any(${`{${locked.map((row) => row.id).join(",")}}`}::int[])`, eligible))
    .returning({ id: job.id });
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
        and not exists (select 1 from production.application a where a.job_id = j.id)
      ) as closed_jobs
  `);

  const candidates: CleanupCandidates = {
    onlineJobs: Number(inventory?.online_jobs ?? 0),
    onlinePayloadBytes: Number(inventory?.online_payload_bytes ?? 0),
    parsedPages: Number(inventory?.parsed_pages ?? 0),
    parsedPageHtmlBytes: Number(inventory?.parsed_page_html_bytes ?? 0),
    closedJobs: Number(inventory?.closed_jobs ?? 0),
    reclaimableBytes:
      Number(inventory?.online_payload_bytes ?? 0) +
      Number(inventory?.parsed_page_html_bytes ?? 0),
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

    return {
      compactedJobs: compacted.length,
      clearedPages: cleared.length,
      prunedJobs: pruned.length,
    };
  });

  return {
    policy: { closedJobDays, pageHtmlDays },
    candidates,
    applied,
  };
}
