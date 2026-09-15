import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { boardFacets, countBoard, getJobDetail, listBoard } from "../src/core/db/repo.ts";
import { candidate, company, job, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
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

  await db.run(sql.raw(`
    with recursive n(x) as (
      values(1)
      union all
      select x + 1 from n where x < ${size}
    )
    insert into job (
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
    await db.run(sql.raw(`
      insert into application (candidate_id, job_id, status)
      select ${candidateId}, id, 'applied'
      from job
      order by id desc
      limit 10
    `));

    const page = await listBoard(candidateId, { status: "applied", limit: 5, offset: 5 });
    expect(page).toHaveLength(5);
    expect(page.every((row) => row.status === "applied")).toBe(true);
    await expect(countBoard(candidateId, { status: "applied" })).resolves.toBe(10);
    await expect(countBoard(candidateId, { status: "unfiled" })).resolves.toBe(20);
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
    await seedBoard(1);
    const [row] = await db.select({ id: job.id }).from(job).limit(1);
    const detail = await getJobDetail(null, row!.id);

    expect(detail?.job.id).toBe(row!.id);
    expect(detail?.score).toBeNull();
    expect(detail?.application).toBeNull();
  });
});
