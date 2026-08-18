/**
 * The sync pipeline.
 *
 * Invariants an agent must not break:
 *  1. Sync never writes to `application` — user decisions survive every re-run.
 *  2. A source that fails is recorded and skipped; it never aborts the run.
 *  3. Postings that vanish from a source are marked closed, not deleted, so the
 *     history of what you applied to stays intact.
 */
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { company, job, source } from "../db/schema.ts";
import { getAdapter, sourceId } from "../sources/registry.ts";
import type { SourceConfig } from "../sources/types.ts";
import { contentHash, fingerprint, slugifyCompany, toIsoDate } from "./normalize.ts";

export type SyncSourceResult = {
  sourceId: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  closed: number;
  warnings: string[];
  error?: string;
  durationMs: number;
};

export type SyncResult = {
  startedAt: string;
  finishedAt: string;
  sources: SyncSourceResult[];
  totals: { fetched: number; inserted: number; updated: number; closed: number; failed: number };
};

/** Upsert the configured sources so the YAML config is the source of truth. */
export async function ensureSources(configs: SourceConfig[]): Promise<void> {
  const db = getDb();
  for (const config of configs) {
    const id = sourceId(config.kind, config.handle);
    await db
      .insert(source)
      .values({
        id,
        kind: config.kind,
        handle: config.handle,
        label: config.label,
        rationale: config.rationale ?? null,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: source.id,
        set: { label: config.label, rationale: config.rationale ?? null, enabled: true },
      });
  }
}

async function upsertCompany(name: string): Promise<number | null> {
  const db = getDb();
  const slug = slugifyCompany(name);
  if (!slug) return null;
  await db
    .insert(company)
    .values({ slug, name })
    .onConflictDoNothing({ target: company.slug });
  const found = await db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.slug, slug))
    .limit(1);
  return found[0]?.id ?? null;
}

async function syncOne(config: SourceConfig): Promise<SyncSourceResult> {
  const db = getDb();
  const id = sourceId(config.kind, config.handle);
  const started = Date.now();
  const result: SyncSourceResult = {
    sourceId: id,
    ok: false,
    fetched: 0,
    inserted: 0,
    updated: 0,
    closed: 0,
    warnings: [],
    durationMs: 0,
  };

  try {
    const adapter = getAdapter(config.kind);
    const { jobs: rawJobs, warnings } = await adapter.fetchJobs(config);
    result.fetched = rawJobs.length;
    result.warnings = warnings;

    const seenFingerprints: string[] = [];
    const stamp = new Date().toISOString();

    for (const raw of rawJobs) {
      if (!raw.title || !raw.url) continue;
      const fp = fingerprint(raw);
      const ch = contentHash(raw);
      seenFingerprints.push(fp);

      const existing = await db
        .select({ id: job.id, contentHash: job.contentHash })
        .from(job)
        .where(eq(job.fingerprint, fp))
        .limit(1);

      const companyId = await upsertCompany(raw.companyName);
      const values = {
        fingerprint: fp,
        contentHash: ch,
        sourceId: id,
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
        applyUrl: raw.applyUrl ?? null,
        postedAt: toIsoDate(raw.postedAt),
        lastSeenAt: stamp,
        raw: raw.raw,
      };

      const found = existing[0];
      if (!found) {
        await db.insert(job).values({ ...values, firstSeenAt: stamp });
        result.inserted++;
      } else {
        // Reopen anything that came back, and refresh only when content moved.
        await db
          .update(job)
          .set(found.contentHash === ch ? { lastSeenAt: stamp, closedAt: null } : { ...values, closedAt: null })
          .where(eq(job.id, found.id));
        if (found.contentHash !== ch) result.updated++;
      }
    }

    // Anything this source used to carry but no longer lists is closed.
    if (seenFingerprints.length > 0) {
      const stale = await db
        .select({ id: job.id, fingerprint: job.fingerprint })
        .from(job)
        .where(and(eq(job.sourceId, id), isNull(job.closedAt)));
      const seen = new Set(seenFingerprints);
      const toClose = stale.filter((s) => !seen.has(s.fingerprint)).map((s) => s.id);
      if (toClose.length > 0) {
        await db.update(job).set({ closedAt: stamp }).where(inArray(job.id, toClose));
        result.closed = toClose.length;
      }
    }

    await db
      .update(source)
      .set({
        lastSyncedAt: stamp,
        lastStatus: "ok",
        lastError: null,
        lastJobCount: result.fetched,
      })
      .where(eq(source.id, id));

    result.ok = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    await db
      .update(source)
      .set({
        lastSyncedAt: new Date().toISOString(),
        lastStatus: "error",
        lastError: result.error,
      })
      .where(eq(source.id, id));
  }

  result.durationMs = Date.now() - started;
  return result;
}

/** Run every enabled source with bounded concurrency. */
export async function syncAll(
  configs: SourceConfig[],
  opts: { concurrency?: number; onProgress?: (r: SyncSourceResult) => void } = {},
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  await ensureSources(configs);

  const concurrency = opts.concurrency ?? 4;
  const queue = [...configs];
  const results: SyncSourceResult[] = [];

  async function worker(): Promise<void> {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const r = await syncOne(next);
      results.push(r);
      opts.onProgress?.(r);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, configs.length) }, worker));

  const totals = results.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.fetched,
      inserted: acc.inserted + r.inserted,
      updated: acc.updated + r.updated,
      closed: acc.closed + r.closed,
      failed: acc.failed + (r.ok ? 0 : 1),
    }),
    { fetched: 0, inserted: 0, updated: 0, closed: 0, failed: 0 },
  );

  return { startedAt, finishedAt: new Date().toISOString(), sources: results, totals };
}

/** Housekeeping: forget postings closed long ago that were never applied to. */
export async function pruneClosed(olderThanDays = 90): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const deleted = await db
    .delete(job)
    .where(
      and(
        lt(job.closedAt, cutoff),
        sql`${job.id} not in (select job_id from application)`,
      ),
    )
    .returning({ id: job.id });
  return deleted.length;
}
