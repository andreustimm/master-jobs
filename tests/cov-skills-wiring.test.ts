import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidate, job, jobScore, source } from "../src/core/db/schema.ts";
import {
  SKILL_CATALOG,
  auditSkill,
  candidateSkills,
  jobVocabularyComparison,
  listCatalog,
  seedCatalog,
  skillDemand,
  skillExtraction,
  vocabularyGap,
} from "../src/contexts/skills/index.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * O contexto de skills composto — a fachada que o CLI e o dashboard chamam.
 *
 * As camadas já têm teste com dublê. O que nenhum deles pega é **fiação
 * trocada**: `vocabularyGap` apontado para o catálogo em vez do corpus, ou
 * `skillDemand` montado sem o adapter de candidato, passariam por todos os
 * testes de unidade e entregariam um relatório plausível e errado. Um relatório
 * de carreira errado é pior que nenhum — ele é acionado.
 *
 * Por isso aqui nada é dublado: banco real, catálogo real, uma função só.
 */

let db: DB;
let candidatoId: number;

const CV = [
  "## KEY TECHNOLOGIES",
  "Go, Kafka, Datadog",
  "## PROFESSIONAL EXPERIENCE",
  "* Built an ingestion pipeline in Go on top of Kafka",
  "* Designed dashboards in Datadog for the whole platform",
].join("\n");

/**
 * A descrição precisa passar dos 400 caracteres: o corpus descarta anúncio
 * curto demais para ler, porque ele diluiria toda frequência sem trazer
 * vocabulário próprio. O texto abaixo é do tamanho de uma vaga de verdade.
 */
const VAGA = [
  "Staff Platform Engineer",
  "We need strong Go and Kafka experience.",
  "Observability is central to the role: you will own observability end to end.",
  "Kubernetes knowledge is required for the platform team.",
  "The successful candidate ships production systems and mentors engineers.",
  "You will partner with product teams to define service level objectives,",
  "run incident reviews without blame, and keep the platform boring on purpose.",
  "We care about written communication and about decisions that survive review.",
  "This is a fully remote position open to contractors outside the United States.",
].join("\n");

async function seedVaga(externalId: string, fit: number, texto: string): Promise<void> {
  await db
    .insert(source)
    .values({ id: "manual:wiring", kind: "manual", handle: "wiring", label: "Wiring" })
    .onConflictDoNothing({ target: source.id });
  const [posting] = await db
    .insert(job)
    .values({
      sourceId: "manual:wiring",
      companyName: "Empresa",
      externalId,
      title: "Staff Platform Engineer",
      descriptionText: texto,
      url: `https://exemplo.test/${externalId}`,
      fingerprint: `wiring-${externalId}`,
      contentHash: `wiring-hash-${externalId}`,
      raw: "{}",
    })
    .returning({ id: job.id });
  await db.insert(jobScore).values({
    candidateId: candidatoId,
    jobId: posting!.id,
    fit,
    titleScore: 0,
    keywordScore: 0,
    seniorityScore: 0,
    geoScore: 0,
    compScore: 0,
    cluster: "architect",
    matchedKeywords: [],
    missingKeywords: [],
    reasons: [],
    blockers: [],
    scorerVersion: "test",
  });
}

beforeEach(async () => {
  db = await useTestDb();
  const [row] = await db
    .insert(candidate)
    .values({ slug: "wiring", name: "Wiring" })
    .returning({ id: candidate.id });
  candidatoId = row!.id;
});

afterEach(() => releaseTestDb());

describe("catálogo pela fachada", () => {
  it("semeia o catálogo tipado e é idempotente na segunda passada", async () => {
    // O seed roda em toda instalação e a cada atualização do catálogo. Se a
    // segunda execução inserisse de novo, o índice único quebraria — ou, pior,
    // duplicaria a mesma skill sob dois ids e a auditoria se dividiria em duas.
    const primeiro = await seedCatalog();
    expect(primeiro.inserted).toBe(SKILL_CATALOG.length);
    expect(primeiro.updated).toBe(0);

    const segundo = await seedCatalog();
    expect(segundo.inserted).toBe(0);
    expect(segundo.updated).toBe(SKILL_CATALOG.length);
  });

  it("lista tudo, ou só uma categoria, sem inventar entrada", async () => {
    await seedCatalog();

    const tudo = await listCatalog();
    expect(tudo).toHaveLength(SKILL_CATALOG.length);

    const linguagens = await listCatalog("language");
    expect(linguagens.length).toBeGreaterThan(0);
    expect(linguagens.every((s) => s.category === "language")).toBe(true);
    expect(linguagens.length).toBeLessThan(tudo.length);
  });
});

describe("extração e auditoria pela fachada", () => {
  it("extrai do CV, persiste como detectado e a re-extração não duplica", async () => {
    await seedCatalog();

    const primeira = await skillExtraction({ candidateId: candidatoId, text: CV });
    expect(primeira.added).toBeGreaterThan(0);
    expect(primeira.detections.map((d) => d.skill.slug)).toContain("go");

    const segunda = await skillExtraction({ candidateId: candidatoId, text: CV });
    // Nada novo: o mesmo documento produz as mesmas linhas, agora atualizadas.
    expect(segunda.added).toBe(0);
    expect(segunda.refreshed).toBe(primeira.added);

    const linhas = await candidateSkills(candidatoId);
    expect(linhas).toHaveLength(primeira.added);
    expect(linhas.every((l) => l.status === "detected")).toBe(true);
  });

  it("confirmar sobrevive à re-extração e some do filtro de 'detected'", async () => {
    // O ciclo completo do invariante: a decisão humana entra, o documento é
    // reprocessado, e a decisão continua lá. É o que faz alguém auditar cem
    // skills sabendo que o trabalho não vai evaporar no próximo upload.
    await seedCatalog();
    await skillExtraction({ candidateId: candidatoId, text: CV });

    const [linha] = await candidateSkills(candidatoId, "detected");
    await auditSkill(candidatoId, linha!.id, "confirmed", { level: "avançado", by: "dono" });

    const reextraida = await skillExtraction({ candidateId: candidatoId, text: CV });
    expect(reextraida.preserved).toBe(1);

    const confirmadas = await candidateSkills(candidatoId, "confirmed");
    expect(confirmadas.map((c) => c.slug)).toEqual([linha!.slug]);
    expect(confirmadas[0]!.level).toBe("avançado");
    expect(
      (await candidateSkills(candidatoId, "detected")).some((l) => l.slug === linha!.slug),
    ).toBe(false);
  });

  it("auditar linha inexistente falha alto, citando o candidato", async () => {
    // A mensagem nomeia o escopo de propósito: o erro mais provável é o id ter
    // vindo da tela de outro candidato, e o operador precisa ver isso.
    await expect(auditSkill(candidatoId, 4242, "confirmed")).rejects.toThrow(
      `Skill 4242 not found for candidate ${candidatoId}`,
    );
  });
});

describe("demanda e lacuna pela fachada", () => {
  it("mede demanda sobre o corpus escopado do candidato", async () => {
    await seedCatalog();
    await seedVaga("a", 90, VAGA);
    await seedVaga("b", 85, VAGA);
    // Abaixo do piso de fit: existe no banco e não pode entrar na conta.
    await seedVaga("c", 20, VAGA);

    const demanda = await skillDemand({ candidateId: candidatoId });
    const kubernetes = demanda.find((d) => d.slug === "kubernetes");

    expect(kubernetes).toBeDefined();
    // Duas vagas no recorte, as duas pedindo — demanda 1, não 2/3.
    expect(kubernetes!.postings).toBe(2);
    expect(kubernetes!.demand).toBe(1);
    expect(kubernetes!.candidateStatus).toBeNull();
  });

  it("o relatório de lacuna separa vocabulário de lacuna real", async () => {
    // O achado que justifica a feature inteira: o CV documenta a experiência
    // com nomes de ferramenta e o mercado busca a palavra guarda-chuva. Isso é
    // find-and-replace, não gap de carreira — e confundir os dois é o que faz
    // conselho genérico mandar um arquiteto "aprender observabilidade".
    await seedCatalog();
    await seedVaga("a", 90, VAGA);
    await seedVaga("b", 88, VAGA);

    const relatorio = await vocabularyGap({ candidateId: candidatoId, cvText: CV });

    expect(relatorio.totalJobs).toBe(2);
    const slugs = (kind: string) =>
      relatorio.items.filter((i) => i.kind === kind).map((i) => i.skill.slug);

    // Go aparece nos dois lados, na mesma palavra: coberto.
    expect(slugs("covered")).toContain("go");
    // Datadog está no CV, "observability" está nas vagas: só falta a palavra.
    expect(slugs("vocabulary")).toContain("observability");
    // Kubernetes o mercado pede e o CV não mostra de forma nenhuma.
    expect(slugs("missing")).toContain("kubernetes");

    expect(relatorio.quickWins.every((i) => i.rewriteValue > 0)).toBe(true);
  });

  it("sem corpus, a lacuna é um relatório vazio e não um alarme falso", async () => {
    // Instalação nova, antes do primeiro sync. Zero vagas não significa que o
    // currículo não tem nada — significa que não há mercado medido.
    await seedCatalog();
    const relatorio = await vocabularyGap({ candidateId: candidatoId, cvText: CV });

    expect(relatorio).toMatchObject({ totalJobs: 0, items: [], quickWins: [], realGaps: [] });
  });

  it("comparação com UMA vaga não precisa de corpus nem de piso de demanda", async () => {
    // Aqui a pergunta é outra: não "o que o mercado usa", e sim "o que ESTA
    // vaga escreve". Com uma só vaga, qualquer piso de demanda descartaria
    // tudo — por isso o piso é zero neste caminho.
    await seedCatalog();

    const relatorio = await jobVocabularyComparison({ cvText: CV, jobText: VAGA });

    expect(relatorio.totalJobs).toBe(1);
    expect(relatorio.items.length).toBeGreaterThan(0);
    expect(relatorio.items.map((i) => i.skill.slug)).toContain("kubernetes");
    expect(relatorio.realGaps.map((i) => i.skill.slug)).toContain("kubernetes");
  });
});
