import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runSweep`: a composição da varredura fatiada com os casos de uso reais.
 *
 * O trabalho (sync, fila, pontuação) é dublê — cada um tem suíte própria. O
 * que se prova aqui é a cola: qual função cada fatia chama, com que limites, e
 * que a reserva e a métrica são as do banco de verdade.
 */

const syncSource = vi.fn();
const enqueueStale = vi.fn();
const runVerifyQueue = vi.fn();
const verifyStats = vi.fn();
const runFetchStage = vi.fn();
const runParseStage = vi.fn();
const enqueuePending = vi.fn();
const scoreCandidate = vi.fn();
const loadSources = vi.fn();
const activeTermKeys = vi.fn();
const requestTermCaptures = vi.fn();
const runTermCaptures = vi.fn();
const runScoreQueue = vi.fn();
const scoreQueueStatus = vi.fn();

vi.mock("../src/core/ingest/run.ts", async (orig) => ({ ...(await orig<object>()), syncSource }));
vi.mock("../src/core/ingest/verify-queue.ts", async (orig) => ({
  ...(await orig<object>()),
  enqueueStale,
  runVerifyQueue,
  verifyStats,
}));
vi.mock("../src/core/scrape/fetcher.ts", async (orig) => ({ ...(await orig<object>()), runFetchStage }));
vi.mock("../src/core/scrape/parser.ts", async (orig) => ({ ...(await orig<object>()), runParseStage }));
vi.mock("../src/core/scrape/queue.ts", async (orig) => ({ ...(await orig<object>()), enqueuePending }));
vi.mock("../src/core/scoring/apply.ts", async (orig) => ({ ...(await orig<object>()), scoreCandidate }));
vi.mock("../src/core/scoring/queue.ts", async (orig) => ({ ...(await orig<object>()), runScoreQueue, scoreQueueStatus }));
vi.mock("../src/core/sources/config.ts", async (orig) => ({ ...(await orig<object>()), loadSources }));
vi.mock("../src/contexts/matching/index.ts", async (orig) => ({ ...(await orig<object>()), activeTermKeys }));
vi.mock("../src/contexts/sourcing/index.ts", async (orig) => ({
  ...(await orig<object>()),
  requestTermCaptures,
  runTermCaptures,
}));

const { runSweep } = await import("../src/contexts/operations/index.ts");
const { getDb } = await import("../src/core/db/client.ts");
const { candidate, sweepRun } = await import("../src/core/db/schema.ts");
const { releaseTestDb, useTestDb } = await import("./support/db.ts");

const alarm = vi.fn(async () => {});

beforeEach(async () => {
  await useTestDb();
  vi.clearAllMocks();
  process.env.JHO_ENV = "production";
  process.env.JHO_SOURCE_ALLOWLIST = "greenhouse";
});

afterEach(async () => {
  process.env.JHO_ENV = "local";
  delete process.env.JHO_SOURCE_ALLOWLIST;
  await releaseTestDb();
});

describe("sync", () => {
  it("sincroniza as fontes do YAML pelo mesmo `syncSource` da CLI e grava a métrica", async () => {
    loadSources.mockResolvedValue([
      { kind: "greenhouse", handle: "acme", label: "Acme" },
      { kind: "lever", handle: "beta", label: "Beta" },
    ]);
    syncSource.mockImplementation(async (config: { handle: string }) =>
      config.handle === "acme" ? { ok: true, fetched: 12 } : { ok: false, fetched: 0, error: "HTTP 500" },
    );

    const report = await runSweep("sync", { alarm });

    expect(syncSource).toHaveBeenCalledTimes(2);
    expect(report.units.map((u) => [u.unit, u.ok, u.items])).toEqual([
      ["sync:greenhouse:acme", true, 12],
      ["sync:lever:beta", false, 0],
    ]);
    const rows = await getDb().select().from(sweepRun);
    expect(rows).toHaveLength(3);
    // As duas fontes nunca sincronizaram de verdade (o dublê não grava): alarme.
    expect(alarm).toHaveBeenCalledWith({ kind: "fonte_sem_sync", sources: ["greenhouse:acme", "lever:beta"] });
  });

  it("onde a ingestão é bloqueada, nenhuma fonte é tocada", async () => {
    process.env.JHO_ENV = "staging";
    loadSources.mockResolvedValue([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    await expect(runSweep("sync", { alarm })).rejects.toThrow(/Ingestion blocked/);
    expect(syncSource).not.toHaveBeenCalled();
    expect(loadSources).not.toHaveBeenCalled();
  });
});

describe("pontuar", () => {
  it("pontua cada candidato pela regra de `scoreCandidate`, e erro de um não para o outro", async () => {
    const ids = await getDb()
      .insert(candidate)
      .values([
        { slug: "a", name: "A" },
        { slug: "b", name: "B" },
      ])
      .returning({ id: candidate.id });
    scoreCandidate.mockImplementation(async (id: number) =>
      id === ids[0]!.id ? { perfil: "ja-tinha", scored: 40, topFit: 70 } : { perfil: "derivado", scored: 0, topFit: 0, erro: "perfil ilegível" },
    );

    const report = await runSweep("pontuar", { alarm });
    expect(report.items).toBe(1);
    expect(report.errors).toBe(1);
    expect(report.units[1]).toMatchObject({ ok: false, error: "perfil ilegível" });
  });
});

describe("fatias de fila", () => {
  it("repontuar drena a fila `score_task` dentro do orçamento e diz o que sobrou", async () => {
    runScoreQueue.mockResolvedValue({ processadas: 2, pontuadas: 80, falhas: 1, adiadas: 1, interrompida: true });
    scoreQueueStatus.mockResolvedValue({ pending: 3, done: 5 });

    const report = await runSweep("repontuar", { alarm });

    const opts = runScoreQueue.mock.calls[0]![0] as { budgetMs: number; worker: string };
    expect(opts.budgetMs).toBeGreaterThan(0);
    expect(opts.budgetMs).toBeLessThanOrEqual(20_000);
    expect(opts.worker).toMatch(/^varredura-/);
    expect(report).toMatchObject({ items: 2, errors: 1, detail: { scored: 80, deferred: 1, pending: 3 } });
  });


  it("reconferência só enfileira quando a rodada anterior drenou, e drena com teto de tempo", async () => {
    verifyStats.mockResolvedValueOnce({ done: 3 }).mockResolvedValueOnce({ pending: 2 });
    enqueueStale.mockResolvedValue(7);
    runVerifyQueue.mockResolvedValue({ checked: 5, gone: 1, alive: 3, inconclusive: 1 });

    const first = await runSweep("reconferencia", { alarm });
    const second = await runSweep("reconferencia", { alarm });

    expect(enqueueStale).toHaveBeenCalledTimes(1);
    expect(first.detail).toMatchObject({ queued: 7, gone: 1 });
    expect(second.detail).toMatchObject({ queued: 0 });
    const opts = runVerifyQueue.mock.calls[0]![0] as { budgetMs: number };
    expect(opts.budgetMs).toBeGreaterThan(0);
    expect(opts.budgetMs).toBeLessThanOrEqual(20_000);
  });

  it("captura faz uma onda curta: quatro páginas, teto por página, e trata o que chegou", async () => {
    enqueuePending.mockResolvedValue({ queued: 3, alreadyDescribed: 0 });
    runFetchStage.mockResolvedValue({ processed: 4, stored: 3, blocked: 0, failed: 1 });
    runParseStage.mockResolvedValue({ processed: 3, parsed: 2, failed: 1, rescored: 0 });

    const report = await runSweep("captura", { alarm });

    expect(runFetchStage).toHaveBeenCalledWith({ concurrency: 4, limit: 4, timeoutMs: 10_000 });
    expect(report).toMatchObject({ items: 5, errors: 2, detail: { queued: 3, stored: 3, parsed: 2 } });
  });

  it("termos pede as capturas do dia e drena dentro do orçamento, só com agregados", async () => {
    activeTermKeys.mockResolvedValue([{ termKey: "k1", query: "staff engineer" }]);
    requestTermCaptures.mockResolvedValue({ enqueued: 1, existing: 0, skipped: null });
    runTermCaptures.mockResolvedValue({
      remotive: { claimed: 2, succeeded: 1, waiting: 0, failed: 1, created: 4, known: 0 },
      himalayas: { claimed: 1, succeeded: 0, waiting: 1, failed: 0, created: 0, known: 0 },
    });

    const report = await runSweep("termos", { alarm });

    expect(requestTermCaptures).toHaveBeenCalledWith(expect.objectContaining({ termKey: "k1", origin: "sweep" }));
    expect(report).toMatchObject({ items: 1, errors: 1, detail: { claimed: 3, waiting: 1, created: 4 } });
    const opts = runTermCaptures.mock.calls[0]![0] as { budgetMs: number; waitMs?: number };
    expect(opts.waitMs).toBeUndefined();
    expect(opts.budgetMs).toBeLessThanOrEqual(20_000);
  });
});
