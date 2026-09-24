/**
 * Contexto de operações: pedir manutenção sem esperar por ela.
 *
 * A pergunta que ele responde é do administrador: "buscar vagas novas agora,
 * conferir se expiraram, repontuar". O trabalho leva minutos e não cabe numa
 * função de 30 segundos, então a tela **pede** e quem executa é outro processo.
 *
 * Composição por função, sem container (regra 4).
 */
import { requestRoutine as requestRoutineUseCase, type RequestRoutineResult } from "./app/request-routine.ts";
import { githubDispatch } from "./infra/github-dispatch.ts";
import { randomUUID } from "node:crypto";
import { clock } from "../../core/clock.ts";
import { guardIngestion } from "../../core/ingest/guard.ts";
import { catalogForSync, syncConfigured, syncSource, type SyncSourceResult } from "../../core/ingest/run.ts";
import { verifyJobs, type VerifyResult } from "../../core/ingest/verify.ts";
import { enqueueStale, runVerifyQueue, verifyStats } from "../../core/ingest/verify-queue.ts";
import {
  capabilitiesFor,
  catalogSource,
  catalogSources,
  isSyncEligible,
  requestTermCaptures,
  runTermCaptures,
  type CatalogSource,
} from "../sourcing/index.ts";
import {
  executeRun,
  interruptStaleRuns,
  requestRun,
  retryRun,
  type CatalogReader,
  type CatalogSourceView,
  type ExecuteResult,
  type RequestDeps,
  type RequestResult,
  type RunStore,
  type SourceSnapshotEntry,
  type WorkOutcome,
} from "./app/source-runs.ts";
import { UNKNOWN_COUNTS, type RunScope } from "./domain/runs.ts";
import {
  childRuns,
  createOrJoinRun,
  getRun,
  heartbeatRun,
  listRuns,
  noteRun,
  orphanedQueuedChildren,
  runningRuns,
  transitionRun,
} from "./infra/drizzle-source-runs.ts";
import { runFetchStage } from "../../core/scrape/fetcher.ts";
import { runParseStage } from "../../core/scrape/parser.ts";
import { enqueuePending } from "../../core/scrape/queue.ts";
import { scoreCandidate } from "../../core/scoring/apply.ts";
import { runScoreQueue, scoreQueueStatus } from "../../core/scoring/queue.ts";
import { loadSources } from "../../core/sources/config.ts";
import { parseFetchableSourceKind, sourceId } from "../../core/sources/registry.ts";
import type { SourceConfig } from "../../core/sources/types.ts";
import { activeTermKeys } from "../matching/index.ts";
import { runSweepSlice, type QueueOutcome, type SliceReport, type SweepDeps } from "./app/sweep.ts";
import { SLICE_TOUCHES_THIRD_PARTIES, type SweepSlice } from "./domain/sweep.ts";
import { candidateScoreQueues, drizzleSweepLease, drizzleSweepRuns, lastSyncedBySource } from "./infra/drizzle-sweep.ts";

export { ROUTINES, ROUTINE_LABEL_KEYS, isRoutine, parseRoutine, type Routine } from "./domain/routine.ts";
export type { DispatchResult, WorkflowDispatchPort } from "./ports.ts";
export { githubDispatch } from "./infra/github-dispatch.ts";
export type { RequestRoutineResult } from "./app/request-routine.ts";

const runner = githubDispatch();

/* ---------------------- Execuções de captura e verificação ---------------------- */

export {
  ACTIVE_RUN_STATUSES,
  RUN_STATUSES,
  composeParentStatus,
  isRetryable,
  isStale,
  isTerminal,
  nextRunStatus,
  redactDetail,
  runKey,
  type RunCounts,
  type RunScope,
  type RunStatus,
} from "./domain/runs.ts";
export type { SourceRunRow } from "./infra/drizzle-source-runs.ts";
export type { RequestResult, ExecuteResult, WorkOutcome, SourceSnapshotEntry } from "./app/source-runs.ts";

/** Execução `running` sem batimento por 15 minutos morreu com o processo. */
export const RUN_LEASE_MS = 15 * 60_000;

const runStore: RunStore = {
  createOrJoin: (input) => createOrJoinRun(input),
  get: getRun,
  children: childRuns,
  transition: transitionRun,
  note: noteRun,
  heartbeat: heartbeatRun,
  running: runningRuns,
  orphans: orphanedQueuedChildren,
};

function viewOf(row: CatalogSource): CatalogSourceView {
  return {
    id: row.id,
    kind: row.kind,
    handle: row.handle,
    label: row.label,
    rationale: row.rationale,
    enabled: row.enabled,
    retiredAt: row.retiredAt,
    // Nulo conta como a revisão inicial, igual a `nextRevision()`.
    revision: row.configRevision ?? 1,
    capabilities: capabilitiesFor(row.kind),
  };
}

const catalogReader: CatalogReader = {
  async source(id) {
    const row = await catalogSource(id);
    return row ? viewOf(row) : null;
  },
  async eligible() {
    return (await catalogSources()).filter(isSyncEligible).map(viewOf);
  },
};

function requestDeps(): RequestDeps {
  return { runs: runStore, catalog: catalogReader, runner, now: () => clock().iso() };
}

/**
 * "Buscar agora", "Buscar em todas", "Atualizar status": cria e despacha.
 *
 * Antes, a execução morta sem batimento vira `interrupted`: sem isso, um
 * executor que morreu seguraria a chave, e o pedido se juntaria a ela sem que
 * nada rodasse.
 */
export async function requestSourceRun(
  scope: RunScope,
  actorUserId: number | null,
  opts: { dispatch?: boolean } = {},
): Promise<RequestResult> {
  await interruptStaleSourceRuns();
  return requestRun({ scope, actorUserId, dispatch: opts.dispatch }, requestDeps());
}

export async function retrySourceRun(runId: number, actorUserId: number | null): Promise<RequestResult> {
  await interruptStaleSourceRuns();
  return retryRun({ runId, actorUserId }, requestDeps());
}

export { getRun as sourceRun, childRuns as sourceRunChildren, listRuns as sourceRuns };

function countsOfSync(result: SyncSourceResult): WorkOutcome {
  return {
    ok: result.ok,
    // Falhou antes de ler: nada foi contado, e desconhecido não vira zero.
    counts: result.ok
      ? {
          fetched: result.fetched,
          inserted: result.inserted,
          updated: result.updated,
          unchanged: result.unchanged,
          closed: result.closed,
          alive: null,
          inconclusive: null,
        }
      : { ...UNKNOWN_COUNTS },
    completeness: result.completeness,
    error: result.error,
    report: { warnings: result.warnings, durationMs: result.durationMs, rescored: result.rescored },
  };
}

function countsOfVerify(result: VerifyResult): WorkOutcome {
  return {
    ok: true,
    counts: {
      fetched: result.checked,
      inserted: null,
      updated: null,
      unchanged: null,
      closed: result.gone,
      alive: result.alive,
      inconclusive: result.inconclusive,
    },
    // Cortada pelo `limit`, a verificação não cobriu a fonte inteira; a linha
    // diz isso em vez de parecer completa.
    completeness: result.checked < result.due ? "partial" : "complete",
  };
}

/**
 * Executa uma execução `queued` aqui mesmo — é o que o workflow chama com
 * `--run`. Antes, marca como `interrupted` o que morreu sem batimento, para
 * que uma execução presa não segure a chave de idempotência para sempre.
 */
export async function executeSourceRun(
  id: number,
  opts: {
    concurrency?: number;
    verify?: { minFit?: number; limit?: number };
    onChild?: (source: SourceSnapshotEntry, outcome: WorkOutcome) => void;
  } = {},
): Promise<ExecuteResult> {
  guardIngestion();
  await interruptStaleRuns({ runs: runStore, now: () => clock().iso(), leaseMs: RUN_LEASE_MS });
  const companies = new Map<string, number>();
  return executeRun(id, {
    runs: runStore,
    now: () => clock().iso(),
    concurrency: opts.concurrency ?? 4,
    // Um terço do lease: dois batimentos perdidos ainda não matam a execução.
    heartbeatEveryMs: RUN_LEASE_MS / 3,
    onChild: opts.onChild,
    async work(source, scope) {
      if (scope === "verify") {
        // Pedido para UMA plataforma é sobre todas as vagas abertas dela, não
        // só as de fit alto que a verificação diária prioriza.
        return countsOfVerify(await verifyJobs({ minFit: 0, ...opts.verify, sourceId: source.id }));
      }
      const config = {
        kind: parseFetchableSourceKind(source.kind),
        handle: source.handle,
        label: source.label,
        ...(source.rationale === null ? {} : { rationale: source.rationale }),
      };
      return countsOfSync(await syncConfigured(config, companies));
    },
    async workAll() {
      return countsOfVerify(await verifyJobs({ ...opts.verify }));
    },
  });
}

/** Leitura seguinte à morte do executor: `running` vencida vira `interrupted`. */
export function interruptStaleSourceRuns(): Promise<number[]> {
  return interruptStaleRuns({ runs: runStore, now: () => clock().iso(), leaseMs: RUN_LEASE_MS });
}

/** O caso de uso ligado, para a aplicação. */
export function requestRoutine(routine: unknown): Promise<RequestRoutineResult> {
  return requestRoutineUseCase({ routine }, { runner });
}

/** Se há credencial para pedir na hora. Sem ela, resta a cron diária. */
export function routineRequestConfigured(): boolean {
  return runner.configured();
}

/* ------------------------- Varredura fatiada (ADR 0025) ------------------------- */

export {
  SWEEP_SLICES,
  SLICE_TOUCHES_THIRD_PARTIES,
  isSweepSlice,
  parseSweepSlice,
  sweepEnvironmentAllowed,
  type SweepSlice,
} from "./domain/sweep.ts";
export type { SliceReport } from "./app/sweep.ts";
export { routineTelemetry, type RoutineTelemetry } from "./infra/drizzle-telemetry.ts";

/** Capturas por chamada: uma onda de quatro hosts cabe no teto da função. */
const CAPTURE_PER_SLICE = 4;
/** Teto por página na fatia: robots.txt (8 s) + página (10 s) < orçamento. */
const CAPTURE_TIMEOUT_MS = 10_000;
/** Mesmo corte de fit da varredura diária: não gastar requisição com vaga que ninguém lê. */
const CAPTURE_MIN_FIT = 45;

async function termsSlice(worker: string, budgetMs: number): Promise<QueueOutcome> {
  const started = clock().now();
  const now = new Date(started);
  // Idempotente por (plataforma, termo, dia): repetir a cada chamada só
  // encontra as linhas de hoje já criadas.
  for (const { termKey, query } of await activeTermKeys()) {
    await requestTermCaptures({ termKey, query, origin: "sweep", now });
  }
  const summary = await runTermCaptures({ worker, budgetMs: Math.max(0, budgetMs - (clock().now() - started)) });
  const detail = { claimed: 0, succeeded: 0, waiting: 0, failed: 0, created: 0 };
  for (const run of Object.values(summary)) {
    detail.claimed += run.claimed;
    detail.succeeded += run.succeeded;
    detail.waiting += run.waiting;
    detail.failed += run.failed;
    detail.created += run.created;
  }
  return { items: detail.succeeded, errors: detail.failed, detail };
}

async function captureSlice(): Promise<QueueOutcome> {
  const { queued } = await enqueuePending({ minFit: CAPTURE_MIN_FIT, limit: 20 });
  const fetched = await runFetchStage({ concurrency: CAPTURE_PER_SLICE, limit: CAPTURE_PER_SLICE, timeoutMs: CAPTURE_TIMEOUT_MS });
  // Tratar é local e barato; o lote acompanha o que a captura produz.
  const parsed = await runParseStage({ concurrency: 2, limit: CAPTURE_PER_SLICE * 2 });
  return {
    items: fetched.stored + parsed.parsed,
    errors: fetched.failed + parsed.failed,
    detail: { queued, stored: fetched.stored, blocked: fetched.blocked, fetchFailed: fetched.failed, parsed: parsed.parsed },
  };
}

async function recheckSlice(worker: string, budgetMs: number): Promise<QueueOutcome> {
  const started = clock().now();
  // Só enfileira quando a rodada anterior drenou. `enqueueVerify` recoloca a
  // tarefa em `pending` e zera tentativas e espera; reenfileirar a cada chamada
  // anularia o backoff de quem está falhando, e a fila nunca chegaria a `failed`.
  const stats = await verifyStats();
  const open = (stats.pending ?? 0) + (stats.checking ?? 0);
  const queued = open === 0 ? await enqueueStale({ limit: 60 }) : 0;
  const result = await runVerifyQueue({
    worker,
    delayMs: 200,
    budgetMs: Math.max(0, budgetMs - (clock().now() - started)),
  });
  // Só 404/410 fecham — é o veredito `gone` de `probe.ts`; o resto não decide.
  return {
    items: result.checked,
    errors: 0,
    detail: { queued, checked: result.checked, gone: result.gone, alive: result.alive, inconclusive: result.inconclusive },
  };
}

/**
 * A fila de repontuação (ADR 0026): pedidos de quem salvou currículo ou mexeu
 * em trilha. `sem-nota` e `manutencao` percorrem candidatos pela cadência, mas
 * não concluem a tarefa nem registram a recusa — e é a tarefa que a tela lê.
 */
async function rescoreSlice(worker: string, budgetMs: number): Promise<QueueOutcome> {
  const result = await runScoreQueue({ worker, budgetMs });
  const pending = (await scoreQueueStatus()).pending ?? 0;
  return {
    // Concluídas ou recusadas; a que falhou e voltou à fila conta em `errors`.
    items: result.processadas - result.falhas,
    errors: result.falhas,
    detail: { scored: result.pontuadas, deferred: result.adiadas, pending },
  };
}

/**
 * Executa uma fatia da varredura com os adapters de verdade.
 *
 * `alarm` vem de quem chama porque o destino do alarme (Sentry, log da função)
 * é da borda HTTP, não do contexto.
 */
export async function runSweep(
  slice: SweepSlice,
  opts: { alarm: SweepDeps["alarm"] },
): Promise<SliceReport> {
  if (SLICE_TOUCHES_THIRD_PARTIES[slice]) guardIngestion();
  const worker = `varredura-${randomUUID()}`;
  const configs = new Map<string, SourceConfig>();
  return runSweepSlice(slice, {
    now: () => clock().now(),
    lease: drizzleSweepLease(worker),
    runs: drizzleSweepRuns,
    sync: {
      async sources() {
        // Do banco, como a CLI: o YAML só entra pelo regime de `ensureSources`.
        for (const config of await catalogForSync(await loadSources())) {
          configs.set(sourceId(config.kind, config.handle), config);
        }
        return [...configs.keys()].map((id) => ({ id }));
      },
      lastSynced: lastSyncedBySource,
      async run(id) {
        const config = configs.get(id);
        if (!config) return { ok: false, items: 0, error: "fonte fora da configuração" };
        // A fatia também deixa execução em `source_run` (#223): toda captura
        // explica, sozinha, o que trouxe. Uma execução equivalente já ativa
        // (pedida pela tela) é a que esta fatia roda; uma que outro processo
        // está rodando fica com ele. Uma fatia que a Vercel matou no meio deixa
        // a execução `running`; sem batimento, ela vira `interrupted` aqui
        // passado o lease, e a fonte volta a ser varrida.
        await interruptStaleSourceRuns();
        const requested = await requestRun(
          { scope: { kind: "source", sourceId: id }, actorUserId: null, dispatch: false },
          requestDeps(),
        );
        if (!requested.ok) return { ok: false, items: 0, error: requested.code };
        let synced: SyncSourceResult | null = null;
        const executed = await executeRun(requested.runId, {
          runs: runStore,
          now: () => clock().iso(),
          concurrency: 1,
          heartbeatEveryMs: RUN_LEASE_MS / 3,
          async work() {
            synced = await syncSource(config);
            return countsOfSync(synced);
          },
        });
        // Outro processo pegou a execução: é dele, e a fatia cede sem erro.
        if (!executed.ok && executed.code === "not_queued") return { ok: true, items: 0 };
        if (!executed.ok) return { ok: false, items: 0, error: executed.code };
        const result = synced as SyncSourceResult | null;
        return { ok: result?.ok ?? false, items: result?.fetched ?? 0, error: result?.error };
      },
    },
    score: {
      candidates: candidateScoreQueues,
      async run(candidateId, deadline) {
        const result = await scoreCandidate(candidateId, { deadline });
        return { ok: result.erro === undefined, items: result.scored, error: result.erro };
      },
    },
    terms: (budgetMs) => termsSlice(worker, budgetMs),
    capture: () => captureSlice(),
    recheck: (budgetMs) => recheckSlice(worker, budgetMs),
    rescore: (budgetMs) => rescoreSlice(worker, budgetMs),
    alarm: opts.alarm,
  });
}
