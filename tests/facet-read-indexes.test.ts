/**
 * Os dois índices de leitura das facetas e do quadro (#222, migrações `0025` e `0026`).
 *
 * Nenhum dos dois muda resultado — a prova de equivalência é
 * `tests/board-facets.test.ts` e o `pnpm perf:facetas`, que compara os
 * resultados antes e depois. O que se trava aqui é o que falharia EM SILÊNCIO:
 * um predicado que deixa de casar com o índice parcial (a consulta continua
 * certa, só volta a abrir o TOAST de cada vaga), e o `INCLUDE` da migração
 * custom, que o Drizzle não declara e um `generate` futuro não recriaria.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boardFacets, countBoard } from "../src/core/db/repo.ts";
import { candidate, job, jobScore, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

let db: Awaited<ReturnType<typeof useTestDb>>;
let track: number;

beforeEach(async () => {
  db = await useTestDb();
  await db.insert(candidate).values({ id: 1, slug: "owner", name: "Owner" });
  await db.insert(source).values({ id: "lever:one", kind: "lever", handle: "one", label: "Lever" });
  track = await primaryTrackId(db, 1);
});

afterEach(async () => {
  await releaseTestDb();
});

async function posting(id: number, descriptionText: string | null) {
  await db.insert(job).values({
    id, sourceId: "lever:one", externalId: String(id), companyName: `Acme ${id}`,
    title: `Architect ${id}`, url: `https://example.test/${id}`, raw: {}, descriptionText,
    fingerprint: `index-${id}`, contentHash: `index-${id}`, firstSeenAt: "2026-01-01T00:00:00Z",
  });
  await db.insert(jobScore).values({
    candidateId: 1, trackId: track, jobId: id, fit: 80, cluster: "backend",
    titleScore: 1, keywordScore: 1, seniorityScore: 1, geoScore: 1, compScore: 1,
    matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [], scorerVersion: "fixture",
  });
}

/** O SQL que `boardFacets` manda, com os parâmetros, capturado no cliente. */
async function facetStatement(): Promise<{ query: string; values: unknown[] }> {
  const client = db.$client as unknown as { unsafe: (...args: unknown[]) => Promise<unknown> };
  const original = client.unsafe.bind(client);
  const sent: { query: string; values: unknown[] }[] = [];
  client.unsafe = (...args: unknown[]) => {
    sent.push({ query: String(args[0]), values: Array.isArray(args[1]) ? args[1] : [] });
    return original(...args);
  };
  try {
    await boardFacets(1, { minFit: 45, groupRepeats: true });
  } finally {
    client.unsafe = original;
  }
  const facets = sent.find((statement) => statement.query.includes("facet_candidates"));
  expect(facets).toBeDefined();
  return facets!;
}

describe("índices de leitura das facetas (#222)", () => {
  it("a faceta de descrição acompanha edição e fechamento, igual ao filtro do quadro", async () => {
    await posting(1, "x".repeat(250));
    await posting(2, "curta");
    await posting(3, null);
    const described = async () => (await boardFacets(1, { minFit: 45 })).described;
    const filtered = () => countBoard(1, { minFit: 45, hasDescription: true });

    expect(await described()).toBe(1);
    await expect(filtered()).resolves.toBe(1);

    await db.update(job).set({ descriptionText: "y".repeat(200) }).where(eq(job.id, 2));
    expect(await described()).toBe(2);
    await expect(filtered()).resolves.toBe(2);

    await db.update(job).set({ closedAt: "2026-09-21T00:00:00Z" }).where(eq(job.id, 1));
    expect(await described()).toBe(1);
    await expect(filtered()).resolves.toBe(1);
  });

  it("o predicado das facetas é o do índice parcial: sem varredura, o plano o usa", async () => {
    await posting(1, "x".repeat(250));
    const { query, values } = await facetStatement();
    const client = db.$client as unknown as {
      begin: (work: (tx: { unsafe: (q: string, v?: unknown[]) => Promise<Array<Record<string, string>>> }) => Promise<string>) => Promise<string>;
    };
    // Na transação: sem varredura sequencial nem bitmap, o `in (...)` da
    // faceta só tem plano pelo índice se o predicado implicar o dele.
    const plan = await client.begin(async (tx) => {
      await tx.unsafe("set local enable_seqscan = off");
      await tx.unsafe("set local enable_bitmapscan = off");
      const rows = await tx.unsafe(`explain ${query}`, values);
      return rows.map((row) => row["QUERY PLAN"]).join("\n");
    });
    expect(plan).toContain("job_described_open_idx");
  });

  it("o índice de notas leva as colunas incluídas da migração custom", async () => {
    const [index] = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where schemaname = 'production' and indexname = 'job_score_board_cover_idx'`,
    );
    expect(index?.indexdef).toMatch(/\(candidate_id, track_id, job_id\) INCLUDE \(fit, cluster, blockers\)$/);
  });
});
