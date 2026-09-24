/**
 * Pedir e executar uma execução de captura ou de verificação (#223, tarefa 02).
 *
 * Orquestração burra: o domínio decide (recusa, chave, transição, composição,
 * redação), a infra recebida grava, e quem executa de verdade continua atrás
 * da `WorkflowDispatchPort`. Nada aqui sabe de SQL nem de HTTP.
 */
import {
  catalogRevision,
  composeParentStatus,
  createRunLimiter,
  ERROR_DETAIL_MAX,
  isRetryable,
  isStale,
  redactDetail,
  refuseRun,
  runKey,
  shouldRedispatch,
  sumCounts,
  UNKNOWN_COUNTS,
  type RunCounts,
  type RunRefusal,
  type RunScope,
  type RunStatus,
  type RunnableSource,
} from "../domain/runs.ts";
import type { DispatchRequest, WorkflowDispatchPort } from "../ports.ts";

/** O retrato de uma fonte no momento do pedido. Nunca segredo: `secret_ref` fica de fora. */
export type SourceSnapshotEntry = {
  id: string;
  kind: string;
  handle: string;
  label: string;
  rationale: string | null;
  revision: number;
  capabilities: unknown;
};

export type RunSnapshot = { sources: SourceSnapshotEntry[] };

export type CatalogSourceView = RunnableSource & Omit<SourceSnapshotEntry, "revision">;

export type RunRow = {
  id: number;
  scopeKind: string;
  sourceId: string | null;
  parentId: number | null;
  retryOf: number | null;
  status: string;
  heartbeatAt: string | null;
  queuedAt: string;
  errorCode: string | null;
  configSnapshot: unknown;
};

export type RunStore = {
  createOrJoin(input: {
    scopeKind: RunScope["kind"];
    sourceId: string | null;
    parentId: number | null;
    retryOf: number | null;
    idempotencyKey: string;
    actorUserId: number | null;
    configSnapshot: RunSnapshot;
    queuedAt: string;
  }): Promise<{ run: RunRow; created: boolean }>;
  get(id: number): Promise<RunRow | null>;
  children(parentId: number): Promise<RunRow[]>;
  transition(
    id: number,
    from: RunStatus,
    to: RunStatus,
    patch?: Partial<RunCounts> & {
      heartbeatAt?: string;
      startedAt?: string;
      finishedAt?: string;
      completeness?: string | null;
      errorCode?: string | null;
      errorDetail?: string | null;
    },
  ): Promise<boolean>;
  note(id: number, errorCode: string | null, errorDetail?: string | null): Promise<boolean>;
  heartbeat(id: number, now: string): Promise<void>;
  running(): Promise<{ id: number; status: string; heartbeatAt: string | null }[]>;
};

export type CatalogReader = {
  /** Fonte do catálogo por id, com revisão e capacidades; `null` fora do catálogo. */
  source(id: string): Promise<CatalogSourceView | null>;
  /** As fontes que uma execução "todas" varre agora (habilitadas, não aposentadas). */
  eligible(): Promise<CatalogSourceView[]>;
};

export type RequestDeps = {
  runs: RunStore;
  catalog: CatalogReader;
  runner: WorkflowDispatchPort;
  now(): string;
};

export type RequestResult =
  | { ok: true; runId: number; created: boolean }
  | { ok: false; code: RunRefusal | "not_retryable" | "run_not_found" };

function snapshotOf(source: CatalogSourceView): SourceSnapshotEntry {
  return {
    id: source.id,
    kind: source.kind,
    handle: source.handle,
    label: source.label,
    rationale: source.rationale,
    revision: source.revision,
    capabilities: source.capabilities,
  };
}

/**
 * Despacha a execução recém-criada, ou a equivalente já ativa que ficou
 * `queued` sem ninguém para rodá-la (`shouldRedispatch`): sem credencial, com
 * despacho que falhou na rede ou pendente há tempo demais. Sem credencial, a
 * linha fica `queued` com o motivo — ela não some, e o próximo pedido tenta de
 * novo.
 */
async function dispatchIfNeeded(
  deps: RequestDeps,
  run: RunRow,
  created: boolean,
  request: DispatchRequest,
): Promise<void> {
  if (!created && !shouldRedispatch(run, deps.now())) return;
  let result: Awaited<ReturnType<WorkflowDispatchPort["dispatch"]>>;
  try {
    result = await deps.runner.dispatch(request);
  } catch (error) {
    // Rede ou executor fora do ar: a linha segue `queued`, com o motivo, e o
    // próximo pedido equivalente despacha de novo.
    const detail = redactDetail(error instanceof Error ? error.message : String(error), ERROR_DETAIL_MAX);
    await deps.runs.note(run.id, "dispatch_failed", detail);
    return;
  }
  if (result.ok) {
    if (run.errorCode !== null) await deps.runs.note(run.id, null);
    return;
  }
  if (result.code === "no_token") {
    await deps.runs.note(run.id, "no_token");
    return;
  }
  const detail = redactDetail(`executor recusou o despacho (HTTP ${result.status})`, ERROR_DETAIL_MAX);
  await deps.runs.transition(run.id, "queued", "failed", {
    finishedAt: deps.now(),
    errorCode: "dispatch_rejected",
    errorDetail: detail,
  });
}

/**
 * "Buscar agora" (uma fonte), "Buscar em todas" ou "Atualizar status".
 *
 * `dispatch: false` é para a CLI, que ela mesma executa em seguida: pedir ao
 * GitHub para rodar o que já está rodando aqui seria trabalho em dobro.
 */
export async function requestRun(
  input: { scope: RunScope; actorUserId: number | null; dispatch?: boolean },
  deps: RequestDeps,
): Promise<RequestResult> {
  const { scope } = input;
  let sources: CatalogSourceView[];
  let revision: number | string;
  let sourceId: string | null = null;

  const single = scope.kind === "all" ? null : scope.sourceId;
  if (single === null) {
    sources = await deps.catalog.eligible();
    revision = catalogRevision(sources.map((s) => ({ id: s.id, revision: s.revision })));
  } else {
    sourceId = single;
    const source = await deps.catalog.source(single);
    const refusal = refuseRun(source);
    if (refusal || !source) return { ok: false, code: refusal ?? "source_not_found" };
    sources = [source];
    revision = source.revision;
  }

  const { run, created } = await deps.runs.createOrJoin({
    scopeKind: scope.kind,
    sourceId,
    parentId: null,
    retryOf: null,
    idempotencyKey: runKey(scope, revision),
    actorUserId: input.actorUserId,
    configSnapshot: { sources: sources.map(snapshotOf) },
    queuedAt: deps.now(),
  });
  if (input.dispatch !== false) {
    await dispatchIfNeeded(deps, run, created, {
      routine: scope.kind === "verify" ? "recheck" : "sync",
      source: sourceId,
      run: run.id,
    });
  }
  return { ok: true, runId: run.id, created };
}

/**
 * Nova tentativa: outra linha, ligada à original por `retry_of`, com o MESMO
 * retrato de configuração. A original não muda. Dois cliques em "tentar de
 * novo" enquanto a tentativa está ativa devolvem a mesma tentativa.
 */
export async function retryRun(
  input: { runId: number; actorUserId: number | null },
  deps: RequestDeps,
): Promise<RequestResult> {
  const original = await deps.runs.get(input.runId);
  if (!original) return { ok: false, code: "run_not_found" };
  if (!isRetryable(original.status as RunStatus)) return { ok: false, code: "not_retryable" };
  // Filha de "todas" é tentada como execução de uma fonte, fora do pai: o pai
  // já terminou e não volta a mudar.
  const scopeKind = original.scopeKind === "verify" ? "verify" : original.scopeKind === "all" ? "all" : "source";
  if (original.sourceId !== null) {
    const refusal = refuseRun(await deps.catalog.source(original.sourceId));
    if (refusal) return { ok: false, code: refusal };
  }
  // Nova tentativa de "todas" é outra execução: fonte aposentada ou desligada
  // depois do pedido original não volta a ser capturada por ela.
  let snapshot = original.configSnapshot as RunSnapshot;
  if (original.sourceId === null) {
    const eligible = new Set((await deps.catalog.eligible()).map((source) => source.id));
    snapshot = { sources: snapshot.sources.filter((source) => eligible.has(source.id)) };
  }
  const { run, created } = await deps.runs.createOrJoin({
    scopeKind,
    sourceId: original.sourceId,
    parentId: null,
    retryOf: original.id,
    idempotencyKey: `retry:${original.id}`,
    actorUserId: input.actorUserId,
    configSnapshot: snapshot,
    queuedAt: deps.now(),
  });
  await dispatchIfNeeded(deps, run, created, {
    routine: scopeKind === "verify" ? "recheck" : "sync",
    source: original.sourceId,
    run: run.id,
  });
  return { ok: true, runId: run.id, created };
}

/* ---------------------------------- execução ---------------------------------- */

/** O resultado de trabalhar UMA fonte, no vocabulário da execução. */
export type WorkOutcome = {
  ok: boolean;
  counts: RunCounts;
  completeness: string | null;
  error?: string;
  /** Só para quem imprime (CLI); não vai para `source_run`. */
  report?: { warnings: string[]; durationMs: number; rescored: number };
};

export type ExecuteDeps = {
  runs: RunStore;
  now(): string;
  /** Captura ou verificação de uma fonte do retrato. Nunca lança: erro vem em `error`. */
  work(source: SourceSnapshotEntry, scope: "source" | "verify", runId: number): Promise<WorkOutcome>;
  /** Verificação sem fonte (todas as vagas vencidas), quando o escopo é `verify` global. */
  workAll?(runId: number): Promise<WorkOutcome>;
  /** Teto de filhas em paralelo numa execução "todas". */
  concurrency: number;
  /**
   * Intervalo do batimento enquanto a execução trabalha. Sem ele, uma fonte
   * que demora mais que o lease seria dada como morta no meio do trabalho.
   */
  heartbeatEveryMs?: number;
  onChild?(source: SourceSnapshotEntry, outcome: WorkOutcome): void;
};

/**
 * Bate o coração de `ids()` a cada `everyMs` enquanto `work` roda. O timer não
 * segura o processo aberto, e para no fim, com ou sem erro.
 */
async function withHeartbeat<T>(deps: ExecuteDeps, ids: () => number[], work: () => Promise<T>): Promise<T> {
  if (!deps.heartbeatEveryMs) return work();
  const timer = setInterval(() => {
    for (const id of ids()) void deps.runs.heartbeat(id, deps.now()).catch(() => undefined);
  }, deps.heartbeatEveryMs);
  timer.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

export type ExecuteResult =
  | { ok: true; status: RunStatus; counts: RunCounts }
  /** `lost_lease`: o trabalho terminou, mas a linha já tinha sido dada como interrompida. */
  | { ok: false; code: "run_not_found" | "not_queued" | "lost_lease" };

function finalStatus(outcome: WorkOutcome): RunStatus {
  return outcome.ok ? "succeeded" : "failed";
}

/**
 * Grava o fim. `false` quando a linha já não estava `running` — outro processo
 * a deu por morta —, e então o resultado não é gravado por cima (linha
 * terminal é imutável), mas quem chamou fica sabendo.
 */
async function finish(deps: ExecuteDeps, id: number, status: RunStatus, outcome: WorkOutcome): Promise<boolean> {
  return deps.runs.transition(id, "running", status, {
    ...outcome.counts,
    completeness: outcome.completeness,
    finishedAt: deps.now(),
    errorCode: outcome.ok ? null : "work_failed",
    errorDetail: outcome.error ? redactDetail(outcome.error, ERROR_DETAIL_MAX) : null,
  });
}

/** `queued → running` com a trava do estado de origem: só um executor ganha a linha. */
async function start(deps: ExecuteDeps, id: number): Promise<boolean> {
  const now = deps.now();
  return deps.runs.transition(id, "queued", "running", { startedAt: now, heartbeatAt: now, errorCode: null, errorDetail: null });
}

/**
 * Executa a execução `id`, que precisa estar `queued`. Uma execução que outro
 * processo já pegou (ou que terminou) devolve `not_queued` sem tocar em nada:
 * repetir o despacho é inofensivo.
 */
export async function executeRun(id: number, deps: ExecuteDeps): Promise<ExecuteResult> {
  const run = await deps.runs.get(id);
  if (!run) return { ok: false, code: "run_not_found" };
  if (!(await start(deps, id))) return { ok: false, code: "not_queued" };

  const snapshot = run.configSnapshot as RunSnapshot;

  if (run.scopeKind === "all") return executeAll(run, snapshot, deps);

  const source = snapshot.sources[0];
  const outcome: WorkOutcome = await withHeartbeat(deps, () => [id], async () => {
    if (run.scopeKind === "verify" && run.sourceId === null) {
      return deps.workAll
        ? deps.workAll(id)
        : { ok: false, counts: UNKNOWN_COUNTS, completeness: null, error: "verificação global indisponível" };
    }
    return source
      ? deps.work(source, run.scopeKind === "verify" ? "verify" : "source", id)
      : { ok: false, counts: UNKNOWN_COUNTS, completeness: null, error: "retrato sem fonte" };
  });
  if (source && run.sourceId !== null) deps.onChild?.(source, outcome);
  const status = finalStatus(outcome);
  if (!(await finish(deps, id, status, outcome))) return { ok: false, code: "lost_lease" };
  return { ok: true, status, counts: outcome.counts };
}

/**
 * "Todas": uma filha por fonte do RETRATO do pedido — desabilitar uma fonte
 * depois do pedido vale para a próxima execução, não para esta (US-008.EC-1).
 * As filhas rodam com teto de concorrência; a reserva do slot é síncrona
 * (G13), e quem espera fica `queued` com o motivo `waiting_slot`.
 */
async function executeAll(parent: RunRow, snapshot: RunSnapshot, deps: ExecuteDeps): Promise<ExecuteResult> {
  const children: { source: SourceSnapshotEntry; id: number }[] = [];
  for (const source of snapshot.sources) {
    const { run } = await deps.runs.createOrJoin({
      scopeKind: "source",
      sourceId: source.id,
      parentId: parent.id,
      retryOf: null,
      idempotencyKey: runKey({ kind: "source", sourceId: source.id, parentId: parent.id }, source.revision),
      actorUserId: null,
      configSnapshot: { sources: [source] },
      queuedAt: deps.now(),
    });
    children.push({ source, id: run.id });
  }

  const max = Math.max(1, deps.concurrency);
  const limiter = createRunLimiter(max);
  for (const child of children.slice(max)) {
    await deps.runs.note(child.id, "waiting_slot");
  }

  const outcomes: WorkOutcome[] = [];
  const statuses: RunStatus[] = [];
  const inFlight = new Set<Promise<void>>();
  const working = new Set<number>();
  const pending = [...children];

  const runChild = async (child: { source: SourceSnapshotEntry; id: number }): Promise<void> => {
    try {
      if (!(await start(deps, child.id))) return;
      working.add(child.id);
      const outcome = await deps.work(child.source, "source", child.id);
      working.delete(child.id);
      const status = finalStatus(outcome);
      // Filha dada por morta no meio conta como interrompida: o pai não pode
      // se dizer concluído com uma filha que ninguém gravou.
      const recorded = await finish(deps, child.id, status, outcome);
      outcomes.push(recorded ? outcome : { ...outcome, counts: UNKNOWN_COUNTS });
      statuses.push(recorded ? status : "interrupted");
      deps.onChild?.(child.source, outcome);
    } finally {
      working.delete(child.id);
      limiter.release();
    }
  };

  await withHeartbeat(deps, () => [parent.id, ...working], async () => {
    while (pending.length > 0) {
      // Reserva antes do `await`: conferir e ocupar no mesmo tique.
      if (limiter.tryAcquire()) {
        const child = pending.shift()!;
        const task: Promise<void> = runChild(child).finally(() => inFlight.delete(task));
        inFlight.add(task);
      } else {
        await Promise.race(inFlight);
      }
    }
    await Promise.all(inFlight);
  });

  const status = composeParentStatus(statuses);
  const counts = sumCounts(outcomes.map((o) => o.counts));
  const failed = statuses.filter((s) => s !== "succeeded").length;
  const recorded = await deps.runs.transition(parent.id, "running", status, {
    ...counts,
    finishedAt: deps.now(),
    errorCode: failed > 0 ? "children_failed" : null,
    errorDetail: failed > 0 ? `${failed} de ${statuses.length} fonte(s) sem sucesso` : null,
  });
  if (!recorded) return { ok: false, code: "lost_lease" };
  return { ok: true, status, counts };
}

/**
 * Execução `running` sem batimento além do lease vira `interrupted` e sai do
 * índice de idempotência, liberando novo pedido. A regra é `isStale`, a mesma
 * da análise de vaga.
 */
export async function interruptStaleRuns(deps: { runs: RunStore; now(): string; leaseMs: number }): Promise<number[]> {
  const now = deps.now();
  const interrupted: number[] = [];
  for (const run of await deps.runs.running()) {
    if (!isStale({ status: run.status as RunStatus, heartbeatAt: run.heartbeatAt ?? "" }, now, deps.leaseMs)) continue;
    const ok = await deps.runs.transition(run.id, "running", "interrupted", {
      finishedAt: now,
      errorCode: "lease_expired",
      errorDetail: null,
    });
    if (ok) interrupted.push(run.id);
  }
  return interrupted;
}
