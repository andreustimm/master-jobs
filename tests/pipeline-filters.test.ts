/**
 * Filtros do Funil no PostgreSQL (#478).
 *
 * Suite: `pipelineRows`, `pipelineCounts` e `pipelineFacets` sob os filtros.
 * Invariant: lista, total e contador por estágio respondem ao mesmo conjunto;
 *   a busca é a de Vagas (palavra inteira, frase, sinônimo) mais grafia
 *   parecida no título; nada de outro candidato nem de fora do funil aparece.
 * Boundary IN: o repositório real, com a URL lida por `readPipelineFilters`.
 * Boundary OUT: a tela (E2E `pipeline-filters`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPipelineFilters, toPipelineFilters } from "../app/pipeline/filter-state.ts";
import { setMatchingProfile, trackScope } from "../src/contexts/matching/index.ts";
import { OUT_OF_FUNNEL, type ApplicationStatus } from "../src/contexts/pursuit/domain/application.ts";
import { pipelineCounts, pipelineFacets, pipelineRows, type PipelineFilters } from "../src/contexts/pursuit/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { application, candidate, job, jobPage, jobScore, source } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { buildSynonymDictionary } from "../src/core/synonyms.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let owner: number;
let other: number;
let seq = 0;

const dictionary = buildSynonymDictionary({ groups: [["engenheiro", "engineer"]] });

type Seed = {
  title: string;
  company: string;
  description?: string;
  page?: string;
  closed?: boolean;
  fit?: number;
  status: ApplicationStatus;
  channel?: string;
  candidateId?: number;
};

async function seed(entry: Seed): Promise<number> {
  const n = ++seq;
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "manual:board",
      companyName: entry.company,
      externalId: `p${n}`,
      title: entry.title,
      descriptionText: entry.description ?? null,
      closedAt: entry.closed ? "2026-09-01T00:00:00.000Z" : null,
      url: `https://board.test/${n}`,
      fingerprint: `fp${n}`,
      contentHash: `h${n}`,
      raw: {},
    })
    .returning({ id: job.id });
  const jobId = row!.id;
  const candidateId = entry.candidateId ?? owner;
  if (entry.page) {
    await db.insert(jobPage).values({ jobId, finalUrl: `https://board.test/${n}`, httpStatus: 200, text: entry.page, contentHash: `p${n}` });
  }
  if (entry.fit !== undefined) {
    const trackId = (await trackScope(candidateId, { kind: "primary" }))!.primaryTrackId;
    await db.insert(jobScore).values({
      candidateId, trackId, jobId, fit: entry.fit,
      titleScore: entry.fit, keywordScore: 0, seniorityScore: 0, geoScore: 0, compScore: 0,
      freshnessScore: 0, benefitScore: 0, penalty: 0, cluster: "architect",
      matchedKeywords: [], missingKeywords: [], detectedBenefits: [], ageDays: null,
      reasons: [], blockers: [], scorerVersion: "test",
    });
  }
  await db.insert(application).values({ candidateId, jobId, status: entry.status, channel: entry.channel ?? null });
  return jobId;
}

async function fixture() {
  return {
    backend: await seed({
      title: "Backend Engineer", company: "Acme", description: "Kubernetes clusters at scale.",
      fit: 80, status: "applied", channel: "referral",
    }),
    dados: await seed({ title: "Engenheiro de Dados", company: "Globex", fit: 40, status: "shortlisted", channel: "direct" }),
    closed: await seed({
      title: "Platform Lead", company: "Initech", description: "Ownership of the observability stack.",
      closed: true, status: "interviewing",
    }),
    designer: await seed({
      title: "Product Designer", company: "Acme", page: "Design systems in Figma.", fit: 95, status: "applied", channel: "direct",
    }),
    untracked: await seed({ title: "Backend Engineer II", company: "Hooli", fit: 90, status: OUT_OF_FUNNEL, channel: "linkedin" }),
    foreign: await seed({ title: "Backend Engineer III", company: "Umbrella", fit: 90, status: "applied", channel: "recruiter", candidateId: other }),
  };
}

function filtersOf(params: Record<string, string | string[]>): PipelineFilters {
  return toPipelineFilters(readPipelineFilters(params, dictionary));
}

async function ids(filters: PipelineFilters, status: ApplicationStatus | null = null): Promise<number[]> {
  const rows = await pipelineRows(owner, { ...filters, status });
  return rows.map((row) => row.jobId).sort((a, b) => a - b);
}

const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

beforeEach(async () => {
  db = await useTestDb();
  const [first] = await db.insert(candidate).values({ slug: "owner", name: "Owner", isDefault: true }).returning();
  const [second] = await db.insert(candidate).values({ slug: "other", name: "Other" }).returning();
  owner = first!.id;
  other = second!.id;
  const profile = await loadProfile(true);
  await setMatchingProfile(owner, profile);
  await setMatchingProfile(other, profile);
  await db.insert(source).values({ id: "manual:board", kind: "manual", handle: "board", label: "Board" });
});

afterEach(async () => {
  await releaseTestDb();
});

describe("IT-478-01 texto", () => {
  it("casa título, descrição da fonte e descrição capturada, inclusive de vaga fechada", async () => {
    const f = await fixture();
    expect(await ids(filtersOf({ q: "engineer" }))).toEqual([f.backend]);
    expect(await ids(filtersOf({ q: "kubernetes" }))).toEqual([f.backend]);
    expect(await ids(filtersOf({ q: "figma" }))).toEqual([f.designer]);
    expect(await ids(filtersOf({ q: "observability" }))).toEqual([f.closed]);
  });

  it("palavra inteira e frase entre aspas, como em Vagas", async () => {
    const f = await fixture();
    expect(await ids(filtersOf({ q: "engine" }))).toEqual([]);
    expect(await ids(filtersOf({ q: '"design systems"' }))).toEqual([f.designer]);
    expect(await ids(filtersOf({ q: '"systems design"' }))).toEqual([]);
  });
});

describe("IT-478-02 busca ampliada", () => {
  it("sinônimo só com semantic: 'engenheiro' acha 'Engineer'", async () => {
    const f = await fixture();
    expect(await ids(filtersOf({ q: "engenheiro" }))).toEqual([f.dados]);
    expect(await ids(filtersOf({ q: "engenheiro", semantic: "1" }))).toEqual(sorted([f.backend, f.dados]));
  });

  it("grafia parecida no título só com semantic", async () => {
    const f = await fixture();
    expect(await ids(filtersOf({ q: "designr" }))).toEqual([]);
    expect(await ids(filtersOf({ q: "designr", semantic: "1" }))).toEqual([f.designer]);
  });
});

describe("IT-478-03 empresa, canal e score", () => {
  it("empresas e canais repetidos são alternativas; entre filtros, todos valem", async () => {
    const f = await fixture();
    expect(await ids(filtersOf({ company: ["Acme", "Initech"] }))).toEqual(sorted([f.backend, f.closed, f.designer]));
    expect(await ids(filtersOf({ channel: ["direct", "referral"] }))).toEqual(sorted([f.backend, f.dados, f.designer]));
    expect(await ids(filtersOf({ company: "Acme", channel: "direct" }))).toEqual([f.designer]);
    expect(await ids(filtersOf({ company: "Acme", channel: "direct" }), "shortlisted")).toEqual([]);
  });

  it("a faixa de score corta quem tem nota e mantém a candidatura sem nota", async () => {
    const f = await fixture();
    expect(await ids(filtersOf({ fit: "70", fitMax: "90" }))).toEqual(sorted([f.backend, f.closed]));
    expect(await ids(filtersOf({ fitMax: "50" }))).toEqual(sorted([f.dados, f.closed]));
  });
});

describe("IT-478-04 contadores", () => {
  it("cada estágio conta o que a lista daquele estágio mostra, com e sem filtro", async () => {
    await fixture();
    const cases: Array<Record<string, string>> = [{}, { company: "Acme" }, { q: "engenheiro", semantic: "1" }, { fit: "50", channel: "direct" }];
    for (const params of cases) {
      const filters = filtersOf(params);
      const counts = await pipelineCounts(owner, filters);
      for (const status of ["applied", "shortlisted", "interviewing"] as const) {
        expect(counts[status] ?? 0, `${JSON.stringify(params)} ${status}`).toBe((await ids(filters, status)).length);
      }
      expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe((await ids(filters)).length);
    }
  });

  it("sem filtro, o contador é o de antes: só o funil do próprio candidato", async () => {
    await fixture();
    expect(await pipelineCounts(owner)).toEqual({ applied: 2, shortlisted: 1, interviewing: 1 });
  });
});

describe("IT-478-05 opções dos filtros", () => {
  it("empresas e canais do próprio funil, em ordem, sem quem saiu dele nem outro candidato", async () => {
    await fixture();
    expect(await pipelineFacets(owner)).toEqual({
      companies: ["Acme", "Globex", "Initech"],
      channels: ["direct", "referral"],
    });
  });
});
