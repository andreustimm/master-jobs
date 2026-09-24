import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEASE_DEAD_MS,
  MAINTENANCE_CADENCE_MS,
  NO_SCORE_CADENCE_MS,
  SCORE_QUEUE_MIN_INTERVAL_MS,
  SWEEP_SLICES,
  dueUnits,
  mayStartAnother,
  parseSweepSlice,
  remainingBudget,
  staleSources,
  sweepEnvironmentAllowed,
  type LeaseState,
} from "../src/contexts/operations/domain/sweep.ts";
import { authorizeCronRequest } from "../src/contexts/auth/index.ts";

/**
 * As decisões da varredura fatiada (ADR 0025), sem banco nem relógio.
 *
 * O round-robin é a garantia de cobertura: com ~48 fontes e 30 chamadas por
 * hora, uma ordem que favorecesse sempre as mesmas deixaria a cauda sem sync —
 * e é a cauda que o alarme de duas horas existe para pegar.
 */

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

function lease(key: string, patch: Partial<LeaseState>): [string, LeaseState] {
  return [key, { key, claimedAt: null, lastClaimedAt: null, lastFinishedAt: null, ...patch }];
}

describe("cadência das filas de pontuação (#288)", () => {
  it("sem-nota a cada 10 min e manutenção de hora em hora, com folga que não recusa a própria agenda", () => {
    expect(NO_SCORE_CADENCE_MS).toBe(10 * MIN);
    expect(MAINTENANCE_CADENCE_MS).toBe(60 * MIN);
    for (const [queue, cadence] of [
      ["sem-nota", NO_SCORE_CADENCE_MS],
      ["manutencao", MAINTENANCE_CADENCE_MS],
    ] as const) {
      const interval = SCORE_QUEUE_MIN_INTERVAL_MS[queue];
      // A chamada anterior terminou até 25 s depois de começar e o `pg_net`
      // atrasa segundos: a agenda seguinte ainda precisa passar.
      expect(interval, queue).toBeLessThanOrEqual(cadence - 25_000);
      // E uma chamada extra no meio do intervalo não repete o candidato.
      expect(interval, queue).toBeGreaterThan(cadence / 2);
    }
  });

  it("a agenda do SQL chama cada fila na cadência do domínio", () => {
    const sql = readFileSync("supabase/cron/varredura.sql", "utf8");
    expect(sql).toMatch(/cron\.schedule\('jho-varredura-sem-nota', '5-55\/10 \* \* \* \*', \$\$select jho_cron\.chamar_fatia\('sem-nota'\)\$\$\)/);
    expect(sql).toMatch(/cron\.schedule\('jho-varredura-manutencao', '11 \* \* \* \*', \$\$select jho_cron\.chamar_fatia\('manutencao'\)\$\$\)/);
    // A agenda substituída sai ao reaplicar, e nenhuma chama a fatia que não existe mais.
    expect(sql).toMatch(/cron\.unschedule\(jobname\) from cron\.job where jobname in \('jho-varredura-pontuar'\)/);
    expect(sql).not.toMatch(/chamar_fatia\('pontuar'\)/);
    // Toda fatia agendada é uma fatia que a rota aceita.
    for (const [, slice] of sql.matchAll(/chamar_fatia\('([^']+)'\)/g)) {
      expect(parseSweepSlice(slice), slice).toEqual({ ok: true, slice });
    }
  });

  it("o SQL só se aplica ao projeto de produção", () => {
    const sql = readFileSync("supabase/cron/varredura.sql", "utf8");
    expect(sql).toContain("SÓ NO PROJETO SUPABASE DE PRODUÇÃO");
    const guard = sql.indexOf("raise exception");
    expect(guard).toBeGreaterThan(0);
    // A trava vem antes de qualquer função ou agenda.
    expect(guard).toBeLessThan(sql.indexOf("create or replace function"));
    expect(guard).toBeLessThan(sql.indexOf("cron.schedule("));
  });
});

describe("sweepEnvironmentAllowed — a varredura só roda em produção (#288)", () => {
  it("produção declarada por qualquer uma das duas variáveis, ou pelas duas", () => {
    expect(sweepEnvironmentAllowed({ jhoEnv: "production" })).toEqual({ allowed: true });
    expect(sweepEnvironmentAllowed({ vercelEnv: "production" })).toEqual({ allowed: true });
    expect(sweepEnvironmentAllowed({ jhoEnv: " Production ", vercelEnv: "production" })).toEqual({ allowed: true });
  });

  it("qualquer outro ambiente, ou nenhum declarado, recusa", () => {
    for (const env of [
      {},
      { jhoEnv: "", vercelEnv: " " },
      { vercelEnv: "preview" },
      { jhoEnv: "staging" },
      { jhoEnv: "dev" },
      { jhoEnv: "local" },
      { jhoEnv: "producao" },
    ]) {
      expect(sweepEnvironmentAllowed(env).allowed, JSON.stringify(env)).toBe(false);
    }
  });

  it("declarações em conflito recusam: `JHO_ENV=production` não promove um preview", () => {
    expect(sweepEnvironmentAllowed({ jhoEnv: "production", vercelEnv: "preview" })).toEqual({
      allowed: false,
      environment: "preview",
    });
  });
});

describe("parseSweepSlice", () => {
  it("aceita só as fatias declaradas, e nada vira 'tudo'", () => {
    for (const slice of SWEEP_SLICES) expect(parseSweepSlice(slice)).toEqual({ ok: true, slice });
    for (const value of ["", "tudo", "SYNC", " sync", "recheck", null, undefined, 1, {}]) {
      expect(parseSweepSlice(value)).toEqual({ ok: false });
    }
  });
});

describe("dueUnits — round-robin pela tentativa mais antiga", () => {
  it("nunca tentada primeiro, depois a mais antiga, empate pela chave", () => {
    const units = [
      { key: "sync:c", lastDoneAt: ago(50 * MIN) },
      { key: "sync:b", lastDoneAt: null },
      { key: "sync:a", lastDoneAt: ago(90 * MIN) },
      { key: "sync:d", lastDoneAt: null },
    ];
    expect(dueUnits(units, new Map(), NOW, { minIntervalMs: 45 * MIN })).toEqual(["sync:b", "sync:d", "sync:a", "sync:c"]);
  });

  it("não repete o que terminou há menos do intervalo mínimo", () => {
    const units = [
      { key: "sync:recente", lastDoneAt: ago(10 * MIN) },
      { key: "sync:velha", lastDoneAt: ago(46 * MIN) },
    ];
    expect(dueUnits(units, new Map(), NOW, { minIntervalMs: 45 * MIN })).toEqual(["sync:velha"]);
  });

  it("o término registrado na reserva conta tanto quanto o da tabela da unidade", () => {
    const leases = new Map([lease("pontuacao:1", { lastFinishedAt: ago(2 * MIN) })]);
    const units = [
      { key: "pontuacao:1", lastDoneAt: null },
      { key: "pontuacao:2", lastDoneAt: null },
    ];
    expect(dueUnits(units, leases, NOW, { minIntervalMs: 10 * MIN })).toEqual(["pontuacao:2"]);
  });

  it("reserva viva fica de fora; reserva de função morta volta — no fim da fila", () => {
    const leases = new Map([
      lease("sync:viva", { claimedAt: ago(10_000), lastClaimedAt: ago(10_000) }),
      // Morta há uma hora: reservou, nunca terminou.
      lease("sync:morta", { claimedAt: ago(60 * MIN), lastClaimedAt: ago(60 * MIN) }),
    ]);
    const units = [
      { key: "sync:viva", lastDoneAt: null },
      { key: "sync:morta", lastDoneAt: null },
      { key: "sync:velha", lastDoneAt: ago(3 * 60 * MIN) },
    ];
    // A morta nunca terminou, mas a tentativa conta: vai depois da que
    // terminou há três horas, e não na frente de todas.
    expect(dueUnits(units, leases, NOW, { minIntervalMs: 45 * MIN })).toEqual(["sync:velha", "sync:morta"]);
  });

  it("uma unidade que acabou de morrer espera o intervalo, para não matar a próxima chamada", () => {
    const deadAt = ago(LEASE_DEAD_MS + 1_000);
    const leases = new Map([lease("sync:pesada", { claimedAt: deadAt, lastClaimedAt: deadAt })]);
    expect(dueUnits([{ key: "sync:pesada", lastDoneAt: null }], leases, NOW, { minIntervalMs: 45 * MIN })).toEqual([]);
  });

  it("data ilegível é tratada como nunca tentada, não como erro", () => {
    expect(dueUnits([{ key: "sync:x", lastDoneAt: "ontem" }], new Map(), NOW, { minIntervalMs: MIN })).toEqual(["sync:x"]);
  });
});

describe("orçamento da chamada", () => {
  it("a primeira unidade sempre começa; as seguintes só se couberem pela mais lenta", () => {
    expect(mayStartAnother({ done: 0, elapsedMs: 50_000, slowestMs: 0 }, 20_000)).toBe(true);
    expect(mayStartAnother({ done: 1, elapsedMs: 8_000, slowestMs: 8_000 }, 20_000)).toBe(true);
    expect(mayStartAnother({ done: 2, elapsedMs: 16_000, slowestMs: 8_000 }, 20_000)).toBe(false);
  });

  it("o que sobra nunca é negativo", () => {
    expect(remainingBudget(5_000, 20_000)).toBe(15_000);
    expect(remainingBudget(25_000, 20_000)).toBe(0);
  });
});

describe("staleSources — alarme de duas horas", () => {
  it("pega a fonte velha e a nunca sincronizada, em ordem estável", () => {
    const sources = [
      { id: "b:velha", lastSyncedAt: ago(3 * 60 * MIN) },
      { id: "a:nunca", lastSyncedAt: null },
      { id: "c:fresca", lastSyncedAt: ago(30 * MIN) },
    ];
    expect(staleSources(sources, NOW)).toEqual(["a:nunca", "b:velha"]);
  });

  it("exatamente no limite ainda não alarma", () => {
    expect(staleSources([{ id: "x", lastSyncedAt: ago(2 * 60 * MIN) }], NOW)).toEqual([]);
  });
});

describe("authorizeCronRequest — o cron por segredo", () => {
  it("sem segredo configurado, fecha com 503", () => {
    expect(authorizeCronRequest("Bearer x", undefined)).toMatchObject({ ok: false, status: 503 });
    expect(authorizeCronRequest("Bearer  ", " ")).toMatchObject({ ok: false, status: 503 });
  });

  it("só aceita exatamente `Bearer <segredo>`", () => {
    const secret = "segredo-de-verdade";
    expect(authorizeCronRequest(`Bearer ${secret}`, secret)).toEqual({ ok: true });
    for (const header of [null, "", secret, `bearer ${secret}`, "Bearer segredo", `Bearer ${secret}-e-mais`, `Bearer ${secret} `]) {
      expect(authorizeCronRequest(header, secret), String(header)).toMatchObject({ ok: false, status: 401 });
    }
  });
});
