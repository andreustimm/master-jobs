/**
 * Cache das facetas contra o banco de verdade (#216).
 *
 * O que ele NÃO pode fazer é o que estes testes cobram: servir as contagens de
 * um candidato a outro, sobreviver à validade, ou guardar uma falha. E o que ele
 * existe para fazer: paginar e reordenar sem refazer a consulta.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadJobsView } from "../app/jobs/jobs-data.ts";
import {
  FACET_CACHE_TTL_MS,
  cachedBoardFacets,
  invalidateBoardFacets,
} from "../src/contexts/matching/index.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidate, job, jobScore, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

let db: DB;
let now: ReturnType<typeof fixedClock>;

beforeEach(async () => {
  db = await useTestDb();
  now = fixedClock("2026-09-22T12:00:00.000Z");
  setClock(now);
  await db.insert(candidate).values([
    { id: 1, slug: "um", name: "Um", isDefault: true },
    { id: 2, slug: "dois", name: "Dois" },
  ]);
  await db.insert(source).values({ id: "lever:one", kind: "lever", handle: "one", label: "Lever" });
});

afterEach(async () => {
  resetClock();
  await releaseTestDb();
});

async function scored(id: number, candidateId: number, cluster: string, fit = 80) {
  await db.insert(job).values({
    id, sourceId: "lever:one", externalId: String(id), companyName: `Acme ${id}`,
    title: `Architect ${id}`, url: `https://example.test/${id}`, raw: {},
    fingerprint: `cache-${id}`, contentHash: `cache-${id}`, firstSeenAt: "2026-09-20T00:00:00Z",
  }).onConflictDoNothing();
  await db.insert(jobScore).values({
    candidateId, trackId: await primaryTrackId(db, candidateId), jobId: id, fit, cluster,
    titleScore: 1, keywordScore: 1, seniorityScore: 1, geoScore: 1, compScore: 1,
    matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [], scorerVersion: "fixture",
  });
}

/** Quantas vezes a consulta das facetas foi ao banco enquanto `run` rodava. */
async function facetReads(run: () => Promise<unknown>): Promise<number> {
  const client = db.$client as unknown as { unsafe: (...args: unknown[]) => Promise<unknown> };
  const original = client.unsafe.bind(client);
  let reads = 0;
  client.unsafe = (...args: unknown[]) => {
    if (String(args[0]).includes("facet_candidates")) reads += 1;
    return original(...args);
  };
  try {
    await run();
  } finally {
    client.unsafe = original;
  }
  return reads;
}

const query = { minFit: 45, groupRepeats: true };

describe("cache das facetas", () => {
  it("nunca serve as facetas de um candidato a outro", async () => {
    await scored(1, 1, "architect");
    await scored(2, 2, "backend");
    await scored(3, 2, "backend");

    const reads = await facetReads(async () => {
      const first = await cachedBoardFacets(1, query);
      const second = await cachedBoardFacets(2, query);
      expect(first).toMatchObject({ total: 1, clusters: ["architect"] });
      expect(second).toMatchObject({ total: 2, clusters: ["backend"] });
      // De novo, já guardadas: cada um continua com o seu.
      expect(await cachedBoardFacets(1, query)).toMatchObject({ total: 1, clusters: ["architect"] });
      expect(await cachedBoardFacets(2, query)).toMatchObject({ total: 2, clusters: ["backend"] });
    });
    expect(reads).toBe(2);
  });

  it("paginar, ordenar, a faixa salarial, a empresa e os chips de recorte não refazem as facetas", async () => {
    await scored(1, 1, "architect");
    const view = (params: Record<string, string>, page = 1) =>
      loadJobsView({
        candidateId: 1, params, page, pageSize: 25, prefetch: false,
        schedule: () => {}, now: new Date("2026-09-22T12:00:00Z"),
      });

    const reads = await facetReads(async () => {
      const first = await view({});
      await view({}, 2);
      await view({ sort: "comp", cur: "USD", per: "month" });
      await view({ pay: "6000", payMax: "30000", cur: "USD", per: "month" });
      await view({ fresh: "1", unblocked: "1", notApplied: "1" });
      await view({ company: "Acme" });
      const last = await view({}, 3);
      expect(last.facets).toEqual(first.facets);
    });
    expect(reads).toBe(1);

    // Um filtro que muda as facetas é outra entrada.
    expect(await facetReads(() => view({ cluster: "architect" }))).toBe(1);
  });

  it("vence na validade e lê o acervo de novo", async () => {
    await scored(1, 1, "architect");
    expect((await cachedBoardFacets(1, query)).total).toBe(1);
    await scored(2, 1, "architect");

    now.advance(FACET_CACHE_TTL_MS - 1);
    expect((await cachedBoardFacets(1, query)).total).toBe(1);
    now.advance(1);
    expect((await cachedBoardFacets(1, query)).total).toBe(2);
  });

  it("a invalidação por candidato não toca a dos outros; a geral limpa tudo", async () => {
    await scored(1, 1, "architect");
    await scored(2, 2, "backend");
    await cachedBoardFacets(1, query);
    await cachedBoardFacets(2, query);
    await scored(3, 1, "architect");
    await scored(4, 2, "backend");

    invalidateBoardFacets(1);
    expect((await cachedBoardFacets(1, query)).total).toBe(2);
    expect((await cachedBoardFacets(2, query)).total).toBe(1);

    invalidateBoardFacets();
    expect((await cachedBoardFacets(2, query)).total).toBe(2);
  });

  it("requisições iguais ao mesmo tempo esperam a mesma consulta", async () => {
    await scored(1, 1, "architect");
    const reads = await facetReads(async () => {
      const [a, b] = await Promise.all([cachedBoardFacets(1, query), cachedBoardFacets(1, query)]);
      expect(a).toEqual(b);
    });
    expect(reads).toBe(1);
  });

  it("devolve uma cópia: alterar a lista não altera a entrada guardada", async () => {
    await scored(1, 1, "architect");
    const first = await cachedBoardFacets(1, query);
    first.clusters.push("intruso");
    first.sources.length = 0;
    expect(await cachedBoardFacets(1, query)).toMatchObject({ clusters: ["architect"], sources: ["lever"] });
  });

  it("uma falha não fica guardada", async () => {
    await scored(1, 1, "architect");
    const client = db.$client as unknown as { unsafe: (...args: unknown[]) => Promise<unknown> };
    const original = client.unsafe.bind(client);
    // Um erro de verdade do PostgreSQL, com o mesmo objeto de consulta que o
    // Drizzle espera — uma promessa rejeitada à mão não tem `.values()`.
    client.unsafe = () => original("select 1/0");
    try {
      await expect(cachedBoardFacets(1, query)).rejects.toThrow();
    } finally {
      client.unsafe = original;
    }
    expect((await cachedBoardFacets(1, query)).total).toBe(1);
  });
});
