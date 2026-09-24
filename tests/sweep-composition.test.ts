import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

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
const { candidate, scoreCursor, sourceRun, sweepLease, sweepRun, targetTrack } = await import("../src/core/db/schema.ts");
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
  it("fatia morta no meio não trava a fonte: a execução sem batimento é interrompida e a fonte roda", async () => {
    loadSources.mockResolvedValue([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    syncSource.mockResolvedValue({ ok: true, fetched: 3 });
    await runSweep("sync", { alarm });
    const [primeira] = await getDb().select().from(sourceRun);
    // Uma fatia anterior foi morta pela Vercel: a linha ficou `running`, velha.
    await getDb().update(sourceRun).set({ status: "running", heartbeatAt: "2026-01-01T00:00:00.000Z" }).where(eq(sourceRun.id, primeira!.id));
    await getDb().delete(sweepRun);
    await getDb().delete(sweepLease);

    const report = await runSweep("sync", { alarm });

    expect(report.units.map((u) => [u.unit, u.ok])).toEqual([["sync:greenhouse:acme", true]]);
    const execucoes = await getDb().select().from(sourceRun).orderBy(sourceRun.id);
    expect(execucoes.map((e) => e.status)).toEqual(["interrupted", "succeeded"]);
    expect(execucoes[0]!.id).toBe(primeira!.id);
  });

  it("execução viva de outro processo fica com ele: a fatia cede sem erro e não sincroniza", async () => {
    loadSources.mockResolvedValue([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    syncSource.mockResolvedValue({ ok: true, fetched: 3 });
    await runSweep("sync", { alarm });
    const [primeira] = await getDb().select().from(sourceRun);
    // A tela pediu "Buscar agora" e o GitHub está rodando: batimento fresco.
    await getDb().update(sourceRun).set({ status: "running", heartbeatAt: new Date().toISOString() }).where(eq(sourceRun.id, primeira!.id));
    await getDb().delete(sweepRun);
    await getDb().delete(sweepLease);
    syncSource.mockClear();

    const report = await runSweep("sync", { alarm });

    expect(report.units.map((u) => [u.unit, u.ok, u.items])).toEqual([["sync:greenhouse:acme", true, 0]]);
    expect(syncSource).not.toHaveBeenCalled();
    const execucoes = await getDb().select().from(sourceRun);
    expect(execucoes.map((e) => e.status)).toEqual(["running"]);
  });

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
    // Cada fonte da fatia deixa uma execução (#223), com o resultado dela.
    const execucoes = await getDb().select().from(sourceRun).orderBy(sourceRun.id);
    expect(execucoes.map((e) => [e.sourceId, e.status])).toEqual([
      ["greenhouse:acme", "succeeded"],
      ["lever:beta", "failed"],
    ]);
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

describe("filas de pontuação", () => {
  it("sem-nota pontua pela regra de `scoreCandidate`, com o prazo da chamada, e erro de um não para o outro", async () => {
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

    const before = Date.now();
    const report = await runSweep("sem-nota", { alarm });
    expect(report.items).toBe(1);
    expect(report.errors).toBe(1);
    expect(report.units[1]).toMatchObject({ ok: false, error: "perfil ilegível" });
    const opts = scoreCandidate.mock.calls[0]![1] as { deadline: number };
    expect(opts.deadline).toBeGreaterThan(before);
    expect(opts.deadline).toBeLessThanOrEqual(Date.now() + 20_000);
  });

  it("a fila vem do cursor da trilha principal: sem passada completa é sem-nota, com ela é manutenção", async () => {
    const db = getDb();
    const [novo, antigo] = await db
      .insert(candidate)
      .values([
        { slug: "novo", name: "Novo" },
        { slug: "antigo", name: "Antigo" },
      ])
      .returning({ id: candidate.id });
    const [trilha] = await db
      .insert(targetTrack)
      .values({ candidateId: antigo!.id, name: "Principal", nameKey: "principal", isPrimary: true, position: 0 })
      .returning({ id: targetTrack.id });
    await db.insert(scoreCursor).values({
      candidateId: antigo!.id,
      trackId: trilha!.id,
      profileHash: "h",
      scorerVersion: "v",
      lastCompletedAt: "2026-09-23T10:00:00.000Z",
    });
    scoreCandidate.mockResolvedValue({ perfil: "ja-tinha", scored: 1, topFit: 50 });

    const semNota = await runSweep("sem-nota", { alarm });
    const manutencao = await runSweep("manutencao", { alarm });

    expect(semNota.units.map((u) => u.unit)).toEqual([`pontuacao:${novo!.id}`]);
    expect(manutencao.units.map((u) => u.unit)).toEqual([`pontuacao:${antigo!.id}`]);
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
    expect(report).toMatchObject({ items: 1, errors: 1, detail: { scored: 80, deferred: 1, pending: 3 } });
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
