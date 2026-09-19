/**
 * Casos de uso da captura por termo. Orquestração burra: as regras moram em
 * `domain/`, o SQL em `infra/`, e as dependências chegam por parâmetro.
 *
 * Nenhuma função aqui recebe, grava ou devolve candidato: a captura é por
 * termo, e quem salvou o termo fica no contexto de matching (ADR-006).
 */
import { clock } from "../../../core/clock.ts";
import { IngestionBlockedError } from "../../../core/ingest/environment.ts";
import { guardIngestion } from "../../../core/ingest/guard.ts";
import { observeRawJobs } from "../../../core/ingest/observe.ts";
import type {
  FetchableSourceKind,
  SourceAdapter,
  SourceConfig,
  TermSearchResult,
} from "../../../core/sources/types.ts";
import {
  CAPTURE_LIMIT,
  capNewest,
  classifyCaptureFailure,
  isAttributable,
  validatedPlatforms,
} from "../domain/capture.ts";
import { summarizeHealth, type CaptureRecord, type PlatformHealth } from "../domain/health.ts";
import { nextWindowAt, windowStarts } from "../domain/windows.ts";
import type {
  CaptureOrigin,
  CaptureOutcome,
  CaptureStatus,
  CaptureWriter,
  ClaimedCapture,
  PlatformQuotaPort,
  TermCaptureQueuePort,
} from "../ports.ts";

export type CaptureDeps = {
  queue: TermCaptureQueuePort;
  quota: PlatformQuotaPort;
  adapters: readonly SourceAdapter[];
  /** The enabled entries of `config/sources.yaml`. */
  sources: () => Promise<SourceConfig[]>;
  termSource: (kind: FetchableSourceKind) => Promise<string>;
  attribute: (termKey: string, jobId: number, platform: FetchableSourceKind) => Promise<void>;
};

/* ------------------------------- Request -------------------------------- */

export type RequestResult = {
  enqueued: number;
  existing: number;
  skipped: "ingestion_blocked" | "no_platform" | null;
};

/**
 * Enfileira a captura do termo em cada plataforma alcançável, no dia UTC.
 *
 * Idempotente por (plataforma, termo, dia). Onde a ingestão não é permitida
 * nada é gravado e o termo fica com "capturas desligadas neste ambiente";
 * plataforma desligada no YAML ganha uma linha `skipped`, para a tela dizer por
 * que ela não trouxe nada.
 */
export async function requestCaptures(
  input: { termKey: string; query: string; origin: CaptureOrigin; now: Date },
  deps: Pick<CaptureDeps, "queue" | "adapters" | "sources">,
  writer?: CaptureWriter,
): Promise<RequestResult> {
  try {
    guardIngestion();
  } catch (error) {
    if (error instanceof IngestionBlockedError) return { enqueued: 0, existing: 0, skipped: "ingestion_blocked" };
    throw error;
  }
  const enabled = new Set((await deps.sources()).map((entry) => entry.kind));
  const validated = validatedPlatforms(deps.adapters);
  const row = {
    termKey: input.termKey,
    query: input.query,
    windowDay: windowStarts(input.now).day,
    origin: input.origin,
    // Quem está olhando a tela passa na frente da varredura.
    priority: input.origin === "web" ? 10 : 0,
  };
  const reachable = validated.filter((platform) => enabled.has(platform));
  const disabled = validated.filter((platform) => !enabled.has(platform));
  const queued = await deps.queue.enqueue(reachable.map((platform) => ({ ...row, platform })), writer);
  await deps.queue.enqueue(
    disabled.map((platform) => ({ ...row, platform, skipped: "platform_disabled" as const })),
    writer,
  );
  return {
    enqueued: queued.created,
    existing: queued.existing,
    skipped: reachable.length === 0 ? "no_platform" : null,
  };
}

/* --------------------------------- Run ---------------------------------- */

export type PlatformRunSummary = {
  claimed: number;
  succeeded: number;
  waiting: number;
  failed: number;
  created: number;
  known: number;
};

async function ingest(
  capture: ClaimedCapture,
  result: TermSearchResult,
  deps: Pick<CaptureDeps, "termSource" | "attribute">,
): Promise<CaptureOutcome> {
  const usable = result.jobs.filter((raw) => raw.title && raw.url);
  const { jobs } = capNewest(usable, CAPTURE_LIMIT);
  const sourceId = await deps.termSource(capture.platform);
  let created = 0;
  let known = 0;
  let attributed = 0;
  const observations = await observeRawJobs(jobs, sourceId, { keepExistingSource: true });
  for (const [index, observation] of observations.entries()) {
    if (observation.outcome === "inserted") created++;
    else known++;
    // Do anúncio, não da linha gravada: as tags só existem aqui, a observação
    // não as guarda.
    if (isAttributable(capture.query, jobs[index]!)) {
      await deps.attribute(capture.termKey, observation.jobId, capture.platform);
      attributed++;
    }
  }
  return {
    status: "succeeded",
    fetched: result.jobs.length,
    created,
    known,
    attributed,
    totalHint: Math.max(result.totalHint ?? 0, result.jobs.length),
  };
}

/** Uma captura reivindicada, do começo a um desfecho. Nunca lança. */
async function capture(
  claimed: ClaimedCapture,
  enabled: ReadonlySet<string>,
  deps: CaptureDeps,
): Promise<CaptureOutcome> {
  const search = deps.adapters.find((adapter) => adapter.kind === claimed.platform)?.termSearch;
  if (!search || search.validatedOn === null || !enabled.has(claimed.platform)) {
    return { status: "skipped", code: "platform_disabled" };
  }

  let retryAt: string | null = null;
  const reserve = async () => {
    const reservation = await deps.quota.reserve(claimed.platform, search.budget, new Date(clock().now()));
    if (!reservation.ok) retryAt = reservation.retryAt;
    return reservation.ok;
  };

  try {
    const result = await search.search(claimed.query, { limit: CAPTURE_LIMIT, reserve });
    if (result.stoppedByQuota && result.jobs.length === 0) {
      return { status: "waiting_quota", retryAt: retryAt ?? nextWindowAt("minute", windowStarts(new Date(clock().now())).minute) };
    }
    return await ingest(claimed, result, deps);
  } catch (error) {
    const failure = classifyCaptureFailure(error);
    if (failure.status === "failed") return failure;
    // 429: a plataforma disse que o dia acabou para todo mundo.
    const now = new Date(clock().now());
    await deps.quota.exhaustDay(claimed.platform, now);
    return { status: "waiting_quota", retryAt: nextWindowAt("day", windowStarts(now).day) };
  }
}

function tally(summary: Record<string, PlatformRunSummary>, platform: string, outcome: CaptureOutcome): void {
  const entry = (summary[platform] ??= { claimed: 0, succeeded: 0, waiting: 0, failed: 0, created: 0, known: 0 });
  entry.claimed++;
  if (outcome.status === "succeeded") {
    entry.succeeded++;
    entry.created += outcome.created;
    entry.known += outcome.known;
  }
  if (outcome.status === "waiting_quota") entry.waiting++;
  if (outcome.status === "failed") entry.failed++;
}

/** Menor espera entre duas tentativas: evita girar sobre uma linha travada por outro trabalhador. */
const MIN_WAIT_MS = 1_000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Drena a fila até esvaziar, até `max` capturas, ou até o orçamento de tempo.
 *
 * O `after()` de uma Server Action morre em 30 segundos. Antes de reivindicar a
 * próxima, supõe que ela demora tanto quanto a mais lenta até aqui: começar uma
 * captura que não cabe deixaria a linha `running` até o lease vencer.
 *
 * Com `waitMs`, a fila vazia não encerra enquanto houver linha de hoje
 * esperando uma janela de cota que abre dentro desse prazo. RemoteOK e
 * Himalayas aceitam uma chamada por minuto: sair na primeira fila vazia deixava
 * todo termo depois do primeiro sem rodar no dia, e os mesmos termos perdiam
 * todo dia.
 */
export async function runCaptures(
  opts: { budgetMs?: number; worker: string; max?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> },
  deps: CaptureDeps,
): Promise<Record<string, PlatformRunSummary>> {
  guardIngestion();
  const started = clock().now();
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  const enabled = new Set((await deps.sources()).map((entry) => entry.kind));
  const summary: Record<string, PlatformRunSummary> = {};
  let slowest = 0;
  let processed = 0;

  while (processed < max) {
    const elapsed = clock().now() - started;
    if (opts.budgetMs !== undefined && processed > 0 && elapsed + slowest > opts.budgetMs) break;
    const claimed = await deps.queue.claim(opts.worker, new Date(clock().now()));
    if (!claimed) {
      if (opts.waitMs === undefined) break;
      const next = await deps.queue.nextRunAfter(new Date(clock().now()));
      if (next === null) break;
      const wait = Math.max(MIN_WAIT_MS, Date.parse(next) - clock().now());
      if (clock().now() + wait - started > opts.waitMs) break;
      await (opts.sleep ?? realSleep)(wait);
      continue;
    }
    const begin = clock().now();
    const outcome = await capture(claimed, enabled, deps);
    await deps.queue.finish(claimed.id, opts.worker, outcome, new Date(clock().now()));
    slowest = Math.max(slowest, clock().now() - begin);
    processed++;
    tally(summary, claimed.platform, outcome);
  }
  return summary;
}

/* -------------------------------- Status -------------------------------- */

export type PlatformCaptureState = {
  platform: FetchableSourceKind;
  status: CaptureStatus;
  reasonCode: string | null;
  /** Next quota window, while `waiting_quota`. */
  retryAt: string | null;
  windowDay: string;
  /** The state is today's run, not an older one. */
  today: boolean;
  /** Done today by an earlier request and served again without a new call. */
  reused: boolean;
  fetched: number;
  created: number;
  known: number;
  attributed: number;
  totalHint: number | null;
  finishedAt: string | null;
};

export async function captureStatus(
  termKeys: readonly string[],
  now: Date,
  read: (
    keys: readonly string[],
  ) => Promise<Array<Omit<PlatformCaptureState, "today" | "reused"> & { termKey: string; updatedAt: string }>>,
): Promise<Map<string, PlatformCaptureState[]>> {
  const today = windowStarts(now).day;
  const states = new Map<string, PlatformCaptureState[]>(termKeys.map((key) => [key, []]));
  for (const { termKey, updatedAt, ...state } of await read(termKeys)) {
    const reused = state.status === "succeeded" && state.finishedAt !== null && updatedAt > state.finishedAt;
    states.get(termKey)?.push({ ...state, today: state.windowDay === today, reused });
  }
  return states;
}

/** Quantos dias de histórico a saúde olha para contar falhas seguidas. */
const HEALTH_HISTORY_DAYS = 30;

export async function captureHealthReport(
  now: Date,
  deps: Pick<CaptureDeps, "adapters" | "sources"> & {
    records: (platform: FetchableSourceKind, sinceDay: string) => Promise<CaptureRecord[]>;
    usage: (platform: FetchableSourceKind, now: Date) => Promise<{ dayUsed: number; minuteUsed: number; exhausted: boolean }>;
  },
): Promise<PlatformHealth[]> {
  const enabled = new Set((await deps.sources()).map((entry) => entry.kind));
  const sinceDay = windowStarts(new Date(now.getTime() - HEALTH_HISTORY_DAYS * 86_400_000)).day;
  const report: PlatformHealth[] = [];
  for (const adapter of deps.adapters) {
    if (!adapter.termSearch) continue;
    report.push(
      summarizeHealth({
        platform: adapter.kind,
        validated: adapter.termSearch.validatedOn !== null,
        enabled: enabled.has(adapter.kind),
        budget: adapter.termSearch.budget,
        quota: await deps.usage(adapter.kind, now),
        records: await deps.records(adapter.kind, sinceDay),
        now,
      }),
    );
  }
  return report;
}
