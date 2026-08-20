// Suite: administração da fila de captura (src/core/scrape/infra/drizzle-queue.ts)
// Invariante: captura é o estágio caro. Quem entra na fila e quem fica de fora é
// a decisão que determina se a varredura gasta a noite nas vagas certas. Os três
// filtros que importam: vaga fechada não se captura, origem sintética não tem
// página para baixar, e vaga que já veio com texto do empregador não precisa de
// raspagem — mas precisa ser CONTADA, senão uma fila pequena parece filtro quebrado.
// Fronteira DENTRO: critérios de elegibilidade, `refresh`, contabilidade.
// Fronteira FORA: os workers e a decisão pura de retentativa (domain/retry-policy).
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidate, job, jobPage, jobScore, scrapeTask, source } from "../src/core/db/schema.ts";
import { drizzleQueue, drizzleQueueAdmin } from "../src/core/scrape/infra/drizzle-queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const PADRAO = { minFit: 45, limit: 500, refresh: false, minExistingChars: 2_000 };

let db: DB;
let candidateId: number;

async function seedJob(
  externalId: string,
  options: {
    url?: string;
    fit?: number;
    descriptionText?: string;
    capturada?: boolean;
    fechada?: boolean;
  } = {},
): Promise<number> {
  await db
    .insert(source)
    .values({ id: "greenhouse:acme", kind: "greenhouse", handle: "acme", label: "Acme" })
    .onConflictDoNothing({ target: source.id });

  const [row] = await db
    .insert(job)
    .values({
      sourceId: "greenhouse:acme",
      companyName: "Acme",
      externalId,
      title: `Vaga ${externalId}`,
      url: options.url ?? `https://acme.test/${externalId}`,
      fingerprint: `fp-${externalId}`,
      contentHash: `ch-${externalId}`,
      descriptionText: options.descriptionText ?? null,
      closedAt: options.fechada ? "2026-08-01T00:00:00Z" : null,
      raw: "{}",
    })
    .returning({ id: job.id });

  const jobId = row!.id;
  if (options.fit !== undefined) {
    await db.insert(jobScore).values({
      candidateId,
      jobId,
      fit: options.fit,
      titleScore: 0, keywordScore: 0, seniorityScore: 0, geoScore: 0, compScore: 0,
      penalty: 0, cluster: "architect",
      matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [],
      scorerVersion: "teste",
    });
  }
  if (options.capturada) {
    await db.insert(jobPage).values({
      jobId,
      finalUrl: options.url ?? `https://acme.test/${externalId}`,
      httpStatus: 200,
      html: "<p>já capturada</p>",
      contentHash: "hash",
      bytes: 20,
    });
  }
  return jobId;
}

beforeEach(async () => {
  db = await useTestDb();
  const [person] = await db
    .insert(candidate)
    .values({ slug: "andreus", name: "Andreus" })
    .returning({ id: candidate.id });
  candidateId = person!.id;
});
afterEach(() => releaseTestDb());

describe("enqueueEligible", () => {
  it("não enfileira vaga fechada nem origem sem página para baixar", async () => {
    // Regra 3: vaga que some é fechada, não deletada — e continua no banco. Sem
    // este filtro, toda varredura tentaria rebaixar o histórico inteiro. Já a
    // origem manual guarda texto local, não URL: buscar `manual:...` é garantia
    // de falha e de uma tarefa em `failed` para sempre.
    await seedJob("fechada", { fit: 90, fechada: true });
    await seedJob("manual", { fit: 90, url: "manual:comparacao-42" });
    await seedJob("viva", { fit: 90 });

    const result = await drizzleQueueAdmin.enqueueEligible(PADRAO);
    expect(result.queued).toBe(1);

    const tarefas = await db.select({ url: scrapeTask.url }).from(scrapeTask);
    expect(tarefas.map((t) => t.url)).toEqual(["https://acme.test/viva"]);
  });

  it("pula o que já tem página capturada, e `refresh` desfaz exatamente isso", async () => {
    // Sem `refresh`, recapturar seria baixar de novo 6.000 páginas que já estão
    // no banco. Com ele, é o comando explícito para conferir se o anúncio mudou.
    await seedJob("capturada", { fit: 90, capturada: true });

    expect((await drizzleQueueAdmin.enqueueEligible(PADRAO)).queued).toBe(0);
    expect((await drizzleQueueAdmin.enqueueEligible({ ...PADRAO, refresh: true })).queued).toBe(1);
  });

  it("pula quem já tem descrição longa, mas informa quantos foram", async () => {
    // Uma fila de 3 numa base de 300 parece filtro quebrado. O número de
    // "já descritas" é o que distingue "nada a fazer" de "critério errado".
    await seedJob("descrita", { fit: 90, descriptionText: "x".repeat(2_100) });
    await seedJob("curta", { fit: 90, descriptionText: "x".repeat(100) });

    const result = await drizzleQueueAdmin.enqueueEligible(PADRAO);
    expect(result).toMatchObject({ queued: 1, alreadyDescribed: 1 });
  });

  it("com `refresh` enfileira até quem já tinha texto suficiente do empregador", async () => {
    // `refresh` é a via para reprocessar tudo depois de mudar o extrator; se ele
    // parasse no filtro de descrição, metade do acervo ficaria de fora em silêncio.
    await seedJob("descrita", { fit: 90, descriptionText: "x".repeat(2_100), capturada: true });

    const result = await drizzleQueueAdmin.enqueueEligible({ ...PADRAO, refresh: true });
    expect(result.queued).toBe(1);
  });

  it("respeita o piso de fit e trata vaga sem score como fit zero", async () => {
    // Vaga sem score não é vaga ruim — mas também não pode consumir a captura
    // antes de ser pontuada. `coalesce(fit, 0)` a deixa passar só com piso zero.
    await seedJob("boa", { fit: 90 });
    await seedJob("fraca", { fit: 10 });
    await seedJob("sem-score");

    expect((await drizzleQueueAdmin.enqueueEligible(PADRAO)).queued).toBe(1);

    await db.delete(scrapeTask);
    expect((await drizzleQueueAdmin.enqueueEligible({ ...PADRAO, minFit: 0 })).queued).toBe(3);
  });

  it("gasta o limite nas vagas de maior fit primeiro", async () => {
    // O limite existe para rodar um lote pequeno; gastá-lo em ordem arbitrária
    // desperdiçaria justamente o estágio caro nas vagas que ninguém abre.
    await seedJob("media", { fit: 70 });
    await seedJob("otima", { fit: 95 });
    await seedJob("boa", { fit: 80 });

    const result = await drizzleQueueAdmin.enqueueEligible({ ...PADRAO, limit: 2 });
    expect(result.queued).toBe(2);

    const tarefas = await db.select({ url: scrapeTask.url }).from(scrapeTask);
    expect(tarefas.map((t) => t.url).sort()).toEqual([
      "https://acme.test/boa",
      "https://acme.test/otima",
    ]);
  });

  it("rodar duas vezes não duplica a fila", async () => {
    // Idempotência aqui não é elegância: é o que permite chamar `scrape enqueue`
    // num loop sem transformar a fila num acúmulo de tarefas iguais.
    await seedJob("uma", { fit: 90 });
    await drizzleQueueAdmin.enqueueEligible(PADRAO);
    const segunda = await drizzleQueueAdmin.enqueueEligible(PADRAO);

    expect(segunda.queued).toBe(0);
    expect(await db.select().from(scrapeTask)).toHaveLength(1);
  });
});

describe("retryFailed", () => {
  it("devolve à fila só o que falhou, e zera a contagem de tentativas", async () => {
    const falhou = await seedJob("falhou", { fit: 90 });
    const feito = await seedJob("feito", { fit: 90 });
    await drizzleQueueAdmin.enqueueEligible(PADRAO);
    await db
      .update(scrapeTask)
      .set({ status: "failed", attempts: 4, lastError: "HTTP 500" })
      .where(eq(scrapeTask.jobId, falhou));
    await db.update(scrapeTask).set({ status: "done" }).where(eq(scrapeTask.jobId, feito));

    expect(await drizzleQueueAdmin.retryFailed()).toBe(1);

    const [reposta] = await db.select().from(scrapeTask).where(eq(scrapeTask.jobId, falhou));
    expect(reposta).toMatchObject({ status: "pending", attempts: 0, runAfter: null, lastError: null });
    const [intocada] = await db.select().from(scrapeTask).where(eq(scrapeTask.jobId, feito));
    expect(intocada!.status).toBe("done");
  });

  it("devolve zero quando não há falha, em vez de reprocessar tudo", async () => {
    expect(await drizzleQueueAdmin.retryFailed()).toBe(0);
  });
});

describe("fail", () => {
  it("não quebra quando a tarefa some entre a falha e o registro dela", async () => {
    // A vaga pode ter sido fechada em outra sessão, e `scrape_task` cai por
    // cascade. Um worker que estoura aqui derruba o lote inteiro por uma linha
    // que já não importa.
    await expect(drizzleQueue.fail(9_999, "HTTP 500", true)).resolves.toBeUndefined();
    expect(await db.select().from(scrapeTask)).toEqual([]);
  });
});

describe("stats", () => {
  it("conta por estado e omite estado sem nenhuma tarefa", async () => {
    // O painel lê isso; um zero explícito para os sete estados esconderia o que
    // de fato está acontecendo no meio de uma varredura.
    await seedJob("a", { fit: 90 });
    await seedJob("b", { fit: 90 });
    await drizzleQueueAdmin.enqueueEligible(PADRAO);
    const tarefa = await drizzleQueue.claim("pending", "w1");
    await drizzleQueue.complete(tarefa!.id, "fetched");

    expect(await drizzleQueue.stats()).toEqual({ pending: 1, fetched: 1 });
  });
});
