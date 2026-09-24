/**
 * O contexto de captura por termo, composto.
 *
 * Quem chama recebe funções e nunca vê porta. A composição é por função — sem
 * container, que seria ilegal sob a regra da sintaxe apagável (ADR 0006).
 *
 * Matching chama esta API (`requestTermCaptures`, `attributedJobIds`,
 * `captureStatusFor`); este contexto nunca lê tabela de matching.
 */
import { IngestionBlockedError } from "../../core/ingest/environment.ts";
import { guardIngestion } from "../../core/ingest/guard.ts";
import { loadSources } from "../../core/sources/config.ts";
import { ADAPTERS, getAdapter, parseFetchableSourceKind } from "../../core/sources/registry.ts";
import type { FetchableSourceKind } from "../../core/sources/types.ts";
import { probeSource, registerSource, type ProbeReport } from "./app/catalog.ts";
import { validatedPlatforms } from "./domain/capture.ts";
import {
  capabilitiesOf,
  planCatalogImport,
  validateCatalogPatch,
  type Capabilities,
  type CatalogError,
  type CatalogPlan,
  type CatalogWrite,
} from "./domain/catalog.ts";
import {
  allCatalogRows,
  applyCatalogImport,
  insertCatalogSource,
  patchCatalogSource,
  retireCatalogSource,
} from "./infra/drizzle-catalog.ts";
import {
  captureHealthReport,
  captureStatus,
  requestCaptures,
  runCaptures,
  type CaptureDeps,
  type PlatformCaptureState,
  type PlatformRunSummary,
  type RequestResult,
} from "./app/captures.ts";
import type { PlatformHealth } from "./domain/health.ts";
import {
  captureRecords,
  drizzleCaptureQueue,
  ensureTermSource,
  latestCaptures,
  recordAttribution,
  requeueFailed,
} from "./infra/drizzle-captures.ts";
import { drizzleQuota, quotaUsage } from "./infra/drizzle-quota.ts";
import type { CaptureOrigin, CaptureWriter } from "./ports.ts";

export {
  CAPTURE_LIMIT,
  capNewest,
  classifyCaptureFailure,
  isAttributable,
  reachablePlatforms,
  termSource,
  validatedPlatforms,
  type CaptureFailure,
  type FailureCode,
} from "./domain/capture.ts";
export { dailyRepeatPaused, nextWindowAt, windowStarts, type WindowKind } from "./domain/windows.ts";
export type { PlatformHealth } from "./domain/health.ts";
/** Subconsulta dos ids das vagas que o termo trouxe (filtro "trazida por"). */
export {
  attributedJobIds,
  captureHistory,
  lastSweepCaptureAt,
  type CaptureDay,
} from "./infra/drizzle-captures.ts";
export type { CaptureDeps, PlatformCaptureState, PlatformRunSummary, RequestResult } from "./app/captures.ts";
export type {
  CaptureOrigin,
  CaptureOutcome,
  CaptureStatus,
  CaptureWriter,
  ClaimedCapture,
  PlatformQuotaPort,
  TermCaptureQueuePort,
} from "./ports.ts";

const deps: CaptureDeps = {
  queue: drizzleCaptureQueue,
  quota: drizzleQuota,
  adapters: Object.values(ADAPTERS),
  // O carregador devolve também as desabilitadas; plataforma ligada é a que
  // tem ao menos uma entrada habilitada, como antes.
  sources: async () => (await loadSources()).filter((entry) => entry.enabled),
  termSource: ensureTermSource,
  attribute: recordAttribution,
};

/* --------------------------------- catálogo --------------------------------- */

export {
  CATALOG_LIMITS,
  capabilitiesOf,
  classifySourceProbe,
  isSyncEligible,
  planCatalogImport,
  validateCatalogWrite,
  validateSecretRef,
  type Capabilities,
  type CatalogError,
  type CatalogPlan,
  type CatalogWrite,
  type DriftItem,
  type SourceProbeOutcome,
} from "./domain/catalog.ts";
export { catalogSource, catalogSources, nextRevision, syncableSources, type CatalogSource } from "./infra/drizzle-catalog.ts";
export type { ProbeReport } from "./app/catalog.ts";

/** O que o kind sabe fazer, pelo que o adapter registrado declara. */
export function capabilitiesFor(kind: string): Capabilities {
  return capabilitiesOf(kind, Object.values(ADAPTERS));
}

/**
 * O plano YAML × banco. Sem `apply`, só descreve — é o `jho sources diff` e a
 * simulação do `import`. Com `apply`, grava o estado do arquivo e passa toda
 * linha do catálogo para o regime gerido.
 */
export async function importCatalog(opts: { apply: boolean; now: string }): Promise<CatalogPlan> {
  const plan = planCatalogImport(await loadSources(), await allCatalogRows());
  if (opts.apply) await applyCatalogImport(plan, opts.now);
  return plan;
}

export function registerCatalogSource(input: CatalogWrite, now: string): ReturnType<typeof registerSource> {
  return registerSource(input, {
    existing: async () => (await allCatalogRows()).map(({ kind, handle }) => ({ kind, handle })),
    insert: insertCatalogSource,
    now: () => now,
  });
}

export type CatalogEditResult = { ok: true } | { ok: false; code: CatalogError | "not_found_or_retired" };

/** Editar, habilitar ou desabilitar. Fonte aposentada ou fora do catálogo não muda. */
export async function editCatalogSource(
  id: string,
  patch: { label?: string; enabled?: boolean; secretRef?: string | null },
  now: string,
): Promise<CatalogEditResult> {
  const valid = validateCatalogPatch(patch);
  if (!valid.ok) return valid;
  return (await patchCatalogSource(id, valid.value, now)) ? { ok: true } : { ok: false, code: "not_found_or_retired" };
}

export async function retireSource(id: string, now: string): Promise<CatalogEditResult> {
  return (await retireCatalogSource(id, now)) ? { ok: true } : { ok: false, code: "not_found_or_retired" };
}

/**
 * Sonda um handle pelo adapter do kind, sem gravar vaga, saúde nem cota. A
 * guarda de ingestão vem antes: sondar é tocar o board de terceiro.
 */
export async function probeCatalogSource(kind: string, handle: string): Promise<ProbeReport> {
  guardIngestion();
  const fetchable = parseFetchableSourceKind(kind);
  return probeSource(() => getAdapter(fetchable).fetchJobs({ kind: fetchable, handle, label: handle }));
}

/** As plataformas cuja busca por termo passou pelo probe, em ordem estável. */
export function termSearchPlatforms(): FetchableSourceKind[] {
  return validatedPlatforms(deps.adapters).sort();
}

/** O livro de cota compartilhado: a sincronização regular também reserva aqui. */
export const platformQuota = drizzleQuota;

/**
 * Enfileira as capturas do termo para hoje. `writer` é a transação de quem
 * chama, quando o pedido precisa entrar junto com outra escrita.
 */
export function requestTermCaptures(
  input: { termKey: string; query: string; origin: CaptureOrigin; now: Date },
  writer?: CaptureWriter,
): Promise<RequestResult> {
  return requestCaptures(input, deps, writer);
}

/**
 * A guarda de ingestão respondida sem lançar: onde ela nega, o termo é salvo e
 * fica com "capturas desligadas neste ambiente", sem chamada de rede.
 */
export function capturesAllowed(): boolean {
  try {
    guardIngestion();
    return true;
  } catch (error) {
    if (error instanceof IngestionBlockedError) return false;
    throw error;
  }
}

/** Recoloca na fila as capturas falhas de hoje do termo; devolve quantas. */
export function retryFailedCaptures(termKey: string, now: Date): Promise<number> {
  return requeueFailed(termKey, now);
}

export function runTermCaptures(opts: {
  budgetMs?: number;
  worker: string;
  max?: number;
  /** Keep waiting for today's quota windows up to this long (the daily sweep). */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<Record<string, PlatformRunSummary>> {
  return runCaptures(opts, deps);
}

export function captureStatusFor(
  termKeys: readonly string[],
  now: Date,
): Promise<Map<string, PlatformCaptureState[]>> {
  return captureStatus(termKeys, now, async (keys) =>
    (await latestCaptures(keys)).map(({ runAfter, ...row }) => ({
      ...row,
      retryAt: row.status === "waiting_quota" ? runAfter : null,
    })),
  );
}

export function captureHealth(now: Date): Promise<PlatformHealth[]> {
  return captureHealthReport(now, {
    adapters: deps.adapters,
    sources: deps.sources,
    records: captureRecords,
    usage: quotaUsage,
  });
}
