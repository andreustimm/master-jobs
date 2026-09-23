/**
 * Vaga sem nota não é vaga reprovada (#279, regra 8).
 *
 * O quadro corta por `fit >= 45` por omissão. A nota é do candidato da sessão e
 * só nasce quando a fila de repontuação roda; até lá, o left join devolve nulo.
 * `coalesce(fit, 0)` lia essa espera como nota zero, e o candidato recém-criado
 * abria `/jobs` e o cockpit sem nenhuma vaga — as mesmas vagas que o dono via.
 *
 * O predicado é um só (`boardConditions`), mas quatro leitores o consomem:
 * lista, total, facetas e cockpit. Cada um é conferido aqui, porque um deles
 * divergir é exatamente o defeito que o predicado compartilhado evita.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCockpit } from "../app/cockpit-data.ts";
import { readFilters, toBoardFilters } from "../app/filter-state.ts";
import { loadJobsView } from "../app/jobs/jobs-data.ts";
import {
  boardFacets,
  countBoard,
  hasTrackScores,
  invalidateBoardFacets,
  listBoard,
  setMatchingProfile,
} from "../src/contexts/matching/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidate, job, jobScore, source } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

let db: DB;
let owner: number;
let novo: number;
let alta: number;
let baixa: number;
let semNota: number;

async function addJob(n: number): Promise<number> {
  const [row] = await db.insert(job).values({
    sourceId: "lever:one", externalId: `u${n}`, companyName: `Acme ${n}`,
    title: `Architect ${n}`, url: `https://example.test/u${n}`, raw: {},
    fingerprint: `unscored-${n}`, contentHash: `unscored-${n}`,
  }).returning({ id: job.id });
  return row!.id;
}

async function score(candidateId: number, jobId: number, fit: number) {
  await db.insert(jobScore).values({
    candidateId, trackId: await primaryTrackId(db, candidateId), jobId, fit, cluster: "architect",
    titleScore: 1, keywordScore: 1, seniorityScore: 1, geoScore: 1, compScore: 1,
    matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [], scorerVersion: "fixture",
  });
}

beforeEach(async () => {
  db = await useTestDb();
  invalidateBoardFacets();
  const rows = await db.insert(candidate).values([
    { slug: "dono", name: "Dono", isDefault: true },
    { slug: "novo", name: "Novo" },
  ]).returning({ id: candidate.id });
  owner = rows[0]!.id;
  novo = rows[1]!.id;
  // Os dois têm trilha principal com alvo: o candidato novo passou pelo
  // onboarding e só espera a fila. É o caso de produção do relato.
  const profile = await loadProfile(true);
  await setMatchingProfile(owner, profile);
  await setMatchingProfile(novo, profile);
  await db.insert(source).values({ id: "lever:one", kind: "lever", handle: "one", label: "Lever" });
  alta = await addJob(1);
  baixa = await addJob(2);
  semNota = await addJob(3);
  await score(owner, alta, 80);
  await score(owner, baixa, 30);
});

afterEach(async () => {
  invalidateBoardFacets();
  await releaseTestDb();
});

const ids = (rows: Array<{ jobId: number }>) => rows.map((row) => row.jobId);
const DEFAULT = readFilters({});

describe("vaga sem nota do candidato da sessão (#279)", () => {
  it("o corte padrão de 45 não esconde vagas de quem ainda não tem nota", async () => {
    expect(DEFAULT.fit).toBe(45);
    const filters = toBoardFilters(DEFAULT);

    expect(ids(await listBoard(novo, filters)).sort()).toEqual([alta, baixa, semNota].sort());
    expect(await countBoard(novo, filters)).toBe(3);
    expect((await boardFacets(novo, filters)).total).toBe(3);
  });

  it("o teto de Score também não esconde a vaga sem nota", async () => {
    const filters = { ...toBoardFilters(DEFAULT), minFit: 0, maxFit: 50 };

    expect(ids(await listBoard(novo, filters)).sort()).toEqual([alta, baixa, semNota].sort());
    // Com nota, o teto continua valendo: a de 80 sai, a sem nota fica.
    expect(ids(await listBoard(owner, filters))).toEqual([baixa, semNota]);
  });

  it("quem tem nota continua filtrado por ela, e a sem nota vai para o fim", async () => {
    const filters = toBoardFilters(DEFAULT);

    expect(ids(await listBoard(owner, filters))).toEqual([alta, semNota]);
    expect(await countBoard(owner, filters)).toBe(2);
    expect((await boardFacets(owner, filters)).total).toBe(2);
  });

  it("sem o pedido da tela, o corte continua estrito (relatório, jobs list, varredura)", async () => {
    // "Vagas com nota acima de 45" não inclui vaga sem nota: é a pergunta do
    // relatório e da CLI, não a da tela.
    expect(await listBoard(novo, { minFit: 45 })).toEqual([]);
    expect(await countBoard(novo, { minFit: 45 })).toBe(0);
    expect(ids(await listBoard(owner, { minFit: 45 }))).toEqual([alta]);
  });

  it("o acervo sem escopo de candidato (recrutador) não muda", async () => {
    const filters = toBoardFilters(DEFAULT);

    expect(ids(await listBoard(null, filters)).sort()).toEqual([alta, baixa, semNota].sort());
    expect(await countBoard(null, filters)).toBe(3);
    expect((await boardFacets(null, filters)).total).toBe(3);
  });

  it("o cockpit do candidato novo lista as vagas e avisa que a nota está pendente", async () => {
    const novoCockpit = await loadCockpit(novo, DEFAULT, toBoardFilters(DEFAULT));

    expect(novoCockpit.total).toBe(3);
    expect(ids(novoCockpit.top).sort()).toEqual([alta, baixa, semNota].sort());
    expect(novoCockpit.facets.total).toBe(3);
    expect(novoCockpit.stats?.scored).toBe(false);

    const ownerCockpit = await loadCockpit(owner, DEFAULT, toBoardFilters(DEFAULT));
    expect(ownerCockpit.total).toBe(2);
    expect(ownerCockpit.stats?.scored).toBe(true);
  });

  it("a tela Vagas do candidato novo mostra as vagas com o aviso de nota pendente", async () => {
    const view = (candidateId: number | null) => loadJobsView({
      candidateId, params: {}, page: 1, pageSize: 50, prefetch: false,
      schedule: () => undefined, now: new Date(),
    });

    const novoView = await view(novo);
    expect(novoView.total).toBe(3);
    expect(novoView.facets.total).toBe(3);
    expect(novoView.notices).toContain("scores_pending");

    const ownerView = await view(owner);
    expect(ownerView.total).toBe(2);
    expect(ownerView.notices).not.toContain("scores_pending");

    // Sem candidato não há nota a esperar: o aviso seria sobre ninguém.
    const recruiterView = await view(null);
    expect(recruiterView.total).toBe(3);
    expect(recruiterView.notices).not.toContain("scores_pending");
  });

  it("a nota de outro candidato não conta como nota do candidato da sessão", async () => {
    expect(await hasTrackScores(owner, await primaryTrackId(db, owner))).toBe(true);
    expect(await hasTrackScores(novo, await primaryTrackId(db, novo))).toBe(false);
    // A trilha do dono, pedida em nome do novo, não empresta a nota.
    expect(await hasTrackScores(novo, await primaryTrackId(db, owner))).toBe(false);
  });
});
