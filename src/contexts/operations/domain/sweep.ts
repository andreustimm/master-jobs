/**
 * A varredura fatiada: o que cada chamada pode fazer, e em que ordem.
 *
 * Função pura — sem banco, sem rede, sem relógio. O relógio entra como número
 * (`now`), porque "esta fonte já pode ser sincronizada de novo?" é decisão, e
 * decisão sobre tempo só é testável quando o tempo é parâmetro.
 *
 * Por que fatias: a função da Vercel morre aos 30 segundos, e a varredura
 * inteira leva quase uma hora. O `pg_cron` do Supabase chama uma fatia de cada
 * vez; cada fatia faz o que cabe em {@link SWEEP_BUDGET_MS} e devolve (ADR 0025).
 */

export const SWEEP_SLICES = ["sync", "termos", "captura", "reconferencia", "pontuar"] as const;

export type SweepSlice = (typeof SWEEP_SLICES)[number];

/**
 * Quais fatias tocam rede de terceiro e, por isso, respondem à política de
 * ingestão (ADR 0021). Pontuar lê e grava só o próprio banco.
 */
export const SLICE_TOUCHES_THIRD_PARTIES: Readonly<Record<SweepSlice, boolean>> = {
  sync: true,
  termos: true,
  captura: true,
  reconferencia: true,
  pontuar: false,
};

/**
 * Orçamento de trabalho de uma chamada.
 *
 * Vinte segundos contra os trinta da plataforma: a fatia só COMEÇA uma unidade
 * que caberia no orçamento pela mais lenta até aqui, e uma unidade começada
 * não é interrompida. A folga é para essa última unidade e para gravar a
 * métrica.
 */
export const SWEEP_BUDGET_MS = 20_000;

/**
 * Reserva mais velha que isto é de uma função morta.
 *
 * A função vive no máximo 30 segundos, então cinco minutos é folga larga — e
 * curta o bastante para a fonte voltar à fila na mesma hora.
 */
export const LEASE_DEAD_MS = 5 * 60_000;

/**
 * Intervalo mínimo entre duas sincronizações da mesma fonte.
 *
 * A meta é ≤ 60 minutos; 45 deixa margem para a fila dar a volta sem que uma
 * fonte rápida seja buscada a cada chamada. É também o teto de custo: cada
 * fonte é buscada no máximo uma vez a cada 45 minutos, qualquer que seja a
 * cadência do `pg_cron`.
 */
export const SYNC_MIN_INTERVAL_MS = 45 * 60_000;

/** Vaga nova recebe nota em até ~10 minutos depois de entrar. */
export const SCORE_MIN_INTERVAL_MS = 10 * 60_000;

/** Fonte sem sincronização há mais que isto dispara alarme. */
export const STALE_SOURCE_ALARM_MS = 2 * 3_600_000;

/** O mesmo alarme não sai mais que uma vez por hora. */
export const ALARM_MIN_INTERVAL_MS = 3_600_000;

export function isSweepSlice(value: unknown): value is SweepSlice {
  return typeof value === "string" && (SWEEP_SLICES as readonly string[]).includes(value);
}

/**
 * A fatia pedida, ou a recusa. Nome desconhecido não vira "tudo": uma URL
 * digitada errado no `pg_cron` precisa aparecer como erro, não como trabalho.
 */
export function parseSweepSlice(value: unknown): { ok: true; slice: SweepSlice } | { ok: false } {
  return isSweepSlice(value) ? { ok: true, slice: value } : { ok: false };
}

export type LeaseState = {
  key: string;
  claimedAt: string | null;
  lastClaimedAt: string | null;
  lastFinishedAt: string | null;
};

/** Reserva e liberação de unidade; o adapter é SQL, o teste é um `Map`. */
export type SweepLease = {
  /** Lê as reservas cujas chaves começam com `prefix`. */
  read(prefix: string): Promise<Map<string, LeaseState>>;
  /**
   * Reserva `key` se ela estiver livre (ou vencida) e não tiver terminado
   * depois de `notBefore`. Atômico: com N chamadas, uma só recebe `true`.
   */
  claim(key: string, at: { now: number; notBefore: number }): Promise<boolean>;
  release(key: string, now: number): Promise<void>;
};

/** Uma linha de métrica: só números e identificadores de fonte ou candidato. */
export type RunRow = {
  slice: SweepSlice;
  unit: string | null;
  startedAt: string;
  durationMs: number;
  items: number;
  errors: number;
  error: string | null;
};

export type SweepRuns = {
  record(rows: RunRow[]): Promise<void>;
  prune(before: number): Promise<void>;
};

export type UnitState = {
  key: string;
  /** Quando a unidade terminou pela última vez, pelo que a própria tabela dela diz. */
  lastDoneAt: string | null;
};

function instant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function latest(...values: (string | null | undefined)[]): number | null {
  let best: number | null = null;
  for (const value of values) {
    const at = instant(value);
    if (at !== null && (best === null || at > best)) best = at;
  }
  return best;
}

/**
 * As unidades que esta chamada pode tentar, na ordem em que deve tentá-las.
 *
 * Round-robin pela tentativa mais antiga: nunca tentada primeiro, depois a que
 * foi tentada há mais tempo. "Tentada" é o mais recente entre terminar e
 * reservar — uma unidade cuja função morreu no meio reservou e não terminou, e
 * é a reserva que a manda para o fim da fila.
 *
 * Fica de fora a unidade reservada por alguém vivo e a que foi tentada há menos
 * de `minIntervalMs`. Empate desfaz pela chave, para a ordem ser estável.
 */
export function dueUnits(
  units: readonly UnitState[],
  leases: ReadonlyMap<string, LeaseState>,
  now: number,
  opts: { minIntervalMs: number; leaseDeadMs?: number },
): string[] {
  const dead = now - (opts.leaseDeadMs ?? LEASE_DEAD_MS);
  const due: { key: string; attempted: number | null }[] = [];
  for (const unit of units) {
    const lease = leases.get(unit.key);
    const claimed = instant(lease?.claimedAt);
    if (claimed !== null && claimed >= dead) continue;
    const attempted = latest(unit.lastDoneAt, lease?.lastFinishedAt, lease?.lastClaimedAt);
    if (attempted !== null && now - attempted < opts.minIntervalMs) continue;
    due.push({ key: unit.key, attempted });
  }
  return due
    .sort((a, b) => {
      if (a.attempted === null && b.attempted !== null) return -1;
      if (b.attempted === null && a.attempted !== null) return 1;
      if (a.attempted !== null && b.attempted !== null && a.attempted !== b.attempted) return a.attempted - b.attempted;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .map((entry) => entry.key);
}

/**
 * Começar mais uma unidade cabe no orçamento?
 *
 * A primeira sempre começa — uma chamada que não faz nada nunca avançaria a
 * fila. Depois dela, supõe-se que a próxima demora tanto quanto a mais lenta
 * até aqui: uma unidade começada não é interrompida, e passar do teto da
 * plataforma deixa a reserva pendurada até vencer.
 */
export function mayStartAnother(state: { done: number; elapsedMs: number; slowestMs: number }, budgetMs: number): boolean {
  if (state.done === 0) return true;
  return state.elapsedMs + state.slowestMs <= budgetMs;
}

/** Quanto sobra do orçamento, nunca negativo. */
export function remainingBudget(elapsedMs: number, budgetMs: number): number {
  return Math.max(0, budgetMs - elapsedMs);
}

/**
 * As fontes configuradas que estão há mais de `thresholdMs` sem sincronizar.
 *
 * Nunca sincronizada também conta: uma fonte nova que o agendador não alcança é
 * exatamente o defeito que o alarme existe para mostrar. Erro não conta — a
 * fonte foi alcançada, e o erro já aparece na saúde das fontes.
 */
export function staleSources(
  sources: readonly { id: string; lastSyncedAt: string | null }[],
  now: number,
  thresholdMs: number = STALE_SOURCE_ALARM_MS,
): string[] {
  return sources
    .filter((entry) => {
      const at = instant(entry.lastSyncedAt);
      return at === null || now - at > thresholdMs;
    })
    .map((entry) => entry.id)
    .sort();
}
