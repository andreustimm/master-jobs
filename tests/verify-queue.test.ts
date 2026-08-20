import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { company, job, jobScore, source, verifyTask } from "../src/core/db/schema.ts";
import { classify } from "../src/core/ingest/probe.ts";
import {
  claimCheck,
  enqueueStale,
  enqueueVerify,
  failCheck,
  MAX_ATTEMPTS,
  pendingFor,
  runVerifyQueue,
  USER_PRIORITY,
  verifyStats,
} from "../src/core/ingest/verify-queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Reconferência de vaga viva.
 *
 * O risco aqui não é deixar de fechar uma vaga morta — é fechar uma viva. Um
 * fechamento errado some com a vaga do quadro sem aviso, e de fora não há como
 * distinguir "a empresa tirou o anúncio" de "o robô levou um 403". Por isso a
 * classificação é função pura e tem teste próprio.
 */

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  await db
    .insert(source)
    .values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" });
  await db.insert(company).values({ slug: "acme", name: "Acme" });
});

afterEach(() => {
  releaseTestDb();
});

let seq = 0;
async function seedJob(opts: { fit?: number; checkedAt?: string; closed?: boolean } = {}) {
  seq++;
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "lever:acme",
      companyName: "Acme",
      externalId: `job-${seq}`,
      title: `Vaga ${seq}`,
      url: `https://example.test/${seq}`,
      fingerprint: `fp-${seq}`,
      contentHash: `ch-${seq}`,
      raw: "{}",
      checkedAt: opts.checkedAt ?? null,
      closedAt: opts.closed ? "2026-08-01T00:00:00.000Z" : null,
    })
    .returning({ id: job.id });
  if (opts.fit !== undefined) {
    await db.insert(jobScore).values({
      jobId: row!.id,
      fit: opts.fit,
      titleScore: 0,
      keywordScore: 0,
      seniorityScore: 0,
      geoScore: 0,
      compScore: 0,
      cluster: "other",
      matchedKeywords: [],
      missingKeywords: [],
      reasons: [],
      blockers: [],
      scorerVersion: "test",
    });
  }
  return row!.id;
}

/** Uma resposta HTTP falsa, para o teste não tocar a rede. */
function fakeFetch(status: number): typeof fetch {
  return (async () => new Response(null, { status })) as unknown as typeof fetch;
}

describe("classify", () => {
  it("só 404 e 410 provam ausência", () => {
    expect(classify(404)).toBe("gone");
    expect(classify(410)).toBe("gone");
  });

  it("bloqueio de robô não é prova de nada", () => {
    // O Himalayas devolve 403 em toda requisição. Fechar aqui apagaria o
    // acervo inteiro de uma fonte viva.
    for (const status of [401, 403, 429]) {
      expect(classify(status)).toBe("inconclusive");
    }
  });

  it("erro do servidor e falha de rede não decidem nada", () => {
    for (const status of [500, 502, 503, 504]) expect(classify(status)).toBe("inconclusive");
    expect(classify(null)).toBe("inconclusive");
  });

  it("2xx e 3xx são vaga viva", () => {
    for (const status of [200, 201, 204, 301, 302, 308]) {
      expect(classify(status)).toBe("alive");
    }
  });
});

describe("enqueueVerify", () => {
  it("enfileira e reporta o estado para a interface", async () => {
    const id = await seedJob();
    expect(await enqueueVerify(id)).toEqual({ queued: true });
    expect(await pendingFor(id)).toBe("pending");
  });

  it("clicar três vezes não enfileira três vezes", async () => {
    const id = await seedJob();
    await enqueueVerify(id);
    await enqueueVerify(id);
    await enqueueVerify(id);

    // Trabalho duplicado contra site de terceiro é como se toma bloqueio.
    const rows = await db.select().from(verifyTask).where(eq(verifyTask.jobId, id));
    expect(rows).toHaveLength(1);
  });

  it("pedido do usuário tem prioridade sobre a varredura", async () => {
    const varredura = await seedJob();
    const pedido = await seedJob();
    await enqueueVerify(varredura, { origin: "periodic" });
    await enqueueVerify(pedido, { origin: "user" });

    const claimed = await claimCheck("w1");
    expect(claimed?.jobId).toBe(pedido);
  });

  it("reenfileira uma tarefa já concluída", async () => {
    const id = await seedJob();
    await enqueueVerify(id);
    await runVerifyQueue({ fetchImpl: fakeFetch(200) });
    expect(await pendingFor(id)).toBe("done");

    // Reconferir é operação que se repete: semanas depois a resposta muda.
    await enqueueVerify(id);
    expect(await pendingFor(id)).toBe("pending");
  });

  it("recusa vaga inexistente", async () => {
    expect(await enqueueVerify(9999)).toEqual({ queued: false, reason: "not-found" });
  });
});

describe("enqueueStale", () => {
  it("pega primeiro a que nunca foi conferida", async () => {
    const nunca = await seedJob({ fit: 80 });
    await seedJob({ fit: 90, checkedAt: new Date().toISOString() });

    // A recém-conferida tem fit maior e mesmo assim não entra: ordenar por fit
    // era o defeito do lote antigo, que reconferia as mesmas 200 para sempre.
    const n = await enqueueStale({ minFit: 55, limit: 1, olderThanDays: 7 });
    expect(n).toBe(1);
    expect(await pendingFor(nunca)).toBe("pending");
  });

  it("ignora vaga já fechada e vaga abaixo do corte", async () => {
    await seedJob({ fit: 80, closed: true });
    await seedJob({ fit: 10 });
    expect(await enqueueStale({ minFit: 55 })).toBe(0);
  });

  it("ignora quem foi conferida há pouco", async () => {
    await seedJob({ fit: 80, checkedAt: new Date().toISOString() });
    expect(await enqueueStale({ minFit: 55, olderThanDays: 7 })).toBe(0);
  });
});

describe("runVerifyQueue", () => {
  it("404 fecha a vaga e registra o código", async () => {
    const id = await seedJob();
    await enqueueVerify(id);

    const result = await runVerifyQueue({ fetchImpl: fakeFetch(404) });
    expect(result).toMatchObject({ checked: 1, gone: 1 });

    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.closedAt).not.toBeNull();
    expect(row?.checkStatus).toBe("gone");
    expect(row?.checkCode).toBe(404);
  });

  it("403 NÃO fecha a vaga", async () => {
    const id = await seedJob();
    await enqueueVerify(id);

    const result = await runVerifyQueue({ fetchImpl: fakeFetch(403) });
    expect(result).toMatchObject({ checked: 1, inconclusive: 1, gone: 0 });

    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.closedAt).toBeNull();
    // Mesmo sem veredito, a conferência fica registrada: senão a varredura
    // periódica voltaria nesta mesma vaga em todo ciclo.
    expect(row?.checkedAt).not.toBeNull();
    expect(row?.checkStatus).toBe("inconclusive");
  });

  it("vaga viva reabre uma que estava fechada", async () => {
    const id = await seedJob({ closed: true });
    await enqueueVerify(id);

    await runVerifyQueue({ fetchImpl: fakeFetch(200) });

    // Sem isto, um 404 transitório sumiria com a vaga para sempre.
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.closedAt).toBeNull();
    expect(row?.checkStatus).toBe("alive");
  });

  it("respeita o limite por execução", async () => {
    for (let i = 0; i < 3; i++) await enqueueVerify(await seedJob());
    const result = await runVerifyQueue({ fetchImpl: fakeFetch(200), max: 2 });
    expect(result.checked).toBe(2);
    expect((await verifyStats()).pending).toBe(1);
  });

  it("esvazia a fila e para", async () => {
    for (let i = 0; i < 3; i++) await enqueueVerify(await seedJob());
    const result = await runVerifyQueue({ fetchImpl: fakeFetch(200) });
    expect(result.checked).toBe(3);
    expect(await claimCheck("w1")).toBeNull();
  });
});

describe("claim", () => {
  it("dois workers nunca pegam a mesma tarefa", async () => {
    await enqueueVerify(await seedJob());
    const first = await claimCheck("w1");
    const second = await claimCheck("w2");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("recupera um claim abandonado por worker morto", async () => {
    const id = await seedJob();
    await enqueueVerify(id);
    await claimCheck("w1");

    // Sem recuperação, um Ctrl-C deixa a tarefa em `checking` para sempre e a
    // fila encolhe em silêncio a cada interrupção.
    await db
      .update(verifyTask)
      .set({ claimedAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(verifyTask.jobId, id));

    expect((await claimCheck("w2"))?.jobId).toBe(id);
  });
});

describe("failCheck", () => {
  it("tenta de novo com backoff e desiste depois do limite", async () => {
    const id = await seedJob();
    await enqueueVerify(id);
    const task = await claimCheck("w1");

    await failCheck(task!.id, "boom");
    let [row] = await db.select().from(verifyTask).where(eq(verifyTask.id, task!.id));
    expect(row?.status).toBe("pending");
    expect(row?.runAfter).not.toBeNull();

    for (let i = 1; i < MAX_ATTEMPTS; i++) await failCheck(task!.id, "boom");
    [row] = await db.select().from(verifyTask).where(eq(verifyTask.id, task!.id));
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toBe("boom");
  });
});
