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
import { ADAPTERS } from "../../core/sources/registry.ts";
import type { FetchableSourceKind } from "../../core/sources/types.ts";
import { validatedPlatforms } from "./domain/capture.ts";
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
  sources: loadSources,
  termSource: ensureTermSource,
  attribute: recordAttribution,
};

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
