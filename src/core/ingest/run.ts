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
import { catalogId, planCatalogImport } from "../../contexts/sourcing/domain/catalog.ts";
import { nextRevision, platformQuota, syncableSources } from "../../contexts/sourcing/index.ts";
import { clock } from "../clock.ts";
import { getDb } from "../db/client.ts";
import { deleteClosedJobsWithoutApplication } from "../db/retention.ts";
import { job, source } from "../db/schema.ts";
import { HttpError } from "../sources/http.ts";
import { getAdapter, sourceId } from "../sources/registry.ts";
import type { CatalogEntry, Completeness, SourceAdapter, SourceConfig, SourceSnapshot } from "../sources/types.ts";
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

/**
 * Leva o YAML ao banco em dois regimes, decididos por linha (`managed_at`).
 *
 * Linha NÃO gerida espelha o arquivo — rótulo, motivo e também `enabled:
 * false`. Linha gerida (importada ou editada pelo admin) nunca é sobrescrita:
 * o arquivo só insere o que falta, e uma edição feita na tela sobrevive ao
 * sync seguinte. Banco vazio continua nascendo do YAML, como antes.
 *
 * `wholeFile` diz que `configs` é o arquivo inteiro, e só então uma linha não
 * gerida ausente dele é desabilitada. `syncSource` passa uma fonte só, e
 * tratar isso como o arquivo desligaria todas as outras.
 *
 * `insertOnly` é para quem recebe as fontes do BANCO (`syncSource`, `syncAll`
 * depois de `catalogForSync`): elas não são o arquivo, então só garantem que a
 * linha existe. Espelhar ali deixaria uma seleção velha religar uma linha que o
 * arquivo acabou de desligar.
 */
export async function ensureSources(
  configs: readonly (SourceConfig & { enabled?: boolean })[],
  opts: { wholeFile?: boolean; insertOnly?: boolean } = {},
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      id: source.id,
      kind: source.kind,
      handle: source.handle,
      label: source.label,
      rationale: source.rationale,
      enabled: source.enabled,
      retiredAt: source.retiredAt,
      managedAt: source.managedAt,
    })
    .from(source);
  const plan = planCatalogImport(configs, rows);

  for (const entry of plan.inserts) {
    // Outro processo pode ter inserido entre a leitura e aqui; a linha dele vale.
    await db
      .insert(source)
      .values({
        id: catalogId(entry.kind, entry.handle),
        kind: entry.kind,
        handle: entry.handle,
        label: entry.label,
        rationale: entry.rationale ?? null,
        enabled: entry.enabled ?? true,
        origin: "yaml",
      })
      .onConflictDoNothing({ target: source.id });
  }
  for (const entry of opts.insertOnly ? [] : plan.mirrors) {
    await db
      .update(source)
      .set({
        label: entry.label,
        rationale: entry.rationale ?? null,
        enabled: entry.enabled ?? true,
        configRevision: nextRevision(),
      })
      // A leitura acima pode estar velha: a condição de regime vai no próprio
      // UPDATE, para uma linha que virou gerida no meio não ser regravada.
      .where(and(eq(source.id, catalogId(entry.kind, entry.handle)), isNull(source.managedAt)));
  }
  if (opts.wholeFile && plan.orphans.length > 0) {
    await db
      .update(source)
      .set({ enabled: false, configRevision: nextRevision() })
      .where(and(inArray(source.id, plan.orphans), isNull(source.managedAt), eq(source.enabled, true)));
  }
}

/**
 * As fontes que o sync varre, do BANCO: o YAML entra primeiro pelo regime de
 * `ensureSources` (arquivo inteiro, então órfã não gerida é desabilitada) e a
 * seleção sai de `syncableSources()`. Uma fonte desligada na tela fica
 * desligada mesmo presente no arquivo.
 */
export async function catalogForSync(yaml: readonly CatalogEntry[]): Promise<SourceConfig[]> {
  // Antes de qualquer escrita, como em `syncAll`.
  guardIngestion();
  await ensureSources(yaml, { wholeFile: true });
  return syncableSources();
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
  await ensureSources([config], { insertOnly: true });
  return syncOne(config, new Map());
}

/**
 * Sincroniza uma fonte do retrato de uma execução (`source_run`, #223).
 *
 * Mesmo `syncOne` do sync inteiro, com o mapa de empresas compartilhado entre
 * as filhas de uma execução "todas". A fonte já está no catálogo — o retrato
 * saiu dele —, então nada aqui espelha o arquivo.
 */
export async function syncConfigured(config: SourceConfig, companies: Map<string, number>): Promise<SyncSourceResult> {
  guardIngestion();
  return syncOne(config, companies);
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
  await ensureSources(configs, { insertOnly: true });

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
