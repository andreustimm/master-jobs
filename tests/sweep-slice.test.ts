import { describe, expect, it } from "vitest";
import { runSweepSlice, safeError, type RunRow, type SweepDeps, type UnitOutcome } from "../src/contexts/operations/app/sweep.ts";
import type { LeaseState } from "../src/contexts/operations/domain/sweep.ts";

/**
 * A fatia com reserva, métrica e trabalho falsos: o relógio anda quando o
 * trabalho "demora", e é assim que o teste prova o teto de tempo sem esperar.
 */

const START = Date.parse("2026-09-23T12:00:00.000Z");

type Fake = {
  deps: SweepDeps;
  time: { now: number };
  rows: RunRow[];
  leases: Map<string, LeaseState>;
  synced: string[];
  alarms: string[][];
  budgets: number[];
};

function fake(opts: {
  sources?: string[];
  lastSynced?: Record<string, string | null>;
  syncMs?: Record<string, number>;
  syncFails?: Record<string, "throw" | "error">;
  candidates?: number[];
  lose?: string[];
  budgetMs?: number;
} = {}): Fake {
  const time = { now: START };
  const rows: RunRow[] = [];
  const leases = new Map<string, LeaseState>();
  const synced: string[] = [];
  const alarms: string[][] = [];
  const budgets: number[] = [];
  const lastSynced = new Map(Object.entries(opts.lastSynced ?? {}));
  const iso = (ms: number) => new Date(ms).toISOString();

  const deps: SweepDeps = {
    now: () => time.now,
    budgetMs: opts.budgetMs,
    lease: {
      async read(prefix) {
        return new Map([...leases].filter(([key]) => key.startsWith(prefix)));
      },
      async claim(key, at) {
        if (opts.lose?.includes(key)) return false;
        const current = leases.get(key);
        if (current?.claimedAt) return false;
        if (current?.lastFinishedAt && Date.parse(current.lastFinishedAt) >= at.notBefore) return false;
        leases.set(key, { key, claimedAt: iso(at.now), lastClaimedAt: iso(at.now), lastFinishedAt: current?.lastFinishedAt ?? null });
        return true;
      },
      async release(key, now) {
        const current = leases.get(key)!;
        leases.set(key, { ...current, claimedAt: null, lastFinishedAt: iso(now) });
      },
    },
    runs: {
      async record(batch) {
        rows.push(...batch);
      },
      async prune() {},
    },
    sync: {
      async sources() {
        return (opts.sources ?? []).map((id) => ({ id }));
      },
      async lastSynced() {
        return new Map(lastSynced);
      },
      async run(id): Promise<UnitOutcome> {
        time.now += opts.syncMs?.[id] ?? 1_000;
        const failure = opts.syncFails?.[id];
        if (failure === "throw") throw new Error(`adapter de ${id} explodiu`);
        lastSynced.set(id, iso(time.now));
        synced.push(id);
        if (failure === "error") return { ok: false, items: 0, error: "HTTP 500" };
        return { ok: true, items: 10 };
      },
    },
    score: {
      async candidates() {
        return opts.candidates ?? [];
      },
      async run() {
        time.now += 1_000;
        return { ok: true, items: 5 };
      },
    },
    async terms(budget) {
      budgets.push(budget);
      return { items: 2, errors: 1, detail: { claimed: 3 } };
    },
    async capture(budget) {
      budgets.push(budget);
      return { items: 1, errors: 0, detail: {} };
    },
    async recheck(budget) {
      budgets.push(budget);
      return { items: 4, errors: 0, detail: { gone: 1 } };
    },
    async rescore(budget) {
      budgets.push(budget);
      return { items: 1, errors: 0, detail: { scored: 30, deferred: 0, pending: 2 } };
    },
    async alarm(report) {
      alarms.push(report.sources);
    },
  };
  return { deps, time, rows, leases, synced, alarms, budgets };
}

describe("fatia sync", () => {
  it("para de começar fontes quando a próxima não caberia no orçamento", async () => {
    // Cada fonte leva 8 s; com 20 s, a terceira não começa (16 + 8 > 20).
    const f = fake({ sources: ["a", "b", "c", "d"], syncMs: { a: 8_000, b: 8_000, c: 8_000, d: 8_000 } });
    const report = await runSweepSlice("sync", f.deps);

    expect(f.synced).toEqual(["a", "b"]);
    expect(report.durationMs).toBeLessThanOrEqual(20_000);
    expect(report.items).toBe(2);
  });

  it("a primeira fonte sempre roda, mesmo lenta: uma chamada que nada faz nunca avança a fila", async () => {
    const f = fake({ sources: ["b", "a-lenta"], syncMs: { "a-lenta": 25_000 } });
    await runSweepSlice("sync", f.deps);
    expect(f.synced).toEqual(["a-lenta"]);
  });

  it("round-robin: duas chamadas seguidas pegam fontes diferentes, a mais antiga primeiro", async () => {
    const f = fake({
      sources: ["nova", "velha", "media"],
      lastSynced: { velha: "2026-09-23T09:00:00.000Z", media: "2026-09-23T10:00:00.000Z", nova: null },
      syncMs: { nova: 15_000, velha: 15_000, media: 15_000 },
    });
    await runSweepSlice("sync", f.deps);
    f.time.now += 120_000;
    await runSweepSlice("sync", f.deps);
    f.time.now += 120_000;
    await runSweepSlice("sync", f.deps);
    f.time.now += 120_000;
    // Todas acabaram de rodar: a quarta chamada não repete nenhuma.
    await runSweepSlice("sync", f.deps);

    expect(f.synced).toEqual(["nova", "velha", "media"]);
  });

  it("fonte que quebra não derruba as outras, e a reserva é devolvida", async () => {
    const f = fake({ sources: ["a", "b", "c"], syncFails: { a: "throw", b: "error" } });
    const report = await runSweepSlice("sync", f.deps);

    expect(f.synced).toEqual(["b", "c"]);
    expect(report.items).toBe(1);
    expect(report.errors).toBe(2);
    expect(report.units.find((u) => u.unit === "sync:a")).toMatchObject({ ok: false, error: "adapter de a explodiu" });
    for (const key of ["sync:a", "sync:b", "sync:c"]) expect(f.leases.get(key)?.claimedAt).toBeNull();
  });

  it("reserva perdida para outra chamada não é erro: segue para a próxima", async () => {
    const f = fake({ sources: ["a", "b"], lose: ["sync:a"] });
    const report = await runSweepSlice("sync", f.deps);
    expect(f.synced).toEqual(["b"]);
    expect(report.errors).toBe(0);
  });

  it("grava uma linha por chamada e uma por fonte, só com números e ids", async () => {
    const f = fake({ sources: ["a", "b"], syncFails: { b: "error" } });
    await runSweepSlice("sync", f.deps);

    expect(f.rows).toEqual([
      { slice: "sync", unit: null, startedAt: "2026-09-23T12:00:00.000Z", durationMs: 2_000, items: 1, errors: 1, error: null },
      { slice: "sync", unit: "sync:a", startedAt: "2026-09-23T12:00:00.000Z", durationMs: 1_000, items: 10, errors: 0, error: null },
      { slice: "sync", unit: "sync:b", startedAt: "2026-09-23T12:00:00.000Z", durationMs: 1_000, items: 0, errors: 1, error: "HTTP 500" },
    ]);
  });

  it("alarma fonte há mais de duas horas sem sync — uma vez por hora, não a cada chamada", async () => {
    const f = fake({
      sources: ["esquecida", "ok"],
      lastSynced: { esquecida: "2026-09-23T08:00:00.000Z", ok: "2026-09-23T11:50:00.000Z" },
      // A esquecida está reservada por outra chamada viva: esta não a alcança.
      lose: ["sync:esquecida"],
    });
    const first = await runSweepSlice("sync", f.deps);
    f.time.now += 120_000;
    await runSweepSlice("sync", f.deps);

    expect(first.staleSources).toEqual(["esquecida"]);
    expect(f.alarms).toEqual([["esquecida"]]);

    f.time.now += 3_600_000;
    await runSweepSlice("sync", f.deps);
    expect(f.alarms).toHaveLength(2);
  });

  it("fonte sincronizada nesta chamada não aparece no alarme dela", async () => {
    const f = fake({ sources: ["velha"], lastSynced: { velha: "2026-09-23T06:00:00.000Z" } });
    const report = await runSweepSlice("sync", f.deps);
    expect(report.staleSources).toEqual([]);
    expect(f.alarms).toEqual([]);
  });
});

describe("fatia pontuar", () => {
  it("pontua cada candidato no máximo uma vez a cada dez minutos", async () => {
    const f = fake({ candidates: [1, 2] });
    const first = await runSweepSlice("pontuar", f.deps);
    f.time.now += 5 * 60_000;
    const second = await runSweepSlice("pontuar", f.deps);
    f.time.now += 6 * 60_000;
    const third = await runSweepSlice("pontuar", f.deps);

    expect(first.units.map((u) => u.unit)).toEqual(["pontuar:1", "pontuar:2"]);
    expect(second.units).toEqual([]);
    expect(third.units.map((u) => u.unit)).toEqual(["pontuar:1", "pontuar:2"]);
    expect(first.items).toBe(2);
  });
});

describe("fatias de fila", () => {
  it("recebem o que sobra do orçamento e reportam os próprios números", async () => {
    const f = fake({ budgetMs: 18_000 });
    const terms = await runSweepSlice("termos", f.deps);
    await runSweepSlice("captura", f.deps);
    const recheck = await runSweepSlice("reconferencia", f.deps);
    const rescore = await runSweepSlice("repontuar", f.deps);

    expect(f.budgets).toEqual([18_000, 18_000, 18_000, 18_000]);
    expect(terms).toMatchObject({ items: 2, errors: 1, detail: { claimed: 3 } });
    expect(recheck).toMatchObject({ items: 4, detail: { gone: 1 } });
    // A fila de repontuação é uma fatia de fila como as outras (ADR 0026).
    expect(rescore).toMatchObject({ slice: "repontuar", items: 1, detail: { scored: 30, pending: 2 } });
  });

  it("uma fatia que lança ainda deixa a linha de métrica, com o erro", async () => {
    const f = fake();
    f.deps.recheck = async () => {
      throw new Error("Ingestion blocked in preview: preview runs on fixtures only");
    };
    const report = await runSweepSlice("reconferencia", f.deps);

    expect(report.errors).toBe(1);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ slice: "reconferencia", unit: null, errors: 1, error: expect.stringContaining("blocked") });
  });
});

describe("safeError", () => {
  it("tira a query da URL do adapter e redige credencial antes de a mensagem sair", () => {
    const text = safeError(new Error("GET https://api.adzuna.com/v1/api/jobs/br/search/1?app_id=abc&app_key=segredo123 -> 401"));
    expect(text).toContain("https://api.adzuna.com/v1/api/jobs/br/search/1?");
    expect(text).not.toContain("segredo123");
    expect(text).not.toContain("app_id=abc");
    expect(safeError("Bearer tokentoken")).not.toContain("tokentoken");
    expect(safeError("a ".repeat(300))).toHaveLength(500);
  });
});
