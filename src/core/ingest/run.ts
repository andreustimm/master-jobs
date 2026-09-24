/**
 * The sync pipeline.
 *
 * Invariants an agent must not break:
 *  1. Sync never writes to `application` — user decisions survive every re-run.
 *  2. A source that fails is recorded and skipped; it never aborts the run.
 *  3. Postings that vanish from a source are marked closed, not deleted, so the
 *     history of what you applied to stays intact — and only when the source
 *     listed everything it has (`decideAbsenceClosure`). A partial window
 *     closes nothing by absence.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { platformQuota } from "../../contexts/sourcing/index.ts";
import { clock } from "../clock.ts";
import { getDb } from "../db/client.ts";
import { deleteClosedJobsWithoutApplication } from "../db/retention.ts";
import { job, source } from "../db/schema.ts";
import { HttpError } from "../sources/http.ts";
import { getAdapter, sourceId } from "../sources/registry.ts";
import type { Completeness, SourceAdapter, SourceConfig, SourceSnapshot } from "../sources/types.ts";
import { guardIngestion } from "./guard.ts";
import { decideAbsenceClosure } from "./lifecycle.ts";
import { observeRawJobs } from "./observe.ts";
import { drizzleRequestBudget } from "./request-budget-store.ts";

export type SyncSourceResult = {
  sourceId: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  unchanged: number;
  changed: number;
  /** Compatibility count: every observation whose scoring content changed. */
  updated: number;
  reopened: number;
  closed: number;
  /** Scores invalidated because the posting's content changed. */
  rescored: number;
  /** What the listing proved; `null` when the fetch failed. */
  completeness: Completeness | null;
  warnings: string[];
  error?: string;
  durationMs: number;
};

export type SyncResult = {
  startedAt: string;
  finishedAt: string;
  sources: SyncSourceResult[];
  totals: {
    fetched: number;
    inserted: number;
    unchanged: number;
    changed: number;
    updated: number;
    reopened: number;
    closed: number;
    rescored: number;
    failed: number;
  };
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

/**
 * Fetch one source, spending the platform's shared budget first (ADR-010).
 *
 * A budgeted platform counts every call the system makes, sync included — a
 * term capture and the sync hitting Remotive on the same day draw from the
 * same four calls. With the window full the source is recorded as `quota` and
 * nothing goes out; a 429 closes the platform's day for everyone.
 */
async function fetchWithinBudget(adapter: SourceAdapter, config: SourceConfig): Promise<SourceSnapshot> {
  const budget = adapter.termSearch?.budget;
  if (budget) {
    const reservation = await platformQuota.reserve(config.kind, budget, new Date(clock().now()));
    if (!reservation.ok) throw new Error("quota");
  }
  // A busca que vai sair entra no contador diário da rotina (#291). O sync não
  // tem teto próprio — o intervalo por fonte da varredura e a cota por
  // plataforma já limitam —, então isto é telemetria: buscas por dia, somando
  // CLI e Vercel.
  if (!(await drizzleRequestBudget().take("sync", clock().now()))) throw new Error("orçamento");
  try {
    return await adapter.fetchJobs(config);
  } catch (error) {
    if (budget && error instanceof HttpError && error.status === 429) {
      await platformQuota.exhaustDay(config.kind, new Date(clock().now()));
    }
    throw error;
  }
}

async function syncOne(config: SourceConfig, companies: Map<string, number>): Promise<SyncSourceResult> {
  const db = getDb();
  const id = sourceId(config.kind, config.handle);
  const started = Date.now();
  const result: SyncSourceResult = {
    sourceId: id,
    ok: false,
    fetched: 0,
    inserted: 0,
    unchanged: 0,
    changed: 0,
    updated: 0,
    reopened: 0,
    closed: 0,
    rescored: 0,
    completeness: null,
    warnings: [],
    durationMs: 0,
  };

  try {
    const adapter = getAdapter(config.kind);
    const { jobs: rawJobs, warnings, completeness } = await fetchWithinBudget(adapter, config);
    result.fetched = rawJobs.length;
    result.warnings = warnings;
    result.completeness = completeness;

    // By row, not by fingerprint: a posting found by its external id may keep
    // an older fingerprint (#291), and it is still the row the listing carries.
    const seenIds = new Set<number>();
    const stamp = new Date().toISOString();

    const usable = rawJobs.filter((raw) => raw.title && raw.url);
    for (const observation of await observeRawJobs(usable, id, { observedAt: stamp, companies })) {
      seenIds.add(observation.jobId);
      if (observation.outcome === "inserted") result.inserted++;
      if (observation.outcome === "unchanged") result.unchanged++;
      if (observation.outcome === "changed") result.changed++;
      if (observation.contentChanged) result.updated++;
      if (observation.outcome === "reopened") result.reopened++;
      result.rescored += observation.invalidatedScores;
    }

    // Anything a complete listing no longer carries is closed. A partial
    // window leaves the rest to the 404/410 recheck.
    if (decideAbsenceClosure({ completeness, seen: seenIds.size }).kind === "close-missing") {
      const stale = await db
        .select({ id: job.id })
        .from(job)
        .where(and(eq(job.sourceId, id), isNull(job.closedAt)));
      const toClose = stale.filter((s) => !seenIds.has(s.id)).map((s) => s.id);
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

/**
 * Sincroniza UMA fonte — a unidade da varredura fatiada (ADR 0025).
 *
 * Mesmo caminho de `syncAll`, sem o laço: a mesma guarda, o mesmo registro da
 * fonte e o mesmo `syncOne`, que nunca lança e grava o erro em
 * `source.lastError`. Fatiar não pode virar uma segunda implementação do sync.
 */
export async function syncSource(config: SourceConfig): Promise<SyncSourceResult> {
  guardIngestion();
  await ensureSources([config]);
  return syncOne(config, new Map());
}

/** Run every enabled source with bounded concurrency. */
export async function syncAll(
  configs: SourceConfig[],
  opts: { concurrency?: number; onProgress?: (r: SyncSourceResult) => void } = {},
): Promise<SyncResult> {
  // Antes de `ensureSources`, que já escreve, e muito antes do primeiro
  // adapter: o que se protege aqui é a conexão com o board de terceiro, não o
  // registro dela.
  guardIngestion();

  const startedAt = new Date().toISOString();
  await ensureSources(configs);

  const concurrency = opts.concurrency ?? 4;
  const queue = [...configs];
  const results: SyncSourceResult[] = [];
  const companies = new Map<string, number>();

  async function worker(): Promise<void> {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const r = await syncOne(next, companies);
      results.push(r);
      opts.onProgress?.(r);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, configs.length) }, worker));

  const totals = results.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.fetched,
      inserted: acc.inserted + r.inserted,
      unchanged: acc.unchanged + r.unchanged,
      changed: acc.changed + r.changed,
      updated: acc.updated + r.updated,
      reopened: acc.reopened + r.reopened,
      closed: acc.closed + r.closed,
      rescored: acc.rescored + r.rescored,
      failed: acc.failed + (r.ok ? 0 : 1),
    }),
    {
      fetched: 0,
      inserted: 0,
      unchanged: 0,
      changed: 0,
      updated: 0,
      reopened: 0,
      closed: 0,
      rescored: 0,
      failed: 0,
    },
  );

  return { startedAt, finishedAt: new Date().toISOString(), sources: results, totals };
}

/**
 * Housekeeping: forget postings closed long ago that were never applied to.
 *
 * Delegates to the single authorized delete path, which locks before it
 * re-checks — a concurrent application must never be cascaded away.
 */
export async function pruneClosed(olderThanDays = 90): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const deleted = await db.transaction((tx) => deleteClosedJobsWithoutApplication(tx, cutoff));
  return deleted.length;
}
