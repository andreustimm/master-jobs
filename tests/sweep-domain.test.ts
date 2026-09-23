import { describe, expect, it } from "vitest";
import {
  LEASE_DEAD_MS,
  SWEEP_SLICES,
  dueUnits,
  mayStartAnother,
  parseSweepSlice,
  remainingBudget,
  staleSources,
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

describe("parseSweepSlice", () => {
  it("aceita só as cinco fatias, e nada vira 'tudo'", () => {
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
    const leases = new Map([lease("pontuar:1", { lastFinishedAt: ago(2 * MIN) })]);
    const units = [
      { key: "pontuar:1", lastDoneAt: null },
      { key: "pontuar:2", lastDoneAt: null },
    ];
    expect(dueUnits(units, leases, NOW, { minIntervalMs: 10 * MIN })).toEqual(["pontuar:2"]);
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
