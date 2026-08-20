// Suite: estágio de interpretação do scraper (src/core/scrape/parser.ts)
// Invariante inegociável desta camada: ela PREENCHE lacuna, nunca sobrescreve. O
// texto que veio da API do próprio empregador é melhor que qualquer coisa raspada
// da página renderizada; trocar um pelo outro seria rebaixar o dado sem deixar
// rastro. A segunda regra que ela guarda: vaga que ganhou descrição tem score
// obsoleto, porque o componente de keywords foi calculado contra o vazio.
// Fronteira DENTRO: leitura da página capturada, gravação do texto extraído,
// preenchimento condicional e invalidação de score.
// Fronteira FORA: a extração pura (extract.ts) e a captura (fetcher.ts).
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidate, job, jobPage, jobScore, source } from "../src/core/db/schema.ts";
import { parseStored, reparseAll, runParseStage } from "../src/core/scrape/parser.ts";
import type { ClaimedTask, QueuePort, ScrapeStatus } from "../src/core/scrape/queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/** Página realista: corpo longo, campos reconhecíveis e requisitos em <li>. */
const PAGINA = `<html><head><title>Staff AI Engineer — Acme</title></head><body>
  <div class="job-description">
    <h1>Staff AI Engineer</h1>
    <p>${"Construímos infraestrutura de agentes para empresas. ".repeat(12)}</p>
    <p>Full-time, fully remote. Senior level. $180,000 - $220,000 per year.</p>
    <ul>
      <li>Oito anos ou mais desenhando sistemas backend distribuídos</li>
      <li>Experiência prática com Kubernetes e observabilidade em produção</li>
    </ul>
  </div></body></html>`;

let db: DB;

async function seedJob(descriptionText: string | null = null): Promise<number> {
  await db
    .insert(source)
    .values({ id: "careers:acme", kind: "careers", handle: "acme", label: "Acme" })
    .onConflictDoNothing();
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "careers:acme",
      companyName: "Acme",
      externalId: `ext-${Math.random()}`,
      title: "Staff AI Engineer",
      url: "https://acme.test/vagas/staff",
      fingerprint: `fp-${Math.random()}`,
      contentHash: `ch-${Math.random()}`,
      descriptionText,
      raw: "{}",
    })
    .returning({ id: job.id });
  return row!.id;
}

async function seedPage(jobId: number, html: string | null): Promise<void> {
  await db.insert(jobPage).values({
    jobId,
    finalUrl: "https://acme.test/vagas/staff",
    httpStatus: 200,
    html,
    contentHash: "hash",
    bytes: html?.length ?? 0,
    parsedAt: null,
  });
}

async function seedScore(jobId: number): Promise<void> {
  const [person] = await db
    .insert(candidate)
    .values({ slug: `c-${Math.random()}`, name: "Andreus" })
    .returning({ id: candidate.id });
  await db.insert(jobScore).values({
    candidateId: person!.id,
    jobId,
    fit: 70,
    titleScore: 0, keywordScore: 0, seniorityScore: 0, geoScore: 0, compScore: 0,
    penalty: 0, cluster: "architect",
    matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [],
    scorerVersion: "teste",
  });
}

beforeEach(async () => {
  db = await useTestDb();
});
afterEach(() => releaseTestDb());

describe("parseStored", () => {
  it("distingue página ausente de página vazia, porque a causa é outra", async () => {
    // "Sem captura" é fila fora de ordem; "página vazia" é captura que deu 200
    // com corpo nulo. Confundir as duas manda investigar o worker errado.
    const semPagina = await seedJob();
    expect(await parseStored(semPagina)).toEqual({
      kind: "failed",
      reason: "sem página capturada",
    });

    const vazia = await seedJob();
    await seedPage(vazia, null);
    expect(await parseStored(vazia)).toEqual({ kind: "failed", reason: "página vazia" });
  });

  it("recusa um fragmento em vez de chamá-lo de descrição", async () => {
    // Três palavras não são um anúncio — normalmente é o shell de uma página
    // montada por JavaScript. Aceitá-las envenena o componente de keywords com
    // um texto que o scorer trataria como conteúdo real.
    const jobId = await seedJob();
    await seedPage(jobId, "<html><body><p>oi</p></body></html>");

    expect(await parseStored(jobId)).toEqual({
      kind: "failed",
      reason: "nenhum texto utilizável na página",
    });
    const [page] = await db.select().from(jobPage).where(eq(jobPage.jobId, jobId));
    // Nada foi gravado: a página fica disponível para um extrator melhor.
    expect(page!.parsedAt).toBeNull();
    expect(page!.text).toBeNull();
  });

  it("grava texto, título, campos e requisitos e marca a página como interpretada", async () => {
    const jobId = await seedJob();
    await seedPage(jobId, PAGINA);

    const outcome = await parseStored(jobId);
    expect(outcome.kind).toBe("parsed");
    expect((outcome as { fields: number }).fields).toBeGreaterThanOrEqual(3);

    const [page] = await db.select().from(jobPage).where(eq(jobPage.jobId, jobId));
    expect(page!.parsedAt).toBeTruthy();
    expect(page!.text).toContain("infraestrutura de agentes");
    const extracted = page!.extracted as {
      title: string;
      fields: Record<string, string>;
      requirements: string[];
    };
    expect(extracted.title).toBe("Staff AI Engineer");
    expect(extracted.fields.salary).toContain("180,000");
    expect(extracted.requirements).toHaveLength(2);
  });

  it("preenche a descrição da vaga que não tinha nenhuma", async () => {
    const jobId = await seedJob(null);
    await seedPage(jobId, PAGINA);
    await parseStored(jobId);

    const [row] = await db.select().from(job).where(eq(job.id, jobId));
    expect(row!.descriptionText).toContain("infraestrutura de agentes");
  });

  it("substitui uma descrição curta demais para ser útil", async () => {
    // Menos de 200 caracteres vindos do adapter é resumo, não anúncio; nesse
    // caso a página raspada é de fato melhor.
    const jobId = await seedJob("Resumo de uma linha.");
    await seedPage(jobId, PAGINA);
    await parseStored(jobId);

    const [row] = await db.select().from(job).where(eq(job.id, jobId));
    expect(row!.descriptionText).toContain("infraestrutura de agentes");
  });

  it("nunca sobrescreve a descrição que veio da API do empregador", async () => {
    // A regra central deste arquivo. O texto do empregador é a fonte primária;
    // trocá-lo por uma raspagem seria rebaixar o dado sem nenhum sinal disso.
    const original = "Descrição oficial da vaga vinda direto do ATS. ".repeat(10);
    const jobId = await seedJob(original);
    await seedPage(jobId, PAGINA);

    const outcome = await parseStored(jobId);
    expect(outcome.kind).toBe("parsed");

    const [row] = await db.select().from(job).where(eq(job.id, jobId));
    expect(row!.descriptionText).toBe(original);
    // O texto raspado não se perde: fica na página, disponível para o dossiê.
    const [page] = await db.select().from(jobPage).where(eq(jobPage.jobId, jobId));
    expect(page!.text).toContain("infraestrutura de agentes");
  });

  it("invalida o score da vaga que acabou de ganhar descrição", async () => {
    // O score guardado foi calculado contra texto nenhum. Mantê-lo faria uma
    // vaga boa continuar no fim da fila com um número que já não descreve nada.
    const preenchida = await seedJob(null);
    await seedPage(preenchida, PAGINA);
    await seedScore(preenchida);

    await parseStored(preenchida);
    expect(await db.select().from(jobScore).where(eq(jobScore.jobId, preenchida))).toEqual([]);
  });

  it("preserva o score quando a descrição não mudou", async () => {
    // Apagar score de vaga intocada obrigaria a recalcular a base inteira a cada
    // reprocessamento, e o custo é do usuário.
    const intocada = await seedJob("Descrição oficial longa e completa. ".repeat(10));
    await seedPage(intocada, PAGINA);
    await seedScore(intocada);

    await parseStored(intocada);
    expect(await db.select().from(jobScore).where(eq(jobScore.jobId, intocada))).toHaveLength(1);
  });
});

describe("runParseStage", () => {
  /** Fila em memória: o estágio é testado sem SQL nem corrida de claim. */
  function fila(tarefas: ClaimedTask[]): QueuePort & {
    completed: Array<[number, ScrapeStatus]>;
    failed: Array<[number, string, boolean]>;
  } {
    const pendentes = [...tarefas];
    const completed: Array<[number, ScrapeStatus]> = [];
    const failed: Array<[number, string, boolean]> = [];
    return {
      completed,
      failed,
      // O estágio dois lê "fetched"; devolver tarefa em "pending" aqui faria o
      // teste passar por engano com as duas etapas cruzadas.
      async claim(status) {
        return status === "fetched" ? (pendentes.shift() ?? null) : null;
      },
      async complete(id, next) {
        completed.push([id, next]);
      },
      async fail(id, error, retryable) {
        failed.push([id, error, retryable]);
      },
      async stats() {
        return {};
      },
    };
  }

  it("conclui o que interpretou e não devolve à fila o que não tem texto", async () => {
    // Reinterpretar uma página que não rendeu nada renderia nada de novo até o
    // extrator mudar — e para isso existe `scrape retry`, sob comando.
    const bom = await seedJob();
    await seedPage(bom, PAGINA);
    const ruim = await seedJob();
    await seedPage(ruim, "<p>oi</p>");

    const q = fila([
      { id: 10, jobId: bom, url: "u", attempts: 0 },
      { id: 11, jobId: ruim, url: "u", attempts: 0 },
    ]);

    const resultado = await runParseStage({ queue: q, concurrency: 1 });
    expect(resultado).toMatchObject({ processed: 2, parsed: 1, failed: 1 });
    expect(q.completed).toEqual([[10, "done"]]);
    expect(q.failed).toEqual([[11, "nenhum texto utilizável na página", false]]);
  });

  it("reporta quantas vagas ficaram sem score para o próximo passo", async () => {
    // O número existe para o operador saber que falta rodar `jobs score`; sem
    // ele, o efeito da interpretação só apareceria por acaso.
    const comScore = await seedJob();
    await seedPage(comScore, PAGINA);
    await seedScore(comScore);
    const semScore = await seedJob();
    await seedPage(semScore, PAGINA);

    const resultado = await runParseStage({
      queue: fila([{ id: 1, jobId: semScore, url: "u", attempts: 0 }]),
      concurrency: 1,
    });
    // A vaga interpretada perdeu o score que tinha? Não — ela nunca teve. A
    // contagem inclui as duas: a que nunca foi pontuada e a que foi invalidada.
    expect(resultado.rescored).toBe(1);
  });

  it("para no limite pedido e trata concorrência zero como um worker", async () => {
    const ids = [await seedJob(), await seedJob(), await seedJob()];
    for (const id of ids) await seedPage(id, PAGINA);

    const resultado = await runParseStage({
      queue: fila(ids.map((jobId, i) => ({ id: i + 1, jobId, url: "u", attempts: 0 }))),
      concurrency: 0,
      limit: 2,
    });
    expect(resultado.processed).toBe(2);
  });

  it("com limite zero não consulta a fila padrão", async () => {
    await expect(runParseStage({ limit: 0 })).resolves.toMatchObject({
      processed: 0,
      parsed: 0,
      failed: 0,
    });
  });
});

describe("reparseAll", () => {
  it("reprocessa toda página capturada sem baixar um byte de novo", async () => {
    // É a razão de existir a separação em dois estágios: melhorar o extrator não
    // pode custar 6.000 downloads nem depender do site continuar no ar.
    const bom = await seedJob();
    await seedPage(bom, PAGINA);
    const ruim = await seedJob();
    await seedPage(ruim, "<p>oi</p>");

    const resultado = await reparseAll();
    expect(resultado).toEqual({ processed: 2, parsed: 1, failed: 1, rescored: 0 });

    const [page] = await db.select().from(jobPage).where(eq(jobPage.jobId, bom));
    expect(page!.text).toContain("infraestrutura de agentes");
  });

  it("não faz nada quando ainda não há página capturada", async () => {
    await expect(reparseAll()).resolves.toEqual({
      processed: 0,
      parsed: 0,
      failed: 0,
      rescored: 0,
    });
  });
});
