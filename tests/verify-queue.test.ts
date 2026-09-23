import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidate, company, job, jobScore, source, targetTrack, verifyTask } from "../src/core/db/schema.ts";
import { classify } from "../src/core/ingest/probe.ts";
import type { LookupHost } from "../src/core/remote-url.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import {
  claimCheck,
  enqueueStale,
  enqueueVerify,
  failCheck,
  MAX_ATTEMPTS,
  pendingFor,
  runVerifyQueue,
  staleCandidates,
  USER_PRIORITY,
  verifyStats,
} from "../src/core/ingest/verify-queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

/**
 * Reconferência de vaga viva.
 *
 * O risco aqui não é deixar de fechar uma vaga morta — é fechar uma viva. Um
 * fechamento errado some com a vaga do quadro sem aviso, e de fora não há como
 * distinguir "a empresa tirou o anúncio" de "o robô levou um 403". Por isso a
 * classificação é função pura e tem teste próprio.
 */

let db: DB;
let candidateId: number;

beforeEach(async () => {
  db = await useTestDb();
  await db
    .insert(source)
    .values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" });
  await db.insert(company).values({ slug: "acme", name: "Acme" });
  const [person] = await db
    .insert(candidate)
    .values({ slug: "verify-queue-test", name: "Verify Queue Test" })
    .returning({ id: candidate.id });
  candidateId = person!.id;
});

afterEach(async () => {
  await releaseTestDb();
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
      candidateId,
      trackId: await primaryTrackId(db, candidateId),
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

const publicLookup: LookupHost = async () => [
  { address: "93.184.216.34", family: 4 },
];

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

  it("falls back to the posting when applyUrl is not a public URL", async () => {
    const id = await seedJob();
    await db.update(job).set({ applyUrl: "/apply" }).where(eq(job.id, id));

    expect(await enqueueVerify(id)).toEqual({ queued: true });
    const [task] = await db.select().from(verifyTask).where(eq(verifyTask.jobId, id));
    expect(task?.url).toBe(`https://example.test/${seq}`);
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
    await runVerifyQueue({ fetchImpl: fakeFetch(200), lookupHost: publicLookup });
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

  it("considera o maior score por vaga sem duplicar o lote entre candidatos", async () => {
    const first = await seedJob({ fit: 80 });
    const second = await seedJob({ fit: 70 });
    const [other] = await db
      .insert(candidate)
      .values({ slug: "verify-queue-other", name: "Other candidate" })
      .returning({ id: candidate.id });
    await db.insert(jobScore).values({
      candidateId: other!.id,
      trackId: await primaryTrackId(db, other!.id),
      jobId: first,
      fit: 90,
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

    expect(await enqueueStale({ minFit: 55, limit: 2 })).toBe(2);
    expect(await pendingFor(first)).toBe("pending");
    expect(await pendingFor(second)).toBe("pending");
  });

  it("nota de trilha aceita não fura a fila", async () => {
    // ADR-008: a trilha aceita pontua o recorte dela e costuma dar nota maior.
    const baixa = await seedJob({ fit: 10 });
    const [aceita] = await db
      .insert(targetTrack)
      .values({
        candidateId,
        name: "Aceita",
        nameKey: "aceita",
        isPrimary: false,
        status: "active",
        position: 2,
        targetJson: "{}",
      })
      .returning({ id: targetTrack.id });
    await db.insert(jobScore).values({
      candidateId,
      trackId: aceita!.id,
      jobId: baixa,
      fit: 95,
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

    expect(await enqueueStale({ minFit: 55 })).toBe(0);
  });

  it("o plano agrega job_score uma vez, sem subconsulta por vaga", async () => {
    // B-11: a subconsulta correlacionada, repetida no WHERE e no ORDER BY,
    // releu `job_score` para cada vaga e somou 77,4 milhões de linhas numa
    // varredura. O plano não pode ter SubPlan e só pode visitar a tabela uma vez.
    for (let i = 0; i < 20; i++) await seedJob({ fit: 50 + i });
    await db.execute(sql`analyze production.job, production.job_score`);

    const { sql: text, params } = staleCandidates({ minFit: 55 }).toSQL();
    const plan = JSON.stringify(await db.$client.unsafe(`explain (format json) ${text}`, params as never[]));

    expect(plan).not.toContain("SubPlan");
    expect(plan.match(/"Relation Name":"job_score"/g)).toHaveLength(1);
  });

  it("leitura de job_score por vaga tem índice iniciado por job_id", async () => {
    // A chave primária começa por candidato. Invalidação por edição do anúncio,
    // cascade de `job` e a melhor nota por vaga precisam de índice próprio.
    const id = await seedJob({ fit: 70 });
    const plan = await db.$client.begin(async (tx) => {
      await tx.unsafe("set local enable_seqscan = off");
      return tx.unsafe("explain (format json) select fit from production.job_score where job_id = $1", [id]);
    });
    expect(JSON.stringify(plan)).toContain('"Index Name":"job_score_job_idx"');
  });
});

describe("runVerifyQueue", () => {
  it("404 fecha a vaga e registra o código", async () => {
    const id = await seedJob();
    await enqueueVerify(id);

    const result = await runVerifyQueue({ fetchImpl: fakeFetch(404), lookupHost: publicLookup });
    expect(result).toMatchObject({ checked: 1, gone: 1 });

    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.closedAt).not.toBeNull();
    expect(row?.checkStatus).toBe("gone");
    expect(row?.checkCode).toBe(404);
  });

  it("403 NÃO fecha a vaga", async () => {
    const id = await seedJob();
    await enqueueVerify(id);

    const result = await runVerifyQueue({ fetchImpl: fakeFetch(403), lookupHost: publicLookup });
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

    await runVerifyQueue({ fetchImpl: fakeFetch(200), lookupHost: publicLookup });

    // Sem isto, um 404 transitório sumiria com a vaga para sempre.
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.closedAt).toBeNull();
    expect(row?.checkStatus).toBe("alive");
  });

  it("respeita o limite por execução", async () => {
    for (let i = 0; i < 3; i++) await enqueueVerify(await seedJob());
    const result = await runVerifyQueue({
      fetchImpl: fakeFetch(200),
      lookupHost: publicLookup,
      max: 2,
    });
    expect(result.checked).toBe(2);
    expect((await verifyStats()).pending).toBe(1);
  });

  it("com teto de tempo, não começa a sondagem que não caberia (fatia da Vercel)", async () => {
    // Cada sondagem "leva" 8 s no relógio de teste; com 20 s de teto, a
    // terceira não começa (16 + 8 > 20) e fica na fila para a próxima chamada.
    const relogio = fixedClock();
    setClock(relogio);
    try {
      for (let i = 0; i < 4; i++) await enqueueVerify(await seedJob());
      const lenta: typeof fetch = async (...args) => {
        relogio.advance(8_000);
        return fakeFetch(200)(...args);
      };
      const result = await runVerifyQueue({ fetchImpl: lenta, lookupHost: publicLookup, budgetMs: 20_000 });
      expect(result.checked).toBe(2);
      expect((await verifyStats()).pending).toBe(2);
    } finally {
      resetClock();
    }
  });

  it("esvazia a fila e para", async () => {
    for (let i = 0; i < 3; i++) await enqueueVerify(await seedJob());
    const result = await runVerifyQueue({
      fetchImpl: fakeFetch(200),
      lookupHost: publicLookup,
    });
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
  it("UT-440 `fetch` que rejeita com string não fecha a vaga: vira inconclusivo", async () => {
    // Medido: `probe()` captura a exceção e devolve `inconclusive`, então o
    // `catch` de `runVerifyQueue` NÃO é alcançado por falha de rede — ele é
    // defesa de segunda ordem, para uma exceção vinda de outro lugar.
    //
    // O que importa é exatamente isso: uma rejeição de rede não pode fechar
    // vaga. É a invariante do repositório — só 404 e 410 provam ausência — no
    // caminho da exceção, onde seria mais fácil errar.
    const id = await seedJob();
    await enqueueVerify(id);

    const lancaString = (async () => {
      throw "ENOTFOUND host inexistente";
    }) as unknown as typeof fetch;

    const r = await runVerifyQueue({ fetchImpl: lancaString, lookupHost: publicLookup });

    expect(r).toMatchObject({ checked: 1, inconclusive: 1, gone: 0, alive: 0 });
    const [linha] = await db.select().from(job).where(eq(job.id, id));
    expect(linha?.closedAt).toBeNull();
  });

  it("UT-441 `Error` de verdade também é inconclusivo, e a vaga continua aberta", async () => {
    // O par: qualquer forma de falha de rede tem o mesmo desfecho. Uma delas
    // fechando a vaga e a outra não seria pior que as duas fecharem.
    const id = await seedJob();
    await enqueueVerify(id);

    const lancaErro = (async () => {
      throw new Error("conexão recusada");
    }) as unknown as typeof fetch;

    const r = await runVerifyQueue({ fetchImpl: lancaErro, lookupHost: publicLookup });

    expect(r).toMatchObject({ checked: 1, inconclusive: 1, gone: 0 });
    const [linha] = await db.select().from(job).where(eq(job.id, id));
    expect(linha?.closedAt).toBeNull();
  });

  it("UT-442 `delayMs` não altera o resultado, e a execução continua completa", async () => {
    // A pausa entre sondagens existe porque são sites de terceiros: é a diferença
    // entre um cliente educado e um bloqueio de IP.
    //
    // O que este caso NÃO faz é medir tempo de parede. Um piso em milissegundos
    // depende da carga da máquina, e um teste que às vezes reprova por isso
    // ensina a suíte a ser ignorada. O que se afirma aqui é o que é
    // determinístico: com a pausa configurada, o laço percorre as duas tarefas e
    // devolve exatamente o mesmo resultado que sem ela. A duração do `setTimeout`
    // é responsabilidade do runtime, não deste teste.
    const a = await seedJob();
    const b = await seedJob();
    await enqueueVerify(a);
    await enqueueVerify(b);

    const comPausa = await runVerifyQueue({
      fetchImpl: fakeFetch(200),
      lookupHost: publicLookup,
      delayMs: 1,
    });

    expect(comPausa).toEqual({ checked: 2, alive: 2, gone: 0, inconclusive: 0 });

    // E sem a pausa, o mesmo resultado sobre um acervo equivalente: é o par que
    // prova que a opção não muda o que é verificado, só o ritmo.
    const c = await seedJob();
    const d = await seedJob();
    await enqueueVerify(c);
    await enqueueVerify(d);

    const semPausa = await runVerifyQueue({ fetchImpl: fakeFetch(200), lookupHost: publicLookup });

    expect(semPausa).toEqual(comPausa);
  });
});
