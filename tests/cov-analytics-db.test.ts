/**
 * Suíte: `src/core/analytics/index.ts` — a composição entre banco e estatística.
 *
 * Invariante: este arquivo só busca e liga. Toda decisão numérica mora em
 * `stats.ts`, `funnel.ts` e `scorer-diagnostics.ts`. O que se testa aqui é
 * portanto o *recorte*: quais linhas entram na conta, sob qual candidato, e o
 * que acontece com o que o banco devolve nulo.
 *
 * Fronteira DENTRO: libSQL real em memória migrado com as migrations do projeto.
 * Fronteira FORA: a matemática em si, coberta por `cov-analytics-pure.test.ts`
 * e por `analytics.test.ts`.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { funnelAnalysis, scorerDiagnostics } from "../src/core/analytics/index.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  candidate,
  company,
  job,
  jobScore,
  source,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

async function seedCandidate(slug: string, isDefault = false): Promise<number> {
  const [row] = await db
    .insert(candidate)
    .values({ slug, name: `Candidato ${slug}`, isDefault })
    .returning({ id: candidate.id });
  return row!.id;
}

async function seedSource(id: string, kind: string): Promise<void> {
  await db
    .insert(source)
    .values({ id, kind, handle: id.split(":")[1]!, label: id })
    .onConflictDoNothing();
}

/** Uma vaga por chamada; o fingerprint é o que a deduplicação usaria. */
async function seedJob(n: number, sourceId = "lever:acme"): Promise<number> {
  await seedSource(sourceId, sourceId.split(":")[0]!);
  const [c] = await db
    .insert(company)
    .values({ slug: `empresa-${n}`, name: `Empresa ${n}` })
    .onConflictDoNothing()
    .returning({ id: company.id });
  const [j] = await db
    .insert(job)
    .values({
      sourceId,
      companyId: c?.id ?? null,
      companyName: `Empresa ${n}`,
      externalId: `ext-${n}`,
      title: `Arquiteto ${n}`,
      url: `https://exemplo.test/${n}`,
      fingerprint: `fp-${n}`,
      contentHash: `ch-${n}`,
      raw: "{}",
    })
    .returning({ id: job.id });
  return j!.id;
}

type ComponentValues = {
  fit: number;
  titleScore?: number;
  keywordScore?: number;
  geoScore?: number;
  seniorityScore?: number;
  compScore?: number;
  freshnessScore?: number;
  benefitScore?: number;
  cluster?: string;
};

async function seedScore(
  candidateId: number,
  jobId: number,
  values: ComponentValues,
): Promise<void> {
  await db.insert(jobScore).values({
    candidateId,
    jobId,
    fit: values.fit,
    titleScore: values.titleScore ?? 0,
    keywordScore: values.keywordScore ?? 0,
    seniorityScore: values.seniorityScore ?? 0,
    geoScore: values.geoScore ?? 0,
    compScore: values.compScore ?? 0,
    freshnessScore: values.freshnessScore ?? 0,
    benefitScore: values.benefitScore ?? 0,
    penalty: 0,
    cluster: values.cluster ?? "architect",
    matchedKeywords: [],
    missingKeywords: [],
    detectedBenefits: [],
    ageDays: null,
    reasons: [],
    blockers: [],
    scorerVersion: "teste",
  });
}

describe("scorerDiagnostics", () => {
  it("diagnostica os sete componentes com o peso declarado no scorer", async () => {
    // O diagnóstico só é acionável se cada linha souber quanto o componente
    // *deveria* valer — é a comparação entre peso pretendido e dispersão obtida
    // que revela peso morto. Ler o peso de outro lugar que não `WEIGHTS` deixaria
    // o relatório mentir silenciosamente após um ajuste de rubrica.
    const candidateId = await seedCandidate("dono", true);
    for (let i = 0; i < 40; i++) {
      const jobId = await seedJob(i);
      await seedScore(candidateId, jobId, {
        fit: 40 + (i % 30),
        titleScore: (i % 30) + 1,
        keywordScore: (i % 13) + 1,
        geoScore: 15,
        seniorityScore: (i % 7) + 1,
        compScore: i % 8,
        freshnessScore: 3,
        benefitScore: i % 4,
      });
    }

    const d = await scorerDiagnostics(candidateId);

    expect(d.jobs).toBe(40);
    expect(d.components.map((c) => c.label)).toEqual([
      "Cargo",
      "Palavras-chave",
      "Elegibilidade",
      "Senioridade",
      "Remuneração",
      "Frescor",
      "Benefícios",
    ]);
    expect(d.components.find((c) => c.label === "Cargo")!.weight).toBe(30);
    expect(d.components.find((c) => c.label === "Benefícios")!.weight).toBe(4);
    // Elegibilidade deu 15 em toda vaga: peso alto sem efeito nenhum na ordem.
    expect(d.components.find((c) => c.label === "Elegibilidade")!.verdict).toBe("dead-weight");
    expect(d.fit.mean).toBeGreaterThan(0);
  });

  it("exclui vaga fechada do acervo — histórico não é corpus de ranqueamento", async () => {
    // Vaga fechada continua no banco por causa da regra 3 (nunca deletar), mas
    // contá-la aqui diagnosticaria o scorer contra vagas que ninguém pode mais
    // pleitear, e a dispersão relatada seria a de um acervo que não existe.
    const candidateId = await seedCandidate("dono", true);
    const vivo = await seedJob(1);
    const fechado = await seedJob(2);
    await seedScore(candidateId, vivo, { fit: 70, titleScore: 30 });
    await seedScore(candidateId, fechado, { fit: 10, titleScore: 1 });
    await db
      .update(job)
      .set({ closedAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(job.id, fechado));

    const d = await scorerDiagnostics(candidateId);

    expect(d.jobs).toBe(1);
    expect(d.fit.mean).toBe(70);
  });

  it("diagnostica o acervo de um candidato sem enxergar o do outro", async () => {
    // Score é escopado por candidato (regra de isolamento do Pursuit). Um
    // diagnóstico que vazasse o acervo alheio descreveria uma rubrica que não é
    // a de ninguém.
    const primeiro = await seedCandidate("primeiro", true);
    const segundo = await seedCandidate("segundo");
    const jobId = await seedJob(1);
    await seedScore(primeiro, jobId, { fit: 90, titleScore: 30 });
    await seedScore(segundo, jobId, { fit: 12, titleScore: 2 });

    await expect(scorerDiagnostics(primeiro)).resolves.toMatchObject({ jobs: 1 });
    expect((await scorerDiagnostics(primeiro)).fit.mean).toBe(90);
    expect((await scorerDiagnostics(segundo)).fit.mean).toBe(12);
  });

  it("sobrevive a um candidato que ainda não pontuou nada", async () => {
    // É o estado do primeiro minuto de uso. Uma exceção aqui transformaria
    // `jho stats` em comando que só funciona depois do primeiro sync.
    const candidateId = await seedCandidate("novo", true);
    const d = await scorerDiagnostics(candidateId);

    expect(d.jobs).toBe(0);
    expect(d.fit.mean).toBe(0);
    expect(d.warnings.join(" ")).toContain("não são estáveis");
  });
});

describe("funnelAnalysis", () => {
  it("agrupa por tipo de fonte, não pelo handle, e mantém cluster e canal", async () => {
    // `source_id` é "kind:handle". Agrupar pelo id inteiro criaria um grupo por
    // board — n=1 em cada — e nenhuma comparação seria possível. O que generaliza
    // é o tipo de fonte.
    const candidateId = await seedCandidate("dono", true);
    for (let i = 0; i < 36; i++) {
      const kind = i % 2 === 0 ? "lever" : "greenhouse";
      const jobId = await seedJob(i, `${kind}:board-${i}`);
      await seedScore(candidateId, jobId, {
        fit: 50 + (i % 20),
        titleScore: (i % 20) + 1,
        cluster: i % 3 === 0 ? "backend" : "architect",
      });
      await db.insert(application).values({
        candidateId,
        jobId,
        status: i % 4 === 0 ? "screening" : "applied",
        channel: i % 2 === 0 ? "referral" : "direct",
      });
    }

    const r = await funnelAnalysis(candidateId);

    expect(r.applied).toBe(36);
    expect(r.trustworthy).toBe(true);
    expect(r.bySource.map((g) => g.group).sort()).toEqual(["greenhouse", "lever"]);
    expect(r.byCluster.map((g) => g.group).sort()).toEqual(["architect", "backend"]);
    expect(r.byChannel.map((g) => g.group).sort()).toEqual(["direct", "referral"]);
    // Os sete componentes viram série de sinal, com o rótulo legível da rubrica.
    expect(r.componentSignal.map((c) => c.key).sort()).toEqual([
      "Benefícios",
      "Cargo",
      "Elegibilidade",
      "Frescor",
      "Palavras-chave",
      "Remuneração",
      "Senioridade",
    ]);
  });

  it("aceita candidatura sem score, sem transformar ausência em zero", async () => {
    // Vaga rastreada antes de pontuar — ou pontuada por outro candidato — chega
    // aqui com `fit` nulo. Converter para 0 diria "candidatei-me a uma vaga
    // péssima", que é uma afirmação sobre a triagem que o dado não sustenta.
    const candidateId = await seedCandidate("dono", true);
    const semScore = await seedJob(1);
    const comScore = await seedJob(2);
    await seedScore(candidateId, comScore, { fit: 80 });
    await db.insert(application).values([
      { candidateId, jobId: semScore, status: "applied", channel: null },
      { candidateId, jobId: comScore, status: "rejected", channel: "direct" },
    ]);

    const r = await funnelAnalysis(candidateId);

    expect(r.applied).toBe(2);
    // Uma rejeição é resposta: metade do funil recebeu retorno.
    expect(r.replied).toBe(1);
    expect(r.trustworthy).toBe(false);
    expect(r.power).toContain("não distingue um sistema bom de um ruim");
  });

  it("lê o funil de um candidato sem contar a candidatura do outro", async () => {
    const primeiro = await seedCandidate("primeiro", true);
    const segundo = await seedCandidate("segundo");
    const jobId = await seedJob(1);
    await db.insert(application).values([
      { candidateId: primeiro, jobId, status: "applied" },
      { candidateId: segundo, jobId, status: "offer" },
    ]);

    expect((await funnelAnalysis(primeiro)).replied).toBe(0);
    expect((await funnelAnalysis(segundo)).replied).toBe(1);
  });

  it("não quebra quando a candidatura aponta para uma vaga que sumiu do banco", async () => {
    // Não deveria acontecer — a chave estrangeira é `cascade` e a regra 3 proíbe
    // deletar vaga. Mas `pragma foreign_keys` não vem ligado em toda instalação
    // do libSQL, e banco restaurado de backup parcial chega assim. Análise que
    // estoura nesse estado tira do usuário justamente a ferramenta de descobrir
    // o estrago.
    const candidateId = await seedCandidate("dono", true);
    await db.run(sql.raw("pragma foreign_keys = off"));
    await db.run(
      sql.raw(`insert into application (candidate_id, job_id, status)
               values (${candidateId}, 999999, 'applied')`),
    );
    await db.run(sql.raw("pragma foreign_keys = on"));

    const r = await funnelAnalysis(candidateId);

    expect(r.applied).toBe(1);
    expect(r.replied).toBe(0);
    // Sem vaga não há fonte: nulo, e não um grupo inventado.
    expect(r.bySource).toEqual([]);
  });

  it("devolve funil vazio, com instrução, para quem nunca se candidatou", async () => {
    const candidateId = await seedCandidate("novo", true);
    const r = await funnelAnalysis(candidateId);

    expect(r.applied).toBe(0);
    expect(r.power).toContain("jho track");
  });
});
