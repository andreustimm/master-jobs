import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { boardFacets, countBoard, getJobDetail, listBoard } from "../src/core/db/repo.ts";
import { application, candidate, company, job, jobScore, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

async function seedBoard(size: number): Promise<number> {
  const [owner] = await db
    .insert(candidate)
    .values({ slug: "owner", name: "Owner", isDefault: true })
    .returning({ id: candidate.id });
  await db.insert(source).values({
    id: "manual:board",
    kind: "manual",
    handle: "board",
    label: "Board source",
  });
  const [employer] = await db
    .insert(company)
    .values({ slug: "board-company", name: "Board company" })
    .returning({ id: company.id });

  await db.execute(sql.raw(`
    with recursive n(x) as (
      values(1)
      union all
      select x + 1 from n where x < ${size}
    )
    insert into production.job (
      source_id, company_id, company_name, external_id, title, url,
      fingerprint, content_hash, raw
    )
    select
      'manual:board', ${employer!.id}, 'Board company', 'job-' || x,
      'Architect ' || x, 'manual://board/' || x, 'board-fp-' || x,
      'board-hash-' || x, '{}'
    from n
  `));
  return owner!.id;
}

describe("Board SQL read model", () => {
  it("counts and facets every row beyond the former 5,000 ceiling", async () => {
    const candidateId = await seedBoard(5_005);

    await expect(countBoard(candidateId)).resolves.toBe(5_005);
    const facets = await boardFacets(candidateId);
    expect(facets.total).toBe(5_005);
    expect(facets.sources).toEqual(["manual"]);

    const tail = await listBoard(candidateId, { offset: 5_000, limit: 10 });
    expect(tail).toHaveLength(5);
  });

  it("applies status before limit/offset and gives count the same predicate", async () => {
    const candidateId = await seedBoard(30);
    await db.execute(sql.raw(`
      insert into production.application (candidate_id, job_id, status)
      select ${candidateId}, id, 'applied'
      from production.job
      order by id desc
      limit 10
    `));

    const page = await listBoard(candidateId, { status: "applied", limit: 5, offset: 5 });
    expect(page).toHaveLength(5);
    expect(page.every((row) => row.status === "applied")).toBe(true);
    await expect(countBoard(candidateId, { status: "applied" })).resolves.toBe(10);
    await expect(countBoard(candidateId, { status: "unfiled" })).resolves.toBe(20);
  });

  it("esconde a vaga arquivada (\"não me interessa\") de toda lista que não a pediu", async () => {
    const candidateId = await seedBoard(6);
    await db.execute(sql.raw(`
      insert into production.application (candidate_id, job_id, status)
      select ${candidateId}, id, case when rn <= 2 then 'archived' else 'shortlisted' end
      from (select id, row_number() over (order by id) as rn from production.job) ranked
      where rn <= 3
    `));

    const rows = await listBoard(candidateId);
    expect(rows).toHaveLength(4);
    expect(rows.some((row) => row.status === "archived")).toBe(false);
    await expect(countBoard(candidateId)).resolves.toBe(4);
    await expect(boardFacets(candidateId)).resolves.toMatchObject({ total: 4 });

    await expect(countBoard(candidateId, { status: "archived" })).resolves.toBe(2);
    await expect(countBoard(candidateId, { status: "any" })).resolves.toBe(6);
    await expect(countBoard(candidateId, { status: "unfiled" })).resolves.toBe(3);

    // A decisão é de quem arquivou: outra pessoa continua vendo a vaga.
    const [other] = await db.insert(candidate).values({ slug: "other", name: "Other" }).returning({ id: candidate.id });
    await expect(countBoard(other!.id)).resolves.toBe(6);
    await expect(countBoard(null)).resolves.toBe(6);
  });

  it("mantém o acervo global para quem não tem candidato, mesmo com o corte padrão", async () => {
    await seedBoard(2);

    const rows = await listBoard(null, { minFit: 45 });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.fit === null && row.status === null)).toBe(true);
    await expect(countBoard(null, { minFit: 45 })).resolves.toBe(2);
    await expect(boardFacets(null, { minFit: 45 })).resolves.toMatchObject({
      total: 2,
      clusters: [],
      sources: ["manual"],
    });
  });

  it("lê o detalhe global sem anexar score ou funil de um candidato", async () => {
    const candidateId = await seedBoard(1);
    const [row] = await db.select({ id: job.id }).from(job).limit(1);
    await db.insert(jobScore).values({
      candidateId,
      trackId: await primaryTrackId(db, candidateId),
      jobId: row!.id,
      fit: 88,
      titleScore: 88,
      keywordScore: 88,
      seniorityScore: 88,
      geoScore: 88,
      compScore: 88,
      cluster: "architect",
      matchedKeywords: ["typescript"],
      missingKeywords: [],
      reasons: ["score privado"],
      blockers: [],
      scorerVersion: "teste",
    });
    await db.insert(application).values({ candidateId, jobId: row!.id, status: "applied" });

    const detail = await getJobDetail(null, row!.id);

    expect(detail?.job.id).toBe(row!.id);
    expect(detail?.score).toBeNull();
    expect(detail?.application).toBeNull();
  });
});
