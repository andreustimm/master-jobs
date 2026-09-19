/**
 * O contexto de captura por termo, composto.
 *
 * Quem chama recebe funções e nunca vê porta. A composição é por função — sem
 * container, que seria ilegal sob a regra da sintaxe apagável (ADR 0006).
 *
 * Matching chama esta API (`requestTermCaptures`, `attributedJobIds`,
 * `captureStatusFor`); este contexto nunca lê tabela de matching.
 */
import { loadSources } from "../../core/sources/config.ts";
import { ADAPTERS } from "../../core/sources/registry.ts";
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
} from "./infra/drizzle-captures.ts";
import { drizzleQuota, quotaUsage } from "./infra/drizzle-quota.ts";
import type { CaptureOrigin } from "./ports.ts";

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
export { attributedJobIds } from "./infra/drizzle-captures.ts";
export type { CaptureDeps, PlatformCaptureState, PlatformRunSummary, RequestResult } from "./app/captures.ts";
export type {
  CaptureOrigin,
  CaptureOutcome,
  CaptureStatus,
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

/** O livro de cota compartilhado: a sincronização regular também reserva aqui. */
export const platformQuota = drizzleQuota;

export function requestTermCaptures(input: {
  termKey: string;
  query: string;
  origin: CaptureOrigin;
  now: Date;
}): Promise<RequestResult> {
  return requestCaptures(input, deps);
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
