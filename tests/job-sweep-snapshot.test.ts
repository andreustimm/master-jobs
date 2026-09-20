/**
 * O snapshot da varredura é uma fronteira de segurança, não um DTO.
 *
 * O cabeçalho de `src/core/triage/job-sweep.ts` diz o porquê: a descrição de uma
 * vaga é texto de terceiro, e o agente revisor recebe esse texto como **dado
 * importado de arquivo**, nunca por stdout de comando. Se este módulo vazar o
 * que não devia — a candidatura de outra pessoa, por exemplo — o vazamento
 * chega ao revisor como conteúdo legítimo.
 *
 * O arquivo estava em **0% de cobertura** quando a tarefa de qualidade o
 * encontrou. Estes casos existem pelo contrato, não pelo número.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { application, candidate, company, job, jobScore, source } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import { ensurePrimaryTrack } from "../src/contexts/matching/index.ts";
import { primaryTrackId } from "./support/tracks.ts";
import { buildJobSweepSnapshot } from "../src/core/triage/job-sweep.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

async function seedDono(nome: string): Promise<number> {
  const [dono] = await db
    .insert(candidate)
    .values({ slug: nome, name: `Candidato ${nome}`, isDefault: nome === "dono" })
    .returning({ id: candidate.id });
  await ensurePrimaryTrack(dono!.id);
  return dono!.id;
}

async function seedVaga(n: number, extra: Partial<typeof job.$inferInsert> = {}): Promise<number> {
  await db
    .insert(source)
    .values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" })
    .onConflictDoNothing();
  const [empresa] = await db
    .insert(company)
    .values({ slug: `empresa-${n}`, name: `Empresa ${n}` })
    .returning({ id: company.id });
  const [vaga] = await db
    .insert(job)
    .values({
      sourceId: "lever:acme",
      companyId: empresa!.id,
      companyName: `Empresa ${n}`,
      externalId: `ext-${n}`,
      title: `Arquiteto ${n}`,
      url: `https://exemplo.test/${n}`,
      fingerprint: `fp-${n}`,
      contentHash: `ch-${n}`,
      raw: "{}",
      ...extra,
    })
    .returning({ id: job.id });
  return vaga!.id;
}

async function seedNota(candidateId: number, jobId: number, fit: number): Promise<void> {
  await db.insert(jobScore).values({
    candidateId,
    trackId: await primaryTrackId(db, candidateId),
    jobId,
    fit,
    titleScore: 10,
    keywordScore: 9,
    seniorityScore: 8,
    geoScore: 7,
    compScore: 6,
    freshnessScore: 5,
    benefitScore: 4,
    penalty: 0,
    cluster: "architect",
    matchedKeywords: ["typescript"],
    missingKeywords: ["kubernetes"],
    reasons: [],
    blockers: [],
    scorerVersion: "teste",
  });
}

describe("snapshot da varredura", () => {
  it("UT-092 sem vaga acima do corte, entrega o perfil e nenhum candidato", async () => {
    const dono = await seedDono("dono");

    const snapshot = await buildJobSweepSnapshot(dono, 60, 10);

    expect(snapshot.candidates).toEqual([]);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.minFit).toBe(60);
    // O perfil vai mesmo sem candidato: é ele que diz ao revisor o que procurar.
    expect(Object.keys(snapshot.profile.targets).length).toBeGreaterThan(0);
    expect(snapshot.profile.constraints.workAuthorization).toBeDefined();
  });

  it("UT-093 leva a descrição, o detalhamento da nota e as palavras casadas", async () => {
    const dono = await seedDono("dono");
    const vaga = await seedVaga(1, {
      descriptionText: "Texto da vaga, que vem de terceiro.",
      locationRaw: "Remote · Brazil",
      applyUrl: "https://exemplo.test/1/apply",
    });
    await seedNota(dono, vaga, 80);

    const [candidato] = (await buildJobSweepSnapshot(dono, 60, 10)).candidates;

    expect(candidato).toMatchObject({
      id: vaga,
      title: "Arquiteto 1",
      company: "Empresa 1",
      location: "Remote · Brazil",
      fit: 80,
      cluster: "architect",
      description: "Texto da vaga, que vem de terceiro.",
      matchedKeywords: ["typescript"],
      missingKeywords: ["kubernetes"],
      pipelineStatus: null,
    });
    // O endereço é o do formulário quando existe: mandar o revisor para a
    // descrição de uma vaga que ele vai recomendar é meio caminho.
    expect(candidato!.url).toBe("https://exemplo.test/1/apply");
    expect(candidato!.breakdown).toMatchObject({ title: 10, keywords: 9, benefits: 4 });
  });

  it("UT-094 o estado do funil é o do candidato pedido, nunca o de outro", async () => {
    const dono = await seedDono("dono");
    const outro = await seedDono("outro");
    const vaga = await seedVaga(2);
    await seedNota(dono, vaga, 90);
    await seedNota(outro, vaga, 90);
    // A candidatura é do outro. O snapshot do dono não pode enxergá-la: é
    // leitura de funil alheio, e chega ao revisor como conteúdo legítimo.
    await db.insert(application).values({ candidateId: outro, jobId: vaga, status: "applied" });

    const doDono = await buildJobSweepSnapshot(dono, 60, 10);
    const doOutro = await buildJobSweepSnapshot(outro, 60, 10);

    expect(doDono.candidates[0]!.pipelineStatus).toBeNull();
    expect(doOutro.candidates[0]!.pipelineStatus).toBe("applied");
  });

  it("UT-095 repassa as fontes que falharam, para o revisor saber o que não viu", async () => {
    const dono = await seedDono("dono");

    const snapshot = await buildJobSweepSnapshot(dono, 45, 5, ["himalayas", "remoteok"]);

    // Sem isso o revisor leria um acervo incompleto como se fosse completo.
    expect(snapshot.sourcesFailed).toEqual(["himalayas", "remoteok"]);
  });

  it("UT-096 respeita o corte e o limite que recebeu", async () => {
    const dono = await seedDono("dono");
    const alta = await seedVaga(3);
    const baixa = await seedVaga(4);
    await seedNota(dono, alta, 85);
    await seedNota(dono, baixa, 50);

    const comCorte = await buildJobSweepSnapshot(dono, 60, 10);
    expect(comCorte.candidates.map((c) => c.id)).toEqual([alta]);

    const semCorte = await buildJobSweepSnapshot(dono, 0, 10);
    expect(semCorte.candidates).toHaveLength(2);

    const limitado = await buildJobSweepSnapshot(dono, 0, 1);
    expect(limitado.candidates).toHaveLength(1);
  });
});
