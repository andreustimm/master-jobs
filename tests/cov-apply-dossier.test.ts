/**
 * O dossiê de candidatura: tudo que é preciso para aplicar bem a UMA vaga.
 *
 * `matchEvidence` e `significantTerms` já tinham teste puro; o que faltava era
 * `buildDossier`, que é a única parte com banco, perfil e comparação de
 * vocabulário juntos — e é justamente onde mora a regra 7 ("não invente
 * evidência"): nada que não esteja em `evidence:` no `profile.yaml` pode ser
 * citado, e a ausência de descrição tem de ser dita, não maquiada.
 *
 * O perfil aqui é um arquivo temporário apontado por `JHO_PROFILE_PATH`. Usar o
 * `profile/profile.yaml` real deixaria o teste dependente dos dados pessoais do
 * usuário — mudaria de resultado a cada edição de currículo.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDossier } from "../src/core/apply/dossier.ts";
import { ensureCandidate } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import { company, job, jobPage, jobScore, source, targetAccount } from "../src/core/db/schema.ts";
import { seedCatalog } from "../src/contexts/skills/index.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Dez linhas de evidência que casam com o anúncio abaixo, para provar o corte
 * em oito: um dossiê é para ser lido em pé, antes de escrever a carta.
 */
const PROFILE_YAML = `
identity:
  name: Candidato de Teste
  headline: Arquiteto de Software de IA
  location: São Paulo, Brasil
  timezone: America/Sao_Paulo
targets:
  clusters:
    architect:
      weight: 1
      titles: ["Software Architect"]
      cv_variant: architect
constraints: {}
keywords: {}
compensation:
  ranges:
    - currency: USD
      period: year
      floor: 120000
      target: 180000
seniority:
  years_experience: 20
  min_years_expected: 8
  reject_below_years: 3
evidence:
  plataforma:
    - "agent orchestration platform with retries"
    - "audit trail and isolation guarantees"
    - "observability over distributed systems"
    - "Kubernetes workloads and capacity planning"
    - "PostgreSQL data modelling"
    - "event pipelines and contract testing"
    - "incident response playbooks"
    - "cost governance and capacity planning"
    - "remote LATAM delivery"
    - "senior architect owning design decisions"
  legado:
    - "Migrated a COBOL mainframe to a modern stack"
`;

/** Anúncio longo o bastante (>= 400 caracteres) para o dossiê confiar nele. */
const POSTING = [
  "We are hiring a Senior AI Software Architect to design and operate an agent",
  "orchestration platform. You will own retries, audit trail, isolation and",
  "observability across the stack, run production workloads on Kubernetes, and",
  "model data in PostgreSQL. Experience with distributed systems, event",
  "pipelines, capacity planning, incident response, contract testing and cost",
  "governance is expected. Fully remote, LATAM friendly, senior level, design",
  "decisions owned end to end by the architect who takes the role.",
].join(" ");

const CV = "Delivered platforms with Datadog dashboards and PostgreSQL schemas.";

let db: DB;
let candidateId: number;
let profileDir: string;

beforeEach(async () => {
  db = await useTestDb();
  candidateId = await ensureCandidate({ name: "Dono do Dossiê" });
  profileDir = await mkdtemp(join(tmpdir(), "jho-profile-"));
  const path = join(profileDir, "profile.yaml");
  await writeFile(path, PROFILE_YAML);
  process.env.JHO_PROFILE_PATH = path;
  await db.insert(source).values({
    id: "ashby:acme",
    kind: "ashby",
    handle: "acme",
    label: "Acme via Ashby",
  });
});

afterEach(async () => {
  releaseTestDb();
  delete process.env.JHO_PROFILE_PATH;
  await rm(profileDir, { recursive: true, force: true });
});

async function seedJob(input: {
  companyName?: string;
  descriptionText?: string | null;
  applyUrl?: string | null;
  locationRaw?: string | null;
} = {}): Promise<number> {
  const companyName = input.companyName ?? "Acme Labs";
  await db
    .insert(company)
    .values({ slug: "acme-labs", name: companyName })
    .onConflictDoNothing();
  const [inserted] = await db
    .insert(job)
    .values({
      sourceId: "ashby:acme",
      companyName,
      externalId: "vaga-1",
      title: "Senior AI Software Architect",
      url: "https://jobs.example.test/vaga-1",
      applyUrl: input.applyUrl === undefined ? "https://apply.example.test/vaga-1" : input.applyUrl,
      locationRaw: input.locationRaw === undefined ? "Remote · LATAM" : input.locationRaw,
      descriptionText: input.descriptionText === undefined ? POSTING : input.descriptionText,
      fingerprint: "fp-vaga-1",
      contentHash: "hash-vaga-1",
      raw: "{}",
    })
    .returning({ id: job.id });
  return inserted!.id;
}

async function scoreJob(jobId: number, patch: Record<string, unknown> = {}): Promise<void> {
  await db.insert(jobScore).values({
    candidateId,
    jobId,
    fit: 78,
    titleScore: 1,
    keywordScore: 1,
    seniorityScore: 1,
    geoScore: 1,
    compScore: 1,
    cluster: "architect",
    matchedKeywords: [],
    missingKeywords: [],
    reasons: [],
    blockers: [],
    ageDays: 12,
    scorerVersion: "test",
    ...patch,
  });
}

/* ---------------------------------------------------------------- básico -- */

describe("buildDossier", () => {
  it("devolve null quando a vaga não existe", async () => {
    // O chamador precisa distinguir "vaga sumiu" de "vaga sem dado". null é
    // a resposta que a CLI transforma em mensagem, não em stack trace.
    await expect(buildDossier(candidateId, 9999, CV)).resolves.toBeNull();
  });

  it("monta o cabeçalho da vaga a partir do banco, sem score", async () => {
    // Vaga ainda não pontuada é o caso normal logo depois de um sync. O dossiê
    // tem de sair mesmo assim — quem decide se vale aplicar é o usuário.
    const jobId = await seedJob();

    const dossier = await buildDossier(candidateId, jobId, CV);

    expect(dossier?.job).toEqual({
      id: jobId,
      title: "Senior AI Software Architect",
      companyName: "Acme Labs",
      url: "https://jobs.example.test/vaga-1",
      applyUrl: "https://apply.example.test/vaga-1",
      locationRaw: "Remote · LATAM",
      ageDays: null,
    });
    expect(dossier?.fit).toBeNull();
    expect(dossier?.cluster).toBeNull();
    expect(dossier?.blockers).toEqual([]);
  });

  it("traz fit, cluster, idade e bloqueios do score do candidato", async () => {
    const jobId = await seedJob();
    await scoreJob(jobId, { blockers: ["Exige autorização de trabalho nos EUA"] });

    const dossier = await buildDossier(candidateId, jobId, CV);

    expect(dossier).toMatchObject({ fit: 78, cluster: "architect" });
    expect(dossier?.job.ageDays).toBe(12);
    // Bloqueio vem primeiro no tipo porque é a informação mais barata: se
    // elimina, nada abaixo importa.
    expect(dossier?.blockers).toEqual(["Exige autorização de trabalho nos EUA"]);
  });

  it("traduz bloqueio estruturado para português, em vez de mostrar o código", async () => {
    const jobId = await seedJob();
    await scoreJob(jobId, {
      blockers: [{ code: "blocker.eligibility", params: { reason: "authorization-unavailable" } }],
    });

    const dossier = await buildDossier(candidateId, jobId, CV);

    expect(dossier?.blockers).toEqual(["Elegibilidade: autorização de trabalho indisponível"]);
  });

  it("não mostra o score de outro candidato", async () => {
    // `job_score` é por candidato. Vazar o fit alheio seria ler decisão de
    // triagem de outra pessoa.
    const jobId = await seedJob();
    await scoreJob(jobId);
    const outro = await ensureCandidate({ slug: "outro", name: "Outro" });

    await expect(buildDossier(outro, jobId, CV)).resolves.toMatchObject({ fit: null });
  });
});

/* ------------------------------------------------------------- descrição -- */

describe("qualidade da descrição", () => {
  it("avisa e não tenta cruzar vocabulário quando a descrição é curta", async () => {
    // Regra 8: dado faltante é neutro, nunca punitivo. Mas silêncio aqui seria
    // pior: o usuário leria "nenhuma lacuna" e concluiria que o CV está ótimo.
    const jobId = await seedJob({ descriptionText: "Vaga de arquiteto. Remoto." });

    const dossier = await buildDossier(candidateId, jobId, CV);

    expect(dossier?.hasDescription).toBe(false);
    expect(dossier?.warnings.join(" ")).toContain("jho scrape queue");
    expect(dossier?.vocabularyGaps).toEqual([]);
    expect(dossier?.missing).toEqual([]);
  });

  it("trata descrição ausente como descrição insuficiente", async () => {
    const jobId = await seedJob({ descriptionText: null });

    const dossier = await buildDossier(candidateId, jobId, CV);

    expect(dossier?.hasDescription).toBe(false);
    expect(dossier?.evidence).toEqual([]);
  });

  it("prefere a página capturada ao texto do adapter", async () => {
    // A análise só é boa quanto as palavras que enxerga, e a página raspada é
    // a mais completa das duas.
    const jobId = await seedJob({ descriptionText: "resumo curtinho do adapter" });
    await db.insert(jobPage).values({
      jobId,
      finalUrl: "https://jobs.example.test/vaga-1",
      httpStatus: 200,
      text: POSTING,
      extracted: { requirements: ["10+ anos em sistemas distribuídos", "Kubernetes"] },
      contentHash: "page-hash",
    });

    const dossier = await buildDossier(candidateId, jobId, CV);

    expect(dossier?.hasDescription).toBe(true);
    expect(dossier?.requirements).toEqual([
      "10+ anos em sistemas distribuídos",
      "Kubernetes",
    ]);
    expect(dossier?.evidence.length).toBeGreaterThan(0);
  });

  it("aceita página sem campos extraídos sem quebrar", async () => {
    // O parser roda depois do fetch: existe janela em que a página está salva e
    // `extracted` ainda é nulo.
    const jobId = await seedJob();
    await db.insert(jobPage).values({
      jobId,
      finalUrl: "https://jobs.example.test/vaga-1",
      httpStatus: 200,
      text: POSTING,
      extracted: null,
      contentHash: "page-hash",
    });

    await expect(buildDossier(candidateId, jobId, CV)).resolves.toMatchObject({
      requirements: [],
    });
  });
});

/* -------------------------------------------------------------- evidência - */

describe("evidência", () => {
  it("cita só o que está em evidence: e corta em oito linhas", async () => {
    // Regra 7. E o corte existe porque um dossiê com trinta linhas de evidência
    // não é lido: o objetivo é a pessoa escolher três para a carta.
    const jobId = await seedJob();

    const dossier = await buildDossier(candidateId, jobId, CV);

    expect(dossier?.evidence).toHaveLength(8);
    expect(dossier?.evidence.every((e) => e.area === "plataforma")).toBe(true);
    // Mais palavras em comum primeiro: a linha mais forte é a que o usuário lê.
    expect(dossier?.evidence[0]?.matched.length).toBeGreaterThanOrEqual(
      dossier!.evidence[7]!.matched.length,
    );
  });

  it("não reivindica nada quando o anúncio não tem nada em comum", async () => {
    const jobId = await seedJob({
      descriptionText: `Procuramos confeiteiro para produção de doces finos. ${"Massa folhada, chocolate temperado e recheios cremosos fazem parte da rotina. ".repeat(5)}`,
    });

    const dossier = await buildDossier(candidateId, jobId, CV);

    expect(dossier?.hasDescription).toBe(true);
    expect(dossier?.evidence).toEqual([]);
  });
});

/* --------------------------------------------------------------- contatos - */

describe("contatos", () => {
  it("mostra quem o usuário conhece na empresa, casando pelo slug", async () => {
    // Indicação é ~7% dos candidatos e ~40% das contratações. É a pergunta que
    // mais muda o resultado, e por isso vem antes da evidência no dossiê.
    await db.insert(targetAccount).values([
      { name: "Marina Souza", company: "Acme Labs Inc.", category: "peer" },
      { name: "Rui Alves", company: "Acme Labs", category: "former" },
      { name: "Fulano de Outra", company: "Outra Empresa", category: "peer" },
    ]);
    const jobId = await seedJob({ companyName: "Acme Labs" });

    const dossier = await buildDossier(candidateId, jobId, CV);

    // "Acme Labs Inc." e "Acme Labs" colapsam no mesmo slug: sufixo societário
    // é ruído que quebraria o casamento entre fontes.
    expect(dossier?.contacts).toEqual(["Marina Souza", "Rui Alves (ex-colega)"]);
  });

  it("devolve lista vazia quando não há ninguém conhecido ali", async () => {
    const jobId = await seedJob({ companyName: "Empresa Desconhecida" });

    await expect(buildDossier(candidateId, jobId, CV)).resolves.toMatchObject({
      contacts: [],
    });
  });
});

/* ------------------------------------------------------------ vocabulário - */

describe("vocabulário do anúncio contra o CV", () => {
  it("separa reescrita barata de lacuna real", async () => {
    // A distinção é o valor inteiro da análise: "escreva observability onde
    // você escreveu Datadog" é find-and-replace; "aprenda Kubernetes" é
    // carreira. Juntar as duas transforma o relatório em conselho genérico.
    await seedCatalog();
    const jobId = await seedJob();

    const dossier = await buildDossier(candidateId, jobId, CV);

    const gaps = dossier!.vocabularyGaps;
    const observability = gaps.find((g) => g.term === "observability");
    expect(observability?.cvSays).toContain("datadog");
    expect(dossier?.missing).toContain("kubernetes");
    // O que o CV já escreve com a palavra do mercado não aparece em lugar
    // nenhum: não há o que fazer com isso.
    expect(gaps.map((g) => g.term)).not.toContain("postgresql");
    expect(dossier?.missing).not.toContain("postgresql");
  });

  it("avisa quando não há currículo salvo, em vez de dizer que não há lacuna", async () => {
    // Sem CV a comparação é impossível, e "nenhuma lacuna" seria uma mentira
    // tranquilizadora — o pior tipo de saída para esta tela.
    await seedCatalog();
    const jobId = await seedJob();

    const dossier = await buildDossier(candidateId, jobId, null);

    expect(dossier?.warnings.join(" ")).toContain("Nenhum currículo salvo");
    expect(dossier?.vocabularyGaps).toEqual([]);
    expect(dossier?.missing).toEqual([]);
    // A evidência não depende do CV e continua saindo.
    expect(dossier?.evidence.length).toBeGreaterThan(0);
  });

  it("acumula os dois avisos quando falta descrição e falta currículo", async () => {
    const jobId = await seedJob({ descriptionText: "curto" });

    const dossier = await buildDossier(candidateId, jobId, null);

    expect(dossier?.warnings).toHaveLength(2);
  });

  it("não devolve lacuna nenhuma quando o catálogo de skills está vazio", async () => {
    // Instalação nova, antes de `jho skills seed`. Silêncio aqui é correto: não
    // há vocabulário de mercado contra o qual comparar.
    const jobId = await seedJob();

    await expect(buildDossier(candidateId, jobId, CV)).resolves.toMatchObject({
      vocabularyGaps: [],
      missing: [],
      warnings: [],
    });
  });
});
