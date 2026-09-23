/**
 * Uma fatia da varredura, do começo à métrica.
 *
 * Orquestração burra: as regras de ordem, intervalo e orçamento moram em
 * `domain/sweep.ts`; o SQL da reserva e da métrica, em `infra/`; o trabalho de
 * verdade (sync, captura, reconferência, nota) é das funções que a CLI já usa.
 * Tudo chega por `deps`, e é isso que deixa o teste dirigir relógio, reserva e
 * falha sem banco nem rede.
 *
 * Três garantias valem para toda fatia:
 *
 * - **Uma unidade que falha não derruba as outras.** O erro vira linha na
 *   métrica e a próxima fonte segue — é o mesmo contrato de `syncAll`.
 * - **Duas chamadas simultâneas não fazem o mesmo trabalho.** Fonte e
 *   candidato são reservados antes de começar; as filas (captura,
 *   reconferência, termos) já reservam por linha.
 * - **Nada aqui escreve em `application`** (regra 2). As fatias só chamam
 *   ingestão e pontuação, que mexem em `job`, `job_score` e nas filas.
 */
import { REDACTED, redactSecrets } from "../../../core/observability.ts";
import {
  ALARM_MIN_INTERVAL_MS,
  SCORE_MIN_INTERVAL_MS,
  SWEEP_BUDGET_MS,
  SYNC_MIN_INTERVAL_MS,
  dueUnits,
  mayStartAnother,
  remainingBudget,
  staleSources,
  type RunRow,
  type SweepLease,
  type SweepRuns,
  type SweepSlice,
} from "../domain/sweep.ts";

/** Quantos dias de métrica guardar. Duas semanas cobrem a prova de 24 h com folga. */
export const RUN_RETENTION_DAYS = 14;

export type UnitOutcome = { ok: boolean; items: number; error?: string };

export type UnitReport = UnitOutcome & { unit: string; durationMs: number };

export type SliceReport = {
  slice: SweepSlice;
  startedAt: string;
  durationMs: number;
  /** Unidades concluídas (fontes, candidatos, capturas, conferências). */
  items: number;
  errors: number;
  units: UnitReport[];
  /** Contagens próprias da fatia, só números. */
  detail: Record<string, number>;
  /** Fontes há mais de duas horas sem sincronizar (só na fatia `sync`). */
  staleSources: string[];
};

export type { RunRow };

export type QueueOutcome = { items: number; errors: number; detail: Record<string, number> };

export type SweepDeps = {
  now: () => number;
  budgetMs?: number;
  lease: SweepLease;
  runs: SweepRuns;
  sync: {
    /** As fontes habilitadas de `config/sources.yaml`, como `id` estável. */
    sources(): Promise<{ id: string }[]>;
    /** `last_synced_at` de cada fonte conhecida no banco. */
    lastSynced(): Promise<Map<string, string | null>>;
    run(sourceId: string): Promise<UnitOutcome>;
  };
  score: {
    candidates(): Promise<number[]>;
    run(candidateId: number): Promise<UnitOutcome>;
  };
  terms(budgetMs: number): Promise<QueueOutcome>;
  capture(budgetMs: number): Promise<QueueOutcome>;
  recheck(budgetMs: number): Promise<QueueOutcome>;
  alarm(report: { kind: "fonte_sem_sync"; sources: string[] }): Promise<void>;
};

/**
 * A mensagem de erro que pode sair na métrica e na resposta HTTP.
 *
 * Erro de adapter carrega a URL pedida (`GET <url> -> 500`), e há fonte que
 * autentica por query string (`app_key=` do Adzuna). A query sai inteira, e o
 * resto passa pela mesma redação dos eventos do Sentry.
 */
export function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return redactSecrets(text.replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, `$1?${REDACTED}`)).slice(0, 500);
}

/**
 * Percorre as unidades devidas, reservando cada uma, até o orçamento acabar.
 *
 * Perder a reserva não é erro: outra chamada chegou antes, e esta segue para a
 * próxima unidade da lista.
 */
async function drainUnits(
  deps: SweepDeps,
  due: readonly string[],
  minIntervalMs: number,
  work: (key: string) => Promise<UnitOutcome>,
  started: number,
): Promise<UnitReport[]> {
  const budget = deps.budgetMs ?? SWEEP_BUDGET_MS;
  const reports: UnitReport[] = [];
  let slowest = 0;
  for (const key of due) {
    if (!mayStartAnother({ done: reports.length, elapsedMs: deps.now() - started, slowestMs: slowest }, budget)) break;
    const now = deps.now();
    if (!(await deps.lease.claim(key, { now, notBefore: now - minIntervalMs }))) continue;
    const began = deps.now();
    let outcome: UnitOutcome;
    try {
      outcome = await work(key);
    } catch (error) {
      outcome = { ok: false, items: 0, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await deps.lease.release(key, deps.now());
    }
    const durationMs = deps.now() - began;
    slowest = Math.max(slowest, durationMs);
    const error = outcome.error === undefined ? undefined : safeError(outcome.error);
    reports.push({ unit: key, durationMs, ...outcome, error });
  }
  return reports;
}

/**
 * Reserva `key` no máximo uma vez por `intervalMs`, roda `work` se ganhou.
 * É o que limita o alarme e a limpeza da métrica sem tabela própria.
 */
async function atMostEvery(deps: SweepDeps, key: string, intervalMs: number, work: () => Promise<void>): Promise<void> {
  const now = deps.now();
  if (!(await deps.lease.claim(key, { now, notBefore: now - intervalMs }))) return;
  try {
    await work();
  } finally {
    await deps.lease.release(key, deps.now());
  }
}

async function syncSlice(deps: SweepDeps, started: number): Promise<Pick<SliceReport, "units" | "staleSources">> {
  const sources = await deps.sync.sources();
  const lastSynced = await deps.sync.lastSynced();
  const leases = await deps.lease.read("sync:");
  const due = dueUnits(
    sources.map((entry) => ({ key: `sync:${entry.id}`, lastDoneAt: lastSynced.get(entry.id) ?? null })),
    leases,
    deps.now(),
    { minIntervalMs: SYNC_MIN_INTERVAL_MS },
  );
  const units = await drainUnits(deps, due, SYNC_MIN_INTERVAL_MS, (key) => deps.sync.run(key.slice("sync:".length)), started);

  // Depois do trabalho, com o que ele acabou de gravar: uma fonte sincronizada
  // agora não pode aparecer no alarme desta mesma chamada.
  const after = await deps.sync.lastSynced();
  const stale = staleSources(
    sources.map((entry) => ({ id: entry.id, lastSyncedAt: after.get(entry.id) ?? null })),
    deps.now(),
  );
  if (stale.length > 0) {
    await atMostEvery(deps, "alarme:fonte-sem-sync", ALARM_MIN_INTERVAL_MS, () =>
      deps.alarm({ kind: "fonte_sem_sync", sources: stale }),
    );
  }
  return { units, staleSources: stale };
}

async function scoreSlice(deps: SweepDeps, started: number): Promise<UnitReport[]> {
  const candidates = await deps.score.candidates();
  const leases = await deps.lease.read("pontuar:");
  const due = dueUnits(
    candidates.map((id) => ({ key: `pontuar:${id}`, lastDoneAt: null })),
    leases,
    deps.now(),
    { minIntervalMs: SCORE_MIN_INTERVAL_MS },
  );
  return drainUnits(deps, due, SCORE_MIN_INTERVAL_MS, (key) => deps.score.run(Number(key.slice("pontuar:".length))), started);
}

/**
 * Executa uma fatia e grava a métrica dela.
 *
 * A métrica é gravada mesmo quando a fatia lança: uma chamada que falhou sem
 * deixar linha é indistinguível de uma que nunca aconteceu, e é essa diferença
 * que a prova de cadência precisa ver.
 */
export async function runSweepSlice(slice: SweepSlice, deps: SweepDeps): Promise<SliceReport> {
  const budget = deps.budgetMs ?? SWEEP_BUDGET_MS;
  const started = deps.now();
  const startedAt = new Date(started).toISOString();
  let units: UnitReport[] = [];
  let stale: string[] = [];
  let queue: QueueOutcome | null = null;
  let failure: string | null = null;

  try {
    if (slice === "sync") {
      const result = await syncSlice(deps, started);
      units = result.units;
      stale = result.staleSources;
    } else if (slice === "pontuar") {
      units = await scoreSlice(deps, started);
    } else {
      const left = remainingBudget(deps.now() - started, budget);
      queue =
        slice === "termos" ? await deps.terms(left) : slice === "captura" ? await deps.capture(left) : await deps.recheck(left);
    }
  } catch (error) {
    failure = safeError(error);
  }

  const durationMs = deps.now() - started;
  const items = queue ? queue.items : units.filter((unit) => unit.ok).length;
  const errors = (queue ? queue.errors : units.filter((unit) => !unit.ok).length) + (failure ? 1 : 0);

  const rows: RunRow[] = [
    { slice, unit: null, startedAt, durationMs, items, errors, error: failure },
    ...units.map((unit) => ({
      slice,
      unit: unit.unit,
      startedAt,
      durationMs: unit.durationMs,
      items: unit.items,
      errors: unit.ok ? 0 : 1,
      error: unit.error ?? null,
    })),
  ];
  await deps.runs.record(rows);
  await atMostEvery(deps, "manutencao:sweep-run", 24 * 3_600_000, () =>
    deps.runs.prune(deps.now() - RUN_RETENTION_DAYS * 86_400_000),
  );

  return {
    slice,
    startedAt,
    durationMs,
    items,
    errors,
    units,
    detail: queue?.detail ?? {},
    staleSources: stale,
  };
}
