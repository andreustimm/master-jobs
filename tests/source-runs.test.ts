/**
 * Execuções de captura e verificação no PostgreSQL (#223, tarefa 02).
 *
 * IT-003 idempotência concorrente e imutabilidade · IT-004 execução-filha do
 * sync · IT-005 "todas", nova tentativa e interrupção · IT-006 despacho sem
 * credencial e erro redigido.
 *
 * Fronteira FORA: HTTP de fonte (porta dublê) e quem executa (porta de
 * despacho dublê). Repositórios e domínio são os reais.
 */
import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  executeSourceRun,
  interruptStaleSourceRuns,
  requestSourceRun,
  retrySourceRun,
  sourceRun,
  sourceRunChildren,
  sourceRuns,
} from "../src/contexts/operations/index.ts";
import { executeRun, requestRun, type CatalogReader, type RunStore } from "../src/contexts/operations/app/source-runs.ts";
import * as runs from "../src/contexts/operations/infra/drizzle-source-runs.ts";
import type { WorkflowDispatchPort } from "../src/contexts/operations/ports.ts";
import { editCatalogSource, retireSource } from "../src/contexts/sourcing/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { application, candidate, job, source, sourceRun as sourceRunTable } from "../src/core/db/schema.ts";
import { ensureSources } from "../src/core/ingest/run.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  delete process.env.GITHUB_DISPATCH_TOKEN;
});

afterEach(async () => {
  resetHttpPort();
  await releaseTestDb();
});

const greenhouse = (ids: number[]) => ({
  "boards-api.greenhouse.io": {
    jobs: ids.map((id) => ({ id, title: `Vaga ${id}`, absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}`, content: "" })),
  },
});

async function catalogo(): Promise<void> {
  await ensureSources([
    { kind: "greenhouse", handle: "acme", label: "Acme" },
    { kind: "lever", handle: "globex", label: "Globex" },
  ]);
}

const store: RunStore = {
  createOrJoin: (input) => runs.createOrJoinRun(input),
  get: runs.getRun,
  children: runs.childRuns,
  transition: runs.transitionRun,
  note: runs.noteRun,
  heartbeat: runs.heartbeatRun,
  running: runs.runningRuns,
  orphans: runs.orphanedQueuedChildren,
};

describe("IT-003 idempotência concorrente e imutabilidade", () => {
  it("dois pedidos equivalentes ao mesmo tempo geram uma execução", async () => {
    await catalogo();
    const scope = { kind: "source" as const, sourceId: "greenhouse:acme" };

    const [a, b] = await Promise.all([requestSourceRun(scope, null), requestSourceRun(scope, null)]);

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.runId).toBe(b.runId);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect((await db.select({ n: count() }).from(sourceRunTable))[0]!.n).toBe(1);
  });

  it("fonte desabilitada ou aposentada recusa sem criar execução", async () => {
    await catalogo();
    await editCatalogSource("greenhouse:acme", { enabled: false }, "2026-09-23T12:00:00.000Z");
    await retireSource("lever:globex", "2026-09-23T12:00:00.000Z");

    expect(await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null)).toEqual({ ok: false, code: "source_disabled" });
    expect(await requestSourceRun({ kind: "source", sourceId: "lever:globex" }, null)).toEqual({ ok: false, code: "source_retired" });
    expect(await requestSourceRun({ kind: "source", sourceId: "manual:x" }, null)).toEqual({ ok: false, code: "source_not_found" });
    expect(await db.select().from(sourceRunTable)).toEqual([]);
  });

  it("linha terminal não muda: UPDATE afeta zero linhas e resultado atrasado não sobrescreve", async () => {
    await catalogo();
    setHttpPort(fixtureHttp(greenhouse([1])));
    const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!pedido.ok) throw new Error("pedido recusado");
    await executeSourceRun(pedido.runId);
    const antes = await sourceRun(pedido.runId);
    expect(antes?.status).toBe("succeeded");

    // Um executor atrasado tentando terminar de novo.
    expect(await runs.transitionRun(pedido.runId, "running", "failed", { errorCode: "tarde" })).toBe(false);
    expect(await runs.transitionRun(pedido.runId, "succeeded" as never, "failed")).toBe(false);
    expect(await runs.noteRun(pedido.runId, "tarde")).toBe(false);
    // Nova execução do mesmo id também não pega a linha.
    expect(await executeSourceRun(pedido.runId)).toEqual({ ok: false, code: "not_queued" });

    expect(await sourceRun(pedido.runId)).toEqual(antes);
  });

  it("com a anterior terminada, o mesmo pedido cria outra execução", async () => {
    await catalogo();
    setHttpPort(fixtureHttp(greenhouse([1])));
    const primeira = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!primeira.ok) throw new Error("recusado");
    await executeSourceRun(primeira.runId);
    const segunda = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    expect(segunda).toMatchObject({ ok: true, created: true });
    if (segunda.ok) expect(segunda.runId).not.toBe(primeira.runId);
  });
});

describe("IT-004 execução-filha gravada pelo sync", () => {
  it("grava contagens, completude e o retrato, sem tocar em candidatura", async () => {
    await catalogo();
    const [pessoa] = await db.insert(candidate).values({ slug: "ana", name: "Ana" }).returning({ id: candidate.id });
    setHttpPort(fixtureHttp(greenhouse([1])));
    const primeira = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!primeira.ok) throw new Error("recusado");
    await executeSourceRun(primeira.runId);
    const [vaga] = await db.select({ id: job.id }).from(job);
    await db.insert(application).values({ candidateId: pessoa!.id, jobId: vaga!.id, status: "applied" });
    const candidaturas = await db.select().from(application);

    setHttpPort(fixtureHttp(greenhouse([2, 3])));
    const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!pedido.ok) throw new Error("recusado");
    const resultado = await executeSourceRun(pedido.runId);

    expect(resultado).toMatchObject({ ok: true, status: "succeeded" });
    expect(await sourceRun(pedido.runId)).toMatchObject({
      scopeKind: "source",
      sourceId: "greenhouse:acme",
      status: "succeeded",
      fetched: 2,
      inserted: 2,
      unchanged: 0,
      // Lista completa: a vaga 1 sumiu e fecha por ausência.
      closed: 1,
      alive: null,
      inconclusive: null,
      completeness: "complete",
      configSnapshot: { sources: [expect.objectContaining({ id: "greenhouse:acme", kind: "greenhouse", revision: 1 })] },
    });
    const snapshot = JSON.stringify((await sourceRun(pedido.runId))!.configSnapshot);
    expect(snapshot).not.toContain("secret");
    // Ingestão nunca escreve em `application` (G02).
    expect(await db.select().from(application)).toEqual(candidaturas);
  });

  it("janela parcial registra closed = 0", async () => {
    await ensureSources([{ kind: "arbeitnow", handle: "all", label: "Arbeitnow" }]);
    const vaga = (slug: string) => ({ slug, company_name: "Beta", title: `Vaga ${slug}`, url: `https://www.arbeitnow.com/jobs/${slug}` });
    setHttpPort(fixtureHttp({ "www.arbeitnow.com": { data: [vaga("a"), vaga("b")] } }));
    const primeira = await requestSourceRun({ kind: "source", sourceId: "arbeitnow:all" }, null);
    if (!primeira.ok) throw new Error("recusado");
    await executeSourceRun(primeira.runId);

    setHttpPort(fixtureHttp({ "www.arbeitnow.com": { data: [vaga("c")] } }));
    const segunda = await requestSourceRun({ kind: "source", sourceId: "arbeitnow:all" }, null);
    if (!segunda.ok) throw new Error("recusado");
    await executeSourceRun(segunda.runId);

    expect(await sourceRun(segunda.runId)).toMatchObject({ completeness: "partial", closed: 0, fetched: 1 });
    expect((await db.select().from(job)).filter((j) => j.closedAt !== null)).toEqual([]);
  });

  it("falha da fonte vira `failed` com contagem desconhecida e erro limitado", async () => {
    await catalogo();
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { status: 503 } }));
    const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!pedido.ok) throw new Error("recusado");

    await executeSourceRun(pedido.runId);

    const linha = await sourceRun(pedido.runId);
    expect(linha).toMatchObject({ status: "failed", fetched: null, inserted: null, closed: null, errorCode: "work_failed" });
    expect(linha!.errorDetail!.length).toBeLessThanOrEqual(500);
  });

  it("lista de execuções é paginada, mais recente primeiro, só as de topo", async () => {
    await catalogo();
    setHttpPort(fixtureHttp(greenhouse([1])));
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
      if (!pedido.ok) throw new Error("recusado");
      await executeSourceRun(pedido.runId);
      ids.push(pedido.runId);
    }

    const pagina1 = await sourceRuns({ limit: 2, offset: 0 });
    const pagina2 = await sourceRuns({ limit: 2, offset: 2 });

    expect(pagina1.total).toBe(3);
    expect([...pagina1.rows, ...pagina2.rows].map((r) => r.id)).toEqual([...ids].reverse());
  });
});

describe("IT-005 todas, nova tentativa e interrupção", () => {
  it("usa o retrato do pedido; filha que falha deixa o pai partial", async () => {
    await catalogo();
    const pedido = await requestSourceRun({ kind: "all" }, null);
    if (!pedido.ok) throw new Error("recusado");
    // Desligar depois do pedido vale para a PRÓXIMA execução, não para esta.
    await editCatalogSource("lever:globex", { enabled: false }, "2026-09-23T12:00:00.000Z");
    // Só o Greenhouse tem fixture: o Lever falha.
    setHttpPort(fixtureHttp(greenhouse([1])));

    const resultado = await executeSourceRun(pedido.runId, { concurrency: 1 });

    expect(resultado).toMatchObject({ ok: true, status: "partial" });
    const filhas = await sourceRunChildren(pedido.runId);
    expect(filhas.map((f) => [f.sourceId, f.status])).toEqual([
      ["greenhouse:acme", "succeeded"],
      ["lever:globex", "failed"],
    ]);
    expect(filhas[0]).toMatchObject({ fetched: 1, inserted: 1 });
    // Pai: desconhecido onde uma filha não contou, nunca zero.
    expect(await sourceRun(pedido.runId)).toMatchObject({ status: "partial", fetched: null, errorCode: "children_failed" });
    // A lista de topo não mostra as filhas.
    expect((await sourceRuns({ limit: 10, offset: 0 })).rows.map((r) => r.id)).toEqual([pedido.runId]);

    const proxima = await requestSourceRun({ kind: "all" }, null);
    if (!proxima.ok) throw new Error("recusado");
    expect((await sourceRun(proxima.runId))!.configSnapshot).toMatchObject({
      sources: [expect.objectContaining({ id: "greenhouse:acme" })],
    });
    expect(((await sourceRun(proxima.runId))!.configSnapshot as { sources: unknown[] }).sources).toHaveLength(1);
  });

  it("nova tentativa liga à original, que não muda, e dois cliques dão a mesma tentativa", async () => {
    await catalogo();
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { status: 503 } }));
    const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!pedido.ok) throw new Error("recusado");
    await executeSourceRun(pedido.runId);
    const original = await sourceRun(pedido.runId);

    const [t1, t2] = await Promise.all([retrySourceRun(pedido.runId, null), retrySourceRun(pedido.runId, null)]);
    if (!t1.ok || !t2.ok) throw new Error("tentativa recusada");
    expect(t1.runId).toBe(t2.runId);

    setHttpPort(fixtureHttp(greenhouse([1])));
    await executeSourceRun(t1.runId);

    expect(await sourceRun(t1.runId)).toMatchObject({ retryOf: pedido.runId, status: "succeeded", configSnapshot: original!.configSnapshot });
    expect(await sourceRun(pedido.runId)).toEqual(original);
    expect(await retrySourceRun(t1.runId, null)).toEqual({ ok: false, code: "not_retryable" });
    expect(await retrySourceRun(999_999, null)).toEqual({ ok: false, code: "run_not_found" });
  });

  it("running sem batimento além do lease vira interrupted e libera novo pedido", async () => {
    await catalogo();
    const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!pedido.ok) throw new Error("recusado");
    await db
      .update(sourceRunTable)
      .set({ status: "running", startedAt: "2026-01-01T00:00:00.000Z", heartbeatAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(sourceRunTable.id, pedido.runId));

    expect(await interruptStaleSourceRuns()).toEqual([pedido.runId]);
    expect(await sourceRun(pedido.runId)).toMatchObject({ status: "interrupted", errorCode: "lease_expired" });

    const de_novo = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    expect(de_novo).toMatchObject({ ok: true, created: true });
  });
});

describe("IT-006 despacho sem credencial e erro redigido", () => {
  it("sem credencial, a execução fica queued com o motivo", async () => {
    await catalogo();
    const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!pedido.ok) throw new Error("recusado");
    expect(await sourceRun(pedido.runId)).toMatchObject({ status: "queued", errorCode: "no_token" });
  });

  it("recusa do executor vira failed com detalhe limitado e sem segredo", async () => {
    await catalogo();
    const catalog: CatalogReader = {
      async source(id) {
        const [row] = await db.select().from(source).where(eq(source.id, id));
        return row ? { ...row, revision: row.configRevision ?? 1, capabilities: {} } : null;
      },
      async eligible() {
        return [];
      },
    };
    const recusa: WorkflowDispatchPort = { configured: () => true, dispatch: async () => ({ ok: false, code: "rejected", status: 422 }) };
    const pedidos: unknown[] = [];
    const registra: WorkflowDispatchPort = {
      configured: () => true,
      dispatch: async (request) => {
        pedidos.push(request);
        return { ok: true };
      },
    };

    const recusado = await requestRun(
      { scope: { kind: "source", sourceId: "greenhouse:acme" }, actorUserId: null },
      { runs: store, catalog, runner: recusa, now: () => "2026-09-23T12:00:00.000Z" },
    );
    if (!recusado.ok) throw new Error("recusado");
    const linha = await sourceRun(recusado.runId);
    expect(linha).toMatchObject({ status: "failed", errorCode: "dispatch_rejected" });
    expect(linha!.errorDetail).toContain("422");
    expect(linha!.errorDetail!.length).toBeLessThanOrEqual(500);

    const aceito = await requestRun(
      { scope: { kind: "verify", sourceId: "greenhouse:acme" }, actorUserId: null },
      { runs: store, catalog, runner: registra, now: () => "2026-09-23T12:00:00.000Z" },
    );
    if (!aceito.ok) throw new Error("recusado");
    // A porta recebe rotina, fonte e execução.
    expect(pedidos).toEqual([{ routine: "recheck", source: "greenhouse:acme", run: aceito.runId }]);
    expect(await sourceRun(aceito.runId)).toMatchObject({ status: "queued", errorCode: null });
  });
});

describe("IT-006 execução enfileirada sem executor não segura a chave", () => {
  const catalog: CatalogReader = {
    async source(id) {
      const [row] = await db.select().from(source).where(eq(source.id, id));
      return row ? { ...row, revision: row.configRevision ?? 1, capabilities: {} } : null;
    },
    async eligible() {
      return [];
    },
  };
  const now = () => new Date().toISOString();

  it("sem credencial, o próximo pedido despacha a MESMA execução quando a credencial existe", async () => {
    await catalogo();
    const primeira = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!primeira.ok) throw new Error("recusado");
    expect(await sourceRun(primeira.runId)).toMatchObject({ status: "queued", errorCode: "no_token" });

    const pedidos: unknown[] = [];
    const comToken: WorkflowDispatchPort = { configured: () => true, dispatch: async (r) => (pedidos.push(r), { ok: true }) };
    const segunda = await requestRun(
      { scope: { kind: "source", sourceId: "greenhouse:acme" }, actorUserId: null },
      { runs: store, catalog, runner: comToken, now },
    );

    expect(segunda).toMatchObject({ ok: true, created: false, runId: primeira.runId });
    expect(pedidos).toEqual([{ routine: "sync", source: "greenhouse:acme", run: primeira.runId }]);
    expect(await sourceRun(primeira.runId)).toMatchObject({ status: "queued", errorCode: null });
  });

  it("despacho que falha na rede deixa o motivo, redigido, e o próximo pedido tenta de novo", async () => {
    await catalogo();
    let tentativas = 0;
    const quebrado: WorkflowDispatchPort = {
      configured: () => true,
      dispatch: async () => {
        tentativas++;
        throw new Error("fetch failed https://api.github.com/x?token=segredo");
      },
    };
    const deps = { runs: store, catalog, runner: quebrado, now };
    const a = await requestRun({ scope: { kind: "source", sourceId: "greenhouse:acme" }, actorUserId: null }, deps);
    const b = await requestRun({ scope: { kind: "source", sourceId: "greenhouse:acme" }, actorUserId: null }, deps);
    if (!a.ok || !b.ok) throw new Error("recusado");
    expect(b.runId).toBe(a.runId);
    expect(tentativas).toBe(2);
    const linha = await sourceRun(a.runId);
    expect(linha).toMatchObject({ status: "queued", errorCode: "dispatch_failed" });
    expect(linha!.errorDetail).not.toContain("segredo");
  });

  it("fonte da captura por termo e fonte manual ficam fora, mesmo habilitadas", async () => {
    await db.insert(source).values([
      { id: "remotive:~terms", kind: "remotive", handle: "~terms", label: "Termos", enabled: true },
      { id: "manual:sample", kind: "manual", handle: "sample", label: "Fixture", enabled: true },
    ]);
    expect(await requestSourceRun({ kind: "source", sourceId: "remotive:~terms" }, null)).toEqual({ ok: false, code: "source_not_found" });
    expect(await requestSourceRun({ kind: "verify", sourceId: "manual:sample" }, null)).toEqual({ ok: false, code: "source_not_found" });
    expect(await db.select().from(sourceRunTable)).toEqual([]);
  });
});

describe("IT-005 nova tentativa de todas e batimento", () => {
  it("nova tentativa de todas não captura a fonte aposentada depois do pedido", async () => {
    await catalogo();
    setHttpPort(fixtureHttp(greenhouse([1])));
    const pedido = await requestSourceRun({ kind: "all" }, null);
    if (!pedido.ok) throw new Error("recusado");
    await executeSourceRun(pedido.runId, { concurrency: 1 });
    await retireSource("lever:globex", "2026-09-23T12:00:00.000Z");

    const tentativa = await retrySourceRun(pedido.runId, null);
    if (!tentativa.ok) throw new Error("recusado");
    const snapshot = (await sourceRun(tentativa.runId))!.configSnapshot as { sources: { id: string }[] };
    expect(snapshot.sources.map((s) => s.id)).toEqual(["greenhouse:acme"]);
  });

  it("execução que foi dada por morta no meio não grava por cima e avisa", async () => {
    await catalogo();
    const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!pedido.ok) throw new Error("recusado");
    const deps = {
      runs: store,
      now: () => new Date().toISOString(),
      concurrency: 1,
      heartbeatEveryMs: 5,
      async work() {
        // Outro processo dá a execução por morta enquanto ela trabalha.
        await db.update(sourceRunTable).set({ status: "interrupted" }).where(eq(sourceRunTable.id, pedido.runId));
        return { ok: true, counts: { fetched: 1, inserted: 1, updated: 0, unchanged: 0, closed: 0, alive: null, inconclusive: null }, completeness: "complete" };
      },
    };
    expect(await executeRun(pedido.runId, deps)).toEqual({ ok: false, code: "lost_lease" });
    expect(await sourceRun(pedido.runId)).toMatchObject({ status: "interrupted", fetched: null });
  });

  it("o batimento sobe enquanto a fonte trabalha", async () => {
    await catalogo();
    const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!pedido.ok) throw new Error("recusado");
    let batimentos: (string | null)[] = [];
    const deps = {
      runs: store,
      now: () => new Date().toISOString(),
      concurrency: 1,
      heartbeatEveryMs: 10,
      async work() {
        const antes = (await sourceRun(pedido.runId))!.heartbeatAt;
        await new Promise((r) => setTimeout(r, 80));
        batimentos = [antes, (await sourceRun(pedido.runId))!.heartbeatAt];
        return { ok: true, counts: { fetched: 0, inserted: 0, updated: 0, unchanged: 0, closed: 0, alive: null, inconclusive: null }, completeness: "complete" };
      },
    };
    await executeRun(pedido.runId, deps);
    expect(batimentos[1]! > batimentos[0]!).toBe(true);
  });
});

describe("UT-008/IT-005 teto de filhas, órfãs e lease no pedido", () => {
  async function tres(): Promise<void> {
    await ensureSources([
      { kind: "greenhouse", handle: "a", label: "A" },
      { kind: "greenhouse", handle: "b", label: "B" },
      { kind: "greenhouse", handle: "c", label: "C" },
    ]);
  }

  it("filhas além do teto esperam na fila com o motivo, e nunca passam do teto", async () => {
    await tres();
    const pedido = await requestSourceRun({ kind: "all" }, null);
    if (!pedido.ok) throw new Error("recusado");
    let emVoo = 0;
    let pico = 0;
    const motivos: (string | null)[][] = [];
    await executeRun(pedido.runId, {
      runs: store,
      now: () => new Date().toISOString(),
      concurrency: 1,
      async work() {
        emVoo++;
        pico = Math.max(pico, emVoo);
        motivos.push((await db.select().from(sourceRunTable).where(eq(sourceRunTable.status, "queued"))).map((r) => r.errorCode));
        await new Promise((r) => setTimeout(r, 5));
        emVoo--;
        return { ok: true, counts: { fetched: 0, inserted: 0, updated: 0, unchanged: 0, closed: 0, alive: null, inconclusive: null }, completeness: "complete" };
      },
    });
    expect(pico).toBe(1);
    expect(motivos[0]).toEqual(["waiting_slot", "waiting_slot"]);
  });

  it("filha que esperava vaga de um pai que já acabou é cancelada com o motivo", async () => {
    await tres();
    const pedido = await requestSourceRun({ kind: "all" }, null);
    if (!pedido.ok) throw new Error("recusado");
    const [filha] = await db
      .insert(sourceRunTable)
      .values({
        scopeKind: "source",
        sourceId: "greenhouse:a",
        parentId: pedido.runId,
        idempotencyKey: "filha-orfa",
        configSnapshot: { sources: [] },
        status: "queued",
        queuedAt: "2026-09-23T12:00:00.000Z",
        errorCode: "waiting_slot",
      })
      .returning({ id: sourceRunTable.id });
    await db.update(sourceRunTable).set({ status: "interrupted" }).where(eq(sourceRunTable.id, pedido.runId));

    await interruptStaleSourceRuns();

    expect(await sourceRun(filha!.id)).toMatchObject({ status: "cancelled", errorCode: "parent_ended" });
  });

  it("pedido novo não se junta a uma execução morta sem batimento", async () => {
    await catalogo();
    const morta = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!morta.ok) throw new Error("recusado");
    await db
      .update(sourceRunTable)
      .set({ status: "running", heartbeatAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(sourceRunTable.id, morta.runId));

    const nova = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);

    expect(nova).toMatchObject({ ok: true, created: true });
    expect(await sourceRun(morta.runId)).toMatchObject({ status: "interrupted" });
  });
});

describe("IT-005 execução de borda: sem linha, sem fonte, verificação global", () => {
  const vazio = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, closed: 0, alive: null, inconclusive: null };
  const deps = (extra: object = {}) => ({
    runs: store,
    now: () => new Date().toISOString(),
    concurrency: 1,
    async work() {
      return { ok: true, counts: vazio, completeness: "complete" as const };
    },
    ...extra,
  });

  it("execução inexistente devolve run_not_found sem tocar em nada", async () => {
    expect(await executeRun(987_654, deps())).toEqual({ ok: false, code: "run_not_found" });
  });

  it("verificação global sem executor global falha com o motivo; com ele, conclui", async () => {
    const sem = await requestSourceRun({ kind: "verify", sourceId: null }, null);
    if (!sem.ok) throw new Error("recusado");
    expect(await executeRun(sem.runId, deps())).toMatchObject({ ok: true, status: "failed" });
    expect((await sourceRun(sem.runId))!.errorDetail).toContain("verificação global indisponível");

    const com = await requestSourceRun({ kind: "verify", sourceId: null }, null);
    if (!com.ok) throw new Error("recusado");
    const workAll = async () => ({ ok: true, counts: { ...vazio, alive: 2, inconclusive: 0 }, completeness: "complete" as const });
    expect(await executeRun(com.runId, deps({ workAll }))).toMatchObject({ ok: true, status: "succeeded" });
  });

  it("retrato sem fonte falha em vez de rodar a fonte errada", async () => {
    await catalogo();
    const [linha] = await db
      .insert(sourceRunTable)
      .values({
        scopeKind: "source",
        sourceId: "greenhouse:acme",
        idempotencyKey: "retrato-vazio",
        configSnapshot: { sources: [] },
        status: "queued",
        queuedAt: new Date().toISOString(),
      })
      .returning({ id: sourceRunTable.id });

    expect(await executeRun(linha!.id, deps())).toMatchObject({ ok: true, status: "failed" });
    expect((await sourceRun(linha!.id))!.errorDetail).toContain("retrato sem fonte");
  });

  it("nova tentativa de fonte aposentada depois da falha é recusada com o código", async () => {
    await catalogo();
    const pedido = await requestSourceRun({ kind: "source", sourceId: "greenhouse:acme" }, null);
    if (!pedido.ok) throw new Error("recusado");
    await executeRun(pedido.runId, deps({ work: async () => ({ ok: false, counts: vazio, completeness: null, error: "HTTP 500" }) }));
    await retireSource("greenhouse:acme", "2026-09-23T12:00:00.000Z");

    expect(await retrySourceRun(pedido.runId, null)).toMatchObject({ ok: false });
  });
});
