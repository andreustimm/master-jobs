/**
 * Eventos de verificação no PostgreSQL (#223, tarefa 04).
 *
 * IT-007 evento transacional e reabertura preservando o histórico · IT-008
 * caminho único (lote e fila) e execução de verificação por fonte.
 *
 * Fronteira FORA: a rede das sondas (`fetchImpl` dublê, IP público literal
 * para a política de saída não consultar DNS).
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSourceRun, requestSourceRun, sourceRun } from "../src/contexts/operations/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { application, applicationEvent, candidate, job, jobCheckEvent, source } from "../src/core/db/schema.ts";
import { applyVerdict, jobAvailability } from "../src/core/ingest/verdict.ts";
import { verifyJobs } from "../src/core/ingest/verify.ts";
import { enqueueVerify, runVerifyQueue } from "../src/core/ingest/verify-queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
const IP = "93.184.216.34";
let seq = 0;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

async function vaga(caminho: string, sourceId = "lever:acme"): Promise<number> {
  seq++;
  const [kind, handle] = sourceId.split(":");
  await db.insert(source).values({ id: sourceId, kind: kind!, handle: handle!, label: sourceId }).onConflictDoNothing();
  const [row] = await db
    .insert(job)
    .values({
      sourceId,
      companyName: "Acme",
      externalId: `ext-${seq}`,
      title: `Vaga ${seq}`,
      url: `https://${IP}${caminho}`,
      fingerprint: `fp-${seq}-${caminho}`,
      contentHash: `ch-${seq}`,
      raw: {},
    })
    .returning({ id: job.id });
  return row!.id;
}

const porCaminho = (mapa: Record<string, number>) =>
  (async (input: string | URL) => {
    const url = String(input);
    const achado = Object.entries(mapa).find(([chave]) => url.includes(chave));
    return new Response(null, { status: achado?.[1] ?? 200 });
  }) as unknown as typeof fetch;

async function eventos(jobId: number) {
  return db.select().from(jobCheckEvent).where(eq(jobCheckEvent.jobId, jobId)).orderBy(jobCheckEvent.id);
}

describe("IT-007 evento transacional e reabertura", () => {
  it("fecha com evento, reabre com outro e preserva o fechamento; candidatura intocada", async () => {
    const id = await vaga("/a");
    const [pessoa] = await db.insert(candidate).values({ slug: "ana", name: "Ana" }).returning({ id: candidate.id });
    await db.insert(application).values({ candidateId: pessoa!.id, jobId: id, status: "applied" });
    const candidaturas = await db.select().from(application);
    const historico = await db.select().from(applicationEvent);

    await applyVerdict({ jobId: id, verdict: "gone", httpCode: 404, checkedAt: "2026-09-20T00:00:00.000Z" });
    const [fechada] = await db.select().from(job).where(eq(job.id, id));
    expect(fechada).toMatchObject({ closedAt: "2026-09-20T00:00:00.000Z", checkStatus: "gone", checkCode: 404 });

    await applyVerdict({ jobId: id, verdict: "alive", httpCode: 200, checkedAt: "2026-09-21T00:00:00.000Z" });
    const [reaberta] = await db.select().from(job).where(eq(job.id, id));
    expect(reaberta).toMatchObject({ closedAt: null, checkStatus: "alive" });

    expect((await eventos(id)).map((e) => [e.verdict, e.httpCode, e.reason])).toEqual([
      ["gone", 404, "closed"],
      ["alive", 200, "unknown"],
    ]);
    expect(await db.select().from(application)).toEqual(candidaturas);
    expect(await db.select().from(applicationEvent)).toEqual(historico);
  });

  it("evento fora de ordem entra no histórico e não muda o estado", async () => {
    const id = await vaga("/b");
    await applyVerdict({ jobId: id, verdict: "alive", httpCode: 200, checkedAt: "2026-09-22T00:00:00.000Z" });

    const tarde = await applyVerdict({ jobId: id, verdict: "gone", httpCode: 404, checkedAt: "2026-09-21T00:00:00.000Z" });

    expect(tarde).toMatchObject({ found: true, changedState: false });
    const [linha] = await db.select().from(job).where(eq(job.id, id));
    expect(linha).toMatchObject({ closedAt: null, checkStatus: "alive", checkedAt: "2026-09-22T00:00:00.000Z" });
    expect(await eventos(id)).toHaveLength(2);
    expect((await jobAvailability(id, "2026-09-23T00:00:00.000Z")).state).toBe("open");
  });

  it("falha ao gravar o evento não deixa a vaga meio atualizada", async () => {
    const id = await vaga("/c");
    // Execução inexistente: a FK do evento recusa, e a transação desfaz tudo.
    await expect(applyVerdict({ jobId: id, verdict: "gone", httpCode: 404, runId: 999_999 })).rejects.toThrow();
    const [linha] = await db.select().from(job).where(eq(job.id, id));
    expect(linha).toMatchObject({ closedAt: null, checkStatus: null, checkedAt: null });
    expect(await eventos(id)).toEqual([]);
  });

  it("vaga inexistente não grava nada", async () => {
    expect(await applyVerdict({ jobId: 424242, verdict: "gone", httpCode: 404 })).toMatchObject({ found: false });
    expect(await db.select().from(jobCheckEvent)).toEqual([]);
  });

  it("evidência é limitada e redigida; disponibilidade lê os eventos", async () => {
    const id = await vaga("/d");
    expect(await jobAvailability(id)).toEqual({ state: "unknown", lastCheckedAt: null, reason: "unknown" });
    await applyVerdict({
      jobId: id,
      verdict: "gone",
      httpCode: 410,
      evidence: `GET https://${IP}/d?token=segredo respondeu 410 ${"x".repeat(400)}`,
      checkedAt: "2026-09-22T00:00:00.000Z",
    });
    const [evento] = await eventos(id);
    expect(evento!.evidence!.length).toBeLessThanOrEqual(280);
    expect(evento!.evidence).not.toContain("segredo");
    expect(await jobAvailability(id, "2026-09-23T00:00:00.000Z")).toEqual({
      state: "closed",
      lastCheckedAt: "2026-09-22T00:00:00.000Z",
      reason: "closed",
    });
  });
});

describe("IT-007 disponibilidade conciliada com a vaga", () => {
  it("vaga fechada pelo sync depois de um `alive` aparece encerrada, sem motivo provado", async () => {
    const id = await vaga("/sync-fechou");
    await applyVerdict({ jobId: id, verdict: "alive", httpCode: 200, checkedAt: "2026-09-21T00:00:00.000Z" });
    await db.update(job).set({ closedAt: "2026-09-22T00:00:00.000Z" }).where(eq(job.id, id));

    expect(await jobAvailability(id, "2026-09-23T00:00:00.000Z")).toEqual({
      state: "closed",
      lastCheckedAt: "2026-09-21T00:00:00.000Z",
      reason: "unknown",
    });
  });

  it("404 que o sync desmentiu (reabriu) não aparece como encerrada", async () => {
    const id = await vaga("/sync-reabriu");
    await applyVerdict({ jobId: id, verdict: "gone", httpCode: 404, checkedAt: "2026-09-21T00:00:00.000Z" });
    await db.update(job).set({ closedAt: null }).where(eq(job.id, id));

    expect((await jobAvailability(id, "2026-09-23T00:00:00.000Z")).state).toBe("unknown");
  });

  it("vaga conferida antes dos eventos mostra a data da linha, não 'nunca'", async () => {
    const id = await vaga("/legada");
    await db.update(job).set({ checkedAt: "2026-09-10T00:00:00.000Z", checkStatus: "alive" }).where(eq(job.id, id));

    expect(await jobAvailability(id, "2026-09-23T00:00:00.000Z")).toEqual({
      state: "unknown",
      lastCheckedAt: "2026-09-10T00:00:00.000Z",
      reason: "unknown",
    });
  });

  it("conclusivo gravado depois de um inconclusivo mais novo decide a vaga e a tela igual", async () => {
    const id = await vaga("/ordem");
    await applyVerdict({ jobId: id, verdict: "inconclusive", httpCode: 503, checkedAt: "2026-09-22T00:00:00.000Z" });

    const tarde = await applyVerdict({ jobId: id, verdict: "gone", httpCode: 404, checkedAt: "2026-09-21T00:00:00.000Z" });

    expect(tarde).toMatchObject({ changedState: true });
    const [linha] = await db.select().from(job).where(eq(job.id, id));
    // O estado muda; a última checagem não anda para trás.
    expect(linha).toMatchObject({ closedAt: "2026-09-21T00:00:00.000Z", checkStatus: "gone", checkedAt: "2026-09-22T00:00:00.000Z" });
    expect((await jobAvailability(id, "2026-09-23T00:00:00.000Z")).state).toBe("closed");
  });
});

describe("IT-008 caminho único e execução de verificação", () => {
  it("o lote (`jho jobs verify`) grava evento e check_status; só 404 fecha", async () => {
    const morta = await vaga("/morta");
    const bloqueada = await vaga("/bloqueada");

    await verifyJobs({ minFit: 0, delayMs: 0, fetchImpl: porCaminho({ "/morta": 404, "/bloqueada": 403 }) });

    const linhas = await db.select().from(job);
    expect(linhas.find((l) => l.id === morta)).toMatchObject({ checkStatus: "gone", checkCode: 404 });
    expect(linhas.find((l) => l.id === morta)!.closedAt).not.toBeNull();
    expect(linhas.find((l) => l.id === bloqueada)).toMatchObject({ checkStatus: "inconclusive", checkCode: 403, closedAt: null });
    expect((await eventos(morta)).map((e) => e.reason)).toEqual(["closed"]);
    // O evento carrega o que a sonda viu (US-013).
    expect((await eventos(morta))[0]!.evidence).toBe("HTTP 404 em https://[redigido]/morta");
    expect((await eventos(bloqueada)).map((e) => [e.verdict, e.reason])).toEqual([["inconclusive", "unknown"]]);
  });

  it("a fila passa pelo mesmo caminho e ainda conclui a tarefa", async () => {
    const id = await vaga("/fila");
    await enqueueVerify(id);

    await runVerifyQueue({ worker: "teste", fetchImpl: porCaminho({ "/fila": 410 }) });

    const [linha] = await db.select().from(job).where(eq(job.id, id));
    expect(linha).toMatchObject({ checkStatus: "gone", checkCode: 410 });
    expect((await eventos(id)).map((e) => [e.verdict, e.httpCode, e.reason])).toEqual([["gone", 410, "closed"]]);
    expect((await eventos(id))[0]!.evidence).toBe("HTTP 410 em https://[redigido]/fila");
  });

  it("dry-run não grava evento nem fecha", async () => {
    const id = await vaga("/seca");
    await verifyJobs({ minFit: 0, delayMs: 0, dryRun: true, fetchImpl: porCaminho({ "/seca": 404 }) });
    expect(await eventos(id)).toEqual([]);
    expect((await db.select().from(job))[0]!.closedAt).toBeNull();
  });

  it("execução de verificação por fonte conta vivo, fechado e inconclusivo, e liga o evento a ela", async () => {
    const viva = await vaga("/viva");
    await vaga("/morta2");
    await vaga("/bloq2");
    await vaga("/outra", "greenhouse:beta");
    const pedido = await requestSourceRun({ kind: "verify", sourceId: "lever:acme" }, null);
    if (!pedido.ok) throw new Error("recusado");

    const original = globalThis.fetch;
    globalThis.fetch = porCaminho({ "/viva": 200, "/morta2": 404, "/bloq2": 429 });
    try {
      await executeSourceRun(pedido.runId, { verify: { limit: 50 } });
    } finally {
      globalThis.fetch = original;
    }

    expect(await sourceRun(pedido.runId)).toMatchObject({ status: "succeeded", fetched: 3, alive: 1, closed: 1, inconclusive: 1 });
    expect((await eventos(viva))[0]!.runId).toBe(pedido.runId);
    // A vaga de outra fonte não foi tocada.
    expect(await db.select().from(jobCheckEvent)).toHaveLength(3);
  });

  it("interrupção deixa as não verificadas como estavam; nada vencido dá zero", async () => {
    await vaga("/um");
    await vaga("/dois");
    await verifyJobs({ minFit: 0, delayMs: 0, limit: 1, fetchImpl: porCaminho({}) });
    const intocadas = (await db.select().from(job)).filter((l) => l.checkedAt === null);
    expect(intocadas).toHaveLength(1);
    expect(await db.select().from(jobCheckEvent)).toHaveLength(1);

    await db.insert(source).values({ id: "ashby:vazia", kind: "ashby", handle: "vazia", label: "Vazia" });
    const pedido = await requestSourceRun({ kind: "verify", sourceId: "ashby:vazia" }, null);
    if (!pedido.ok) throw new Error("recusado");
    await executeSourceRun(pedido.runId);
    expect(await sourceRun(pedido.runId)).toMatchObject({ status: "succeeded", fetched: 0, alive: 0, closed: 0, inconclusive: 0 });
  });
});
