/**
 * Os filtros do quadro rodando de verdade contra o PostgreSQL.
 *
 * `maxFit` e `hideApplied` estavam afirmados apenas como CHAVE do objeto de
 * filtros — `tests/filter-state.test.ts` prova que a URL produz o campo, e
 * nenhum teste fazia o predicado ser executado. Chave presente e SQL certo são
 * coisas diferentes: um `>=` no lugar de um `<=` passaria por toda a suíte.
 *
 * Também aqui a validação de `runDatabaseCleanup`, cujo caminho de recusa nunca
 * era alcançado.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidate, company, job, jobScore, source } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  boardFacets,
  countBoard,
  listBoard,
  setApplicationStatus,
} from "../src/core/db/repo.ts";
import { runDatabaseCleanup, DEFAULT_CLOSED_JOB_DAYS } from "../src/core/db/retention.ts";
import { primaryTrackId } from "./support/tracks.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

async function dono(): Promise<number> {
  const [linha] = await db
    .insert(candidate)
    .values({ slug: "dono", name: "Dono", isDefault: true })
    .returning({ id: candidate.id });
  await db
    .insert(source)
    .values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme Board" })
    .onConflictDoNothing();
  return linha!.id;
}

async function vaga(n: number, fit: number, candidateId: number): Promise<number> {
  const [empresa] = await db
    .insert(company)
    .values({ slug: `e-${n}`, name: `Empresa ${n}` })
    .returning({ id: company.id });
  const [linha] = await db
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
    })
    .returning({ id: job.id });
  await db.insert(jobScore).values({
    candidateId,
    trackId: await primaryTrackId(db, candidateId),
    jobId: linha!.id,
    fit,
    titleScore: fit, keywordScore: 0, seniorityScore: 0, geoScore: 0,
    compScore: 0, freshnessScore: 0, benefitScore: 0, penalty: 0,
    cluster: "architect",
    matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [],
    scorerVersion: "t", profileHash: "t",
  });
  return linha!.id;
}

describe("o teto de nota é um predicado, não só um campo", () => {
  it("UT-130 `maxFit` corta por cima, e lista e contagem concordam", async () => {
    const candidateId = await dono();
    const baixa = await vaga(1, 40, candidateId);
    const media = await vaga(2, 60, candidateId);
    await vaga(3, 90, candidateId);

    // Faixa fechada: 40 a 60 deixa as duas primeiras e tira a de 90.
    const faixa = await listBoard(candidateId, { minFit: 40, maxFit: 60 });
    expect(new Set(faixa.map((r) => r.jobId))).toEqual(new Set([baixa, media]));
    await expect(countBoard(candidateId, { minFit: 40, maxFit: 60 })).resolves.toBe(2);

    // O teto é inclusivo, e é isso que distingue `<=` de `<`.
    await expect(countBoard(candidateId, { minFit: 0, maxFit: 40 })).resolves.toBe(1);
    await expect(countBoard(candidateId, { minFit: 0, maxFit: 39 })).resolves.toBe(0);

    // Sem teto, as três voltam: ausência não é zero.
    await expect(countBoard(candidateId, { minFit: 0 })).resolves.toBe(3);
  });

  it("UT-131 as facetas respeitam o teto junto com a lista", async () => {
    const candidateId = await dono();
    await vaga(1, 40, candidateId);
    await vaga(2, 90, candidateId);

    const facetas = await boardFacets(candidateId, { minFit: 0, maxFit: 50 });

    expect(facetas.total).toBe(1);
  });
});

describe("esconder o que já foi enviado é um predicado, não só um campo", () => {
  it("UT-132 `hideApplied` lê o carimbo, e sobrevive ao estado que vem depois", async () => {
    const candidateId = await dono();
    const enviada = await vaga(1, 70, candidateId);
    const aberta = await vaga(2, 70, candidateId);

    // O carimbo é posto na entrada em `applied`.
    await setApplicationStatus(candidateId, enviada, "applied");

    const escondendo = await listBoard(candidateId, { minFit: 0, hideApplied: true });
    expect(escondendo.map((r) => r.jobId)).toEqual([aberta]);
    await expect(countBoard(candidateId, { minFit: 0, hideApplied: true })).resolves.toBe(1);

    // Recusada DEPOIS de enviada continua escondida: o filtro lê `appliedAt`,
    // que é posto uma vez, e não o nome do status — uma lista de status
    // precisaria ser editada a cada estado novo e esqueceria quem saiu dele.
    await setApplicationStatus(candidateId, enviada, "rejected");
    await expect(countBoard(candidateId, { minFit: 0, hideApplied: true })).resolves.toBe(1);
    // E sem o filtro ela volta a aparecer, porque continua sendo uma vaga.
    await expect(
      countBoard(candidateId, { minFit: 0, status: "any" }),
    ).resolves.toBe(2);
  });

  it("UT-133 sem escopo de candidato o filtro é ignorado, e não esvazia o quadro", async () => {
    // `hideApplied` depende de candidato: o join de candidatura nem casa sem
    // escopo. Aplicar o predicado ali esconderia o acervo global inteiro.
    const candidateId = await dono();
    await vaga(1, 70, candidateId);
    await vaga(2, 70, candidateId);

    await expect(countBoard(null, { minFit: 0, hideApplied: true })).resolves.toBe(2);
  });
});

describe("a política de limpeza recusa número que não é dia", () => {
  it("UT-134 fração e negativo são recusados, nomeando o campo", async () => {
    await expect(runDatabaseCleanup({ closedJobDays: 1.5 })).rejects.toThrow(/closedJobDays/);
    await expect(runDatabaseCleanup({ closedJobDays: -1 })).rejects.toThrow(/closedJobDays/);
    await expect(runDatabaseCleanup({ pageHtmlDays: -7 })).rejects.toThrow(/pageHtmlDays/);
    // Zero é válido: "não guarde HTML nenhum" é uma política, não um erro.
    await expect(runDatabaseCleanup({ pageHtmlDays: 0 })).resolves.toBeTruthy();
  });

  it("UT-135 sem opção, a política é a padrão", async () => {
    const resultado = await runDatabaseCleanup();

    expect(resultado.policy.closedJobDays).toBe(DEFAULT_CLOSED_JOB_DAYS);
    // Inventário de banco vazio é zero em toda linha, nunca `NaN`.
    expect(resultado.candidates.onlineJobs).toBe(0);
    expect(resultado.candidates.reclaimableBytes).toBe(0);
    // Sem `apply`, nada foi removido.
    expect(resultado.applied).toBeNull();
  });
});
