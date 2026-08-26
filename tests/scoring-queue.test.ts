import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import { saveDocument } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  candidate,
  candidateMatchingProfile,
  job,
  jobScore,
  scoreTask,
  source,
} from "../src/core/db/schema.ts";
import { scoreEveryCandidate } from "../src/core/scoring/apply.ts";
import {
  candidateScoreQueueStatus,
  claimScore,
  enqueueScore,
  MINUTOS_CLAIM_MORTO,
  runScoreQueue,
  scoreQueueDisplay,
  scoreQueueStatus,
} from "../src/core/scoring/queue.ts";
import { seedCatalog } from "../src/contexts/skills/index.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * A fila de repontuação, acionada por evento.
 *
 * ## Por que uma fila, e não recalcular ao salvar
 *
 * Currículo salvo muda o que o ranking deveria dizer — é dele que sai o perfil
 * de matching, e do perfil sai a nota de cada vaga. Mas recalcular dentro do
 * pedido são milhares de gravações, e quem acabou de colar o CV ficaria olhando
 * um formulário travado.
 *
 * ## O que estes casos protegem
 *
 * Três coisas, e nenhuma é o caminho feliz: que salvar três vezes não vire três
 * repontuações, que dois trabalhadores não peguem a mesma tarefa, e que um
 * processo morto não trave o candidato para sempre.
 */

let db: DB;
let relogio: ReturnType<typeof fixedClock>;

const CURRICULO = [
  "Andreus Timm — Senior AI Software Architect.",
  "Construí plataformas com rag e agentes em produção, com evals e guardrails.",
  "Experiência com typescript, python e postgres em ambientes multi-tenant.",
].join("\n");

beforeEach(async () => {
  db = await useTestDb();
  relogio = fixedClock("2026-08-21T12:00:00.000Z");
  setClock(relogio);
});

afterEach(() => {
  resetClock();
  releaseTestDb();
});

async function criarCandidato(slug = "dono"): Promise<number> {
  const [c] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: slug === "dono" })
    .returning({ id: candidate.id });
  return c!.id;
}

async function semearVaga(externo: string): Promise<void> {
  await db
    .insert(source)
    .values({ id: "manual:fila", kind: "manual", handle: "fila", label: "Fila" })
    .onConflictDoNothing();
  await db.insert(job).values({
    sourceId: "manual:fila",
    companyName: "Acme",
    externalId: externo,
    title: "AI Solutions Architect",
    descriptionText: "Remote LATAM. rag, agentes, typescript, python, postgres, multi-tenant.",
    locationRaw: "Remote LATAM",
    url: `manual://fila/${externo}`,
    fingerprint: externo,
    contentHash: externo,
    raw: "{}",
  });
}

describe("o evento: salvar currículo enfileira", () => {
  it("salvar um CV põe o candidato na fila", async () => {
    const id = await criarCandidato();

    await saveDocument({ candidateId: id, label: "cv.md", content: CURRICULO });

    const [tarefa] = await db.select().from(scoreTask).where(eq(scoreTask.candidateId, id));
    expect(tarefa?.status).toBe("pending");
    // A origem diz que há gente esperando resultado, e é o que põe este pedido
    // acima da varredura periódica na ordem da fila.
    expect(tarefa?.origin).toBe("cv");
    expect(tarefa?.priority).toBeGreaterThan(0);
  });

  it("salvar três vezes produz UMA tarefa, não três", async () => {
    const id = await criarCandidato();

    await saveDocument({ candidateId: id, label: "v1", content: CURRICULO });
    await saveDocument({ candidateId: id, label: "v2", content: `${CURRICULO}\nGo.` });
    await saveDocument({ candidateId: id, label: "v3", content: `${CURRICULO}\nGo. Rust.` });

    // Corrigir um erro, colar de novo, ajustar uma linha: sem o índice único
    // seriam três repontuações completas do acervo para chegar ao mesmo lugar.
    const tarefas = await db.select().from(scoreTask).where(eq(scoreTask.candidateId, id));
    expect(tarefas).toHaveLength(1);
  });

  it("documento que não é currículo não enfileira", async () => {
    const id = await criarCandidato();

    await saveDocument({ candidateId: id, kind: "carta", label: "carta", content: "Prezados," });

    // Só o currículo alimenta o perfil de matching. Enfileirar por carta de
    // apresentação gastaria uma repontuação inteira sem mudar nada.
    expect(await db.select().from(scoreTask)).toHaveLength(0);
  });

  it("salvar o MESMO conteúdo de novo não enfileira", async () => {
    const id = await criarCandidato();
    await saveDocument({ candidateId: id, label: "cv", content: CURRICULO });
    await db.delete(scoreTask);

    await saveDocument({ candidateId: id, label: "cv de novo", content: CURRICULO });

    // `saveDocument` devolve `unchanged` quando o texto é idêntico. Repontuar aí
    // seria trabalho garantidamente sem efeito.
    expect(await db.select().from(scoreTask)).toHaveLength(0);
  });
});

describe("status da fila por candidato", () => {
  it("UT-004: mapeia pending sem erro bruto", async () => {
    const id = await criarCandidato();
    await enqueueScore(id);

    expect(await candidateScoreQueueStatus(id)).toEqual({
      pending: 1,
      scoring: 0,
      done: 0,
      failed: 0,
      scored: null,
      lastError: null,
    });
  });

  it.each([
    ["scoring", 0, "falha transitória"],
    ["done", 42, null],
    ["failed", null, "segredo interno que nunca chega à interface"],
  ] as const)("UT-005: mapeia %s e preserva metadados", async (status, scored, lastError) => {
    const id = await criarCandidato(status);
    await db.insert(scoreTask).values({ candidateId: id, status, scored, lastError });

    const snapshot = await candidateScoreQueueStatus(id);

    expect(snapshot).toMatchObject({
      pending: 0,
      scoring: status === "scoring" ? 1 : 0,
      done: status === "done" ? 1 : 0,
      failed: status === "failed" ? 1 : 0,
      scored,
      lastError,
    });
  });

  it("UT-006: não inclui a fila de outro candidato", async () => {
    const a = await criarCandidato("isolado-a");
    const b = await criarCandidato("isolado-b");
    await db.insert(scoreTask).values([
      { candidateId: a, status: "pending" },
      { candidateId: b, status: "failed", lastError: "erro de b" },
    ]);

    expect(await candidateScoreQueueStatus(a)).toMatchObject({
      pending: 1,
      failed: 0,
      lastError: null,
    });
    expect(await scoreQueueStatus(a)).toEqual({ pending: 1 });
  });

  it("UT-007: candidato sem linha retorna idle explícito", async () => {
    const id = await criarCandidato();

    const snapshot = await candidateScoreQueueStatus(id);

    expect(snapshot).toBeNull();
    expect(scoreQueueDisplay(snapshot)).toEqual({ state: "idle", scored: null });
  });

  it("UT-008: mapper de apresentação descarta lastError e falha com erro persistido", () => {
    const display = scoreQueueDisplay({
      pending: 0,
      scoring: 0,
      done: 0,
      failed: 1,
      scored: null,
      lastError: "token=nao-pode-aparecer",
    });

    expect(display).toEqual({ state: "failed", scored: null });
    expect(JSON.stringify(display)).not.toContain("nao-pode-aparecer");

    expect(scoreQueueDisplay({
      pending: 0,
      scoring: 0,
      done: 1,
      failed: 0,
      scored: 0,
      lastError: "catalogo-vazio",
    })).toEqual({ state: "failed", scored: 0 });

    expect(scoreQueueDisplay({
      pending: 1,
      scoring: 0,
      done: 0,
      failed: 0,
      scored: null,
      lastError: "falha-transitoria",
    })).toEqual({ state: "pending", scored: null });

    expect(scoreQueueDisplay({
      pending: 0,
      scoring: 1,
      done: 0,
      failed: 0,
      scored: null,
      lastError: "falha-transitoria",
    })).toEqual({ state: "scoring", scored: null });
  });

  it("distingue candidato sem CV de candidato com CV sem tarefa", () => {
    expect(scoreQueueDisplay(null, false)).toEqual({ state: "noCv", scored: null });
    expect(scoreQueueDisplay(null, true)).toEqual({ state: "idle", scored: null });
  });
});

describe("a reivindicação", () => {
  it("dois trabalhadores não pegam a mesma tarefa", async () => {
    const id = await criarCandidato();
    await enqueueScore(id);

    const primeiro = await claimScore("worker-a");
    const segundo = await claimScore("worker-b");

    // `UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING` numa instrução.
    // Ler antes de escrever faria os dois pontuarem o mesmo candidato — e o
    // desperdício seria silencioso, porque o resultado é idêntico.
    expect(primeiro?.candidateId).toBe(id);
    expect(segundo).toBeNull();
  });

  it("claim pendurado volta para a fila depois do prazo", async () => {
    const id = await criarCandidato();
    await enqueueScore(id);
    expect(await claimScore("worker-morto")).not.toBeNull();

    relogio.advance((MINUTOS_CLAIM_MORTO + 1) * 60_000);

    // Um processo morto no meio não pode travar o candidato para sempre.
    expect(await claimScore("worker-vivo")).not.toBeNull();
  });

  it("antes do prazo, continua reivindicada", async () => {
    const id = await criarCandidato();
    await enqueueScore(id);
    await claimScore("worker-lento");

    relogio.advance((MINUTOS_CLAIM_MORTO - 1) * 60_000);

    // Prazo curto demais faria a fila reprocessar o que ainda está rodando, e
    // dois trabalhadores gravariam por cima um do outro.
    expect(await claimScore("worker-apressado")).toBeNull();
  });

  it("prioridade maior roda antes", async () => {
    const periodico = await criarCandidato("periodico");
    const pedido = await criarCandidato("pedido");
    await enqueueScore(periodico, { origin: "periodic" });
    await enqueueScore(pedido, { origin: "cv" });

    // Quem está esperando na tela vem antes da varredura.
    expect((await claimScore("w"))?.candidateId).toBe(pedido);
  });

  it("pedido do usuário não é rebaixado por uma varredura posterior", async () => {
    const id = await criarCandidato();
    await enqueueScore(id, { origin: "cv" });
    await enqueueScore(id, { origin: "periodic" });

    const [tarefa] = await db.select().from(scoreTask).where(eq(scoreTask.candidateId, id));
    // O `max` no upsert. Sem ele, a varredura que chega entre o pedido e o
    // trabalhador jogaria a pessoa para o fim da fila.
    expect(tarefa!.priority).toBeGreaterThan(0);
  });
});

describe("o consumo", () => {
  it("candidato SEM currículo é concluído sem pontuar nada", async () => {
    const id = await criarCandidato();
    await semearVaga("v1");
    await enqueueScore(id, { origin: "periodic" });

    const r = await runScoreQueue({ worker: "teste" });

    // Pontuar com o perfil padrão da instalação daria a essa pessoa o ranking de
    // outra, COM A APARÊNCIA DE SER DELA. Board sem ranking é o estado honesto:
    // a tela convida a subir um currículo, e é disso que o perfil sai.
    expect(r.processadas).toBe(1);
    expect(r.pontuadas).toBe(0);
    expect(await db.select().from(jobScore).where(eq(jobScore.candidateId, id))).toHaveLength(0);

    const [tarefa] = await db.select().from(scoreTask);
    expect(tarefa!.status).toBe("done");
    expect(tarefa!.lastError).toBe("sem-curriculo");
  });

  it("candidato COM currículo é pontuado, e o perfil sai do CV", async () => {
    // O catálogo é a referência da extração: sem ele nenhum currículo produz
    // skill nenhuma, e o candidato cairia em `catalogo-vazio`.
    await seedCatalog();
    const id = await criarCandidato();
    await semearVaga("v1");
    await semearVaga("v2");
    await saveDocument({ candidateId: id, label: "cv", content: CURRICULO });

    const r = await runScoreQueue({ worker: "teste" });

    expect(r.processadas).toBe(1);
    expect(r.pontuadas).toBe(2);
    const notas = await db.select().from(jobScore).where(eq(jobScore.candidateId, id));
    expect(notas).toHaveLength(2);

    const [tarefa] = await db.select().from(scoreTask);
    expect(tarefa!.status).toBe("done");
    expect(tarefa!.scored).toBe(2);
  });

  it("`--max` para onde mandaram", async () => {
    await seedCatalog();
    await semearVaga("v1");
    for (const slug of ["a", "b", "c"]) {
      const id = await criarCandidato(slug);
      await saveDocument({ candidateId: id, label: "cv", content: CURRICULO });
    }

    const r = await runScoreQueue({ max: 2, worker: "teste" });

    // Numa função serverless com teto de tempo, drenar a fila inteira é como se
    // fica sem resposta no meio.
    expect(r.processadas).toBe(2);
    expect(await scoreQueueStatus()).toMatchObject({ pending: 1 });
  });

  it("fila vazia devolve zero sem estourar", async () => {
    expect(await runScoreQueue({ worker: "teste" })).toEqual({
      processadas: 0,
      pontuadas: 0,
      falhas: 0,
    });
  });

  it("o status conta por estado", async () => {
    const a = await criarCandidato("a");
    const b = await criarCandidato("b");
    await enqueueScore(a);
    await enqueueScore(b);
    await claimScore("w");

    expect(await scoreQueueStatus()).toEqual({ pending: 1, scoring: 1 });
  });
});

describe("o catálogo é pré-requisito", () => {
  it("sem catálogo semeado, o diagnóstico é da instalação e não do currículo", async () => {
    const id = await criarCandidato();
    await semearVaga("v1");
    await saveDocument({ candidateId: id, label: "cv", content: CURRICULO });

    const r = await runScoreQueue({ worker: "teste" });

    expect(r.pontuadas).toBe(0);
    const [tarefa] = await db.select().from(scoreTask);
    // `catalogo-vazio` e não `curriculo-fraco`: a correção é `jho skills seed`,
    // não pedir à pessoa que reescreva um texto que está ótimo. Foi um teste
    // que revelou esta confusão — o caminho feliz não a mostrava.
    expect(tarefa!.lastError).toBe("catalogo-vazio");
  });
});

/**
 * `scoreEveryCandidate` — a travessia que a varredura diária usa.
 *
 * O caso que importa é o de PULAR. Foi defeito real: a primeira versão pontuava
 * todo candidato, e quem não tinha currículo recebia o ranking calculado com o
 * perfil do dono da instalação — com a aparência de ser dele. Descoberto rodando
 * contra dados reais, com 2.757 pontuações já gravadas na conta errada.
 */
describe("scoreEveryCandidate", () => {
  it("pontua quem tem currículo e PULA quem não tem", async () => {
    await seedCatalog();
    await semearVaga("v1");
    const comCv = await criarCandidato("com-cv");
    const semCv = await criarCandidato("sem-cv");
    await saveDocument({ candidateId: comCv, label: "cv", content: CURRICULO });

    const linhas = await scoreEveryCandidate();
    const porSlug = Object.fromEntries(linhas.map((l) => [l.slug, l]));

    expect(porSlug["com-cv"]!.scored).toBe(1);
    expect(porSlug["com-cv"]!.perfil).toBe("derivado");

    // O ranking de quem não subiu currículo NÃO é o do dono da instalação.
    expect(porSlug["sem-cv"]!.scored).toBe(0);
    expect(porSlug["sem-cv"]!.perfil).toBe("sem-curriculo");
    expect(await db.select().from(jobScore).where(eq(jobScore.candidateId, semCv))).toHaveLength(0);
  });

  it("candidato que estoura não derruba os outros", async () => {
    await seedCatalog();
    await semearVaga("v1");
    const bom = await criarCandidato("bom");
    await saveDocument({ candidateId: bom, label: "cv", content: CURRICULO });

    // Perfil gravado como JSON inválido: a leitura estoura ao interpretá-lo. Um
    // dado corrompido é problema de uma pessoa; abortar a varredura deixaria
    // todo mundo sem pontuação nova.
    const quebrado = await criarCandidato("quebrado");
    await db
      .insert(candidateMatchingProfile)
      .values({ candidateId: quebrado, profileJson: "{ isto nao e json" });

    const linhas = await scoreEveryCandidate();
    const porSlug = Object.fromEntries(linhas.map((l) => [l.slug, l]));

    expect(porSlug["bom"]!.scored).toBe(1);
    // Registrado com zero e seguido adiante: quem lê o relatório sabe onde olhar.
    expect(porSlug["quebrado"]!.scored).toBe(0);
    expect(linhas).toHaveLength(2);
  });
});
