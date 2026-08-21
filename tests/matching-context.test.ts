import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchingProfile, setMatchingProfile } from "../src/contexts/matching/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidate, company, job, jobScore, source } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { scoreAll, scoreOne } from "../src/core/scoring/apply.ts";
import { SCORER_VERSION, scoreJob } from "../src/core/scoring/score.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

async function seedCandidatesAndJob() {
  const [first, second] = await db
    .insert(candidate)
    .values([
      { slug: "first", name: "First", isDefault: true },
      { slug: "second", name: "Second" },
    ])
    .returning({ id: candidate.id });
  await db.insert(source).values({
    id: "manual:matching",
    kind: "manual",
    handle: "matching",
    label: "Matching",
  });
  const [employer] = await db
    .insert(company)
    .values({ slug: "matching", name: "Matching" })
    .returning({ id: company.id });
  const [posting] = await db
    .insert(job)
    .values({
      sourceId: "manual:matching",
      companyId: employer!.id,
      companyName: "Matching",
      externalId: "same-job",
      title: "AI Solutions Architect",
      descriptionText: "Remote LATAM role designing distributed systems and RAG platforms.",
      locationRaw: "Remote LATAM",
      url: "manual://matching",
      fingerprint: "matching",
      contentHash: "matching",
      raw: "{}",
    })
    .returning({ id: job.id });
  return { first: first!.id, second: second!.id, jobId: posting!.id };
}

describe("candidate-owned matching context", () => {
  it("persists independent profiles and scores for the same job", async () => {
    const seeded = await seedCandidatesAndJob();
    const base = await loadProfile(true);
    const firstProfile = structuredClone(base);
    const secondProfile = structuredClone(base);
    secondProfile.targets.clusters.architect!.weight = 0;

    await setMatchingProfile(seeded.first, firstProfile);
    await setMatchingProfile(seeded.second, secondProfile);
    const [firstResult, secondResult] = await Promise.all([
      scoreOne(seeded.first, seeded.jobId),
      scoreOne(seeded.second, seeded.jobId),
    ]);

    expect(firstResult!.fit).toBeGreaterThan(secondResult!.fit);
    const rows = await db.select().from(jobScore).where(eq(jobScore.jobId, seeded.jobId));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.profileHash)).size).toBe(2);
  });

  it("is reproducible for a fixed asOf and changes only when time input changes", async () => {
    const profile = await loadProfile(true);
    const input = {
      title: "AI Solutions Architect",
      companyName: "Acme",
      locationRaw: "Remote LATAM",
      postedAt: "2026-08-01T00:00:00.000Z",
    };
    const context = { profile, fx: null, asOf: Date.parse("2026-08-20T00:00:00.000Z") };
    expect(scoreJob(input, context)).toEqual(scoreJob(input, context));
    expect(scoreJob(input, { ...context, asOf: context.asOf + 30 * 86_400_000 }).freshnessScore)
      .toBeLessThan(scoreJob(input, context).freshnessScore);
  });

  it("reprocesses current-version scores after the freshness window", async () => {
    const seeded = await seedCandidatesAndJob();
    const selected = await matchingProfile(seeded.first);
    await db.insert(jobScore).values({
      candidateId: seeded.first,
      jobId: seeded.jobId,
      fit: 1,
      titleScore: 0,
      keywordScore: 0,
      seniorityScore: 0,
      geoScore: 0,
      compScore: 0,
      freshnessScore: 0,
      benefitScore: 0,
      penalty: 0,
      cluster: "other",
      matchedKeywords: [],
      missingKeywords: [],
      detectedBenefits: [],
      ageDays: null,
      reasons: [],
      blockers: [],
      scorerVersion: SCORER_VERSION,
      profileHash: selected.hash,
      scoredAt: "2020-01-01T00:00:00.000Z",
    });

    await expect(scoreAll(seeded.first)).resolves.toMatchObject({ scored: 1 });
    const [updated] = await db.select().from(jobScore);
    expect(updated!.fit).not.toBe(1);
  });
});

/**
 * A gravação em lote.
 *
 * `scoreAll` gravava uma vaga por vez, com um `await` por linha. Contra o SQLite
 * local isso é imperceptível; contra a Turso são milhares de idas e voltas HTTP
 * em série, e a varredura diária pagava minutos por isso todo dia.
 *
 * O risco que o lote introduz não é de lentidão, é de **aritmética**: perder o
 * resto da divisão, ou gravar duas vezes a fronteira. Os casos abaixo cercam
 * exatamente isso, com quantidades escolhidas em volta do tamanho do lote.
 */
describe("scoreAll grava em lote", () => {
  async function semearVagas(quantas: number): Promise<number> {
    const [dono] = await db
      .insert(candidate)
      .values({ slug: "lote", name: "Lote", isDefault: true })
      .returning({ id: candidate.id });
    await db.insert(source).values({
      id: "manual:lote",
      kind: "manual",
      handle: "lote",
      label: "Lote",
    });
    await db.insert(job).values(
      Array.from({ length: quantas }, (_, i) => ({
        sourceId: "manual:lote",
        companyName: "Lote",
        externalId: `lote-${i}`,
        title: "AI Solutions Architect",
        descriptionText: "Remote LATAM role designing distributed systems and RAG platforms.",
        locationRaw: "Remote LATAM",
        url: `manual://lote/${i}`,
        fingerprint: `lote-${i}`,
        contentHash: `lote-${i}`,
        raw: "{}",
      })),
    );
    return dono!.id;
  }

  // 250 atravessa duas fronteiras de lote (100 e 200) e deixa resto — as três
  // situações que a divisão pode errar, num caso só.
  it("pontua todas as vagas quando há mais de um lote, com resto", async () => {
    const dono = await semearVagas(250);

    const resultado = await scoreAll(dono);

    expect(resultado.scored).toBe(250);
    // O que o contador diz e o que o banco tem são coisas diferentes: um lote
    // descartado sem `await` incrementaria o contador e não gravaria nada.
    const gravadas = await db.select().from(jobScore).where(eq(jobScore.candidateId, dono));
    expect(gravadas).toHaveLength(250);
  });

  it("o último lote parcial não fica para trás", async () => {
    // 101: cem descarregadas dentro do laço e UMA que só sai no descarregamento
    // final. Sem ele, essa vaga sumiria — e o contador seguiria dizendo 101.
    const dono = await semearVagas(101);

    await scoreAll(dono);

    const gravadas = await db.select().from(jobScore).where(eq(jobScore.candidateId, dono));
    expect(gravadas).toHaveLength(101);
  });

  it("exatamente um lote cheio não grava duas vezes nem estoura", async () => {
    // 100: o laço descarrega ao chegar no teto e o descarregamento final
    // encontra a fila vazia. Um `batch` com lista vazia é erro no driver.
    const dono = await semearVagas(100);

    await expect(scoreAll(dono)).resolves.toMatchObject({ scored: 100 });
    const gravadas = await db.select().from(jobScore).where(eq(jobScore.candidateId, dono));
    expect(gravadas).toHaveLength(100);
  });

  it("nenhuma vaga não chama o driver com lista vazia", async () => {
    const [dono] = await db
      .insert(candidate)
      .values({ slug: "vazio", name: "Vazio", isDefault: true })
      .returning({ id: candidate.id });

    await expect(scoreAll(dono!.id)).resolves.toMatchObject({ scored: 0 });
  });
});
