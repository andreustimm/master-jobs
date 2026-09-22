import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardFacets, countBoard } from "../src/core/db/repo.ts";
import { application, candidate, job, jobScore, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

let db: Awaited<ReturnType<typeof useTestDb>>;

beforeEach(async () => {
  db = await useTestDb();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  await db.insert(candidate).values([
    { id: 1, slug: "owner", name: "Owner" },
    { id: 2, slug: "other", name: "Other" },
  ]);
  await db.insert(source).values([
    { id: "lever:one", kind: "lever", handle: "one", label: "Lever" },
    { id: "lever:two", kind: "lever", handle: "two", label: "Other board" },
    { id: "ashby:one", kind: "ashby", handle: "one", label: "Ashby" },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await releaseTestDb();
});

async function posting(id: number, cluster: string | null, values: Partial<typeof job.$inferInsert> = {}, fit = 80) {
  await db.insert(job).values({
    id, sourceId: "lever:one", externalId: String(id), companyName: "Acme",
    title: "Architect", url: `https://example.test/${id}`, raw: {},
    fingerprint: `facet-${id}`, contentHash: `facet-${id}`,
    firstSeenAt: "2026-01-01T00:00:00Z", ...values,
  });
  if (cluster === null) return;
  await db.insert(jobScore).values({
    candidateId: 1, trackId: await primaryTrackId(db, 1), jobId: id, fit, cluster,
    titleScore: 1, keywordScore: 1, seniorityScore: 1, geoScore: 1, compScore: 1,
    matchedKeywords: [], missingKeywords: [], reasons: [],
    blockers: id === 2 ? ["restricted"] : [], scorerVersion: "fixture",
  });
}

describe("facetas com dimensões independentes", () => {
  it("escolhe a irmã elegível em cada dimensão e mantém anônimas separadas", async () => {
    await posting(1, "architect");
    await posting(2, "backend", {
      sourceId: "lever:two", title: " ARCHITECT ", companyName: " Acme ",
      compMax: 5_000, postedAt: "2026-09-22T00:00:00Z", descriptionText: "é".repeat(200),
    });
    await posting(3, "backend", { sourceId: "ashby:one" });
    await posting(4, "backend", { companyName: "Lever", descriptionText: "x".repeat(199) });
    await posting(5, "backend", { companyName: "Lever", descriptionText: "x".repeat(201) });
    await posting(6, "hidden", { title: "Low fit" }, 20);
    await posting(7, "hidden", { title: "Closed", closedAt: "2026-09-21T00:00:00Z" });
    await posting(8, "hidden", { title: "Archived" });
    await posting(9, "architect", { title: "Other group" });
    await posting(10, "backend", { sourceId: "lever:two" });
    await db.insert(application).values([
      { candidateId: 1, jobId: 2, status: "applied", appliedAt: "2026-09-21T00:00:00Z" },
      { candidateId: 1, jobId: 8, status: "archived" },
      { candidateId: 2, jobId: 4, status: "applied", appliedAt: "2026-09-21T00:00:00Z" },
    ]);

    const filters = { groupRepeats: true, minFit: 45, sourceKinds: ["lever"], cluster: "backend" };
    const facets = await boardFacets(1, filters);
    expect(facets).toEqual({
      total: 3, unblocked: 2, fresh: 1, withComp: 1, named: 1, described: 2, notApplied: 2,
      clusters: ["architect", "backend"], sources: ["ashby", "lever"],
    });
    await expect(countBoard(1, filters)).resolves.toBe(facets.total);
    expect((await boardFacets(1, { ...filters, groupRepeats: false })).total).toBe(4);
    expect((await boardFacets(1, { ...filters, hideApplied: true })).notApplied).toBe(3);
    expect((await boardFacets(1, { ...filters, sourceKinds: ["missing"] }))).toMatchObject({
      total: 0, clusters: [], sources: ["ashby", "lever"],
    });
  });

  it("não oferece o cluster de uma irmã quando a canônica sem filtro tem cluster nulo", async () => {
    await posting(1, null);
    await posting(2, "backend");
    const grouped = await boardFacets(1, { groupRepeats: true, cluster: "backend" });
    expect(grouped.total).toBe(1);
    expect(grouped.clusters).toEqual([]);
    expect((await boardFacets(1, { cluster: "backend" })).clusters).toEqual(["backend"]);
  });

  it("ignora escopo de candidato na sessão global e devolve zeros sem candidatos elegíveis", async () => {
    await posting(1, "private");
    await expect(boardFacets(null, { cluster: "private", minFit: 99, groupRepeats: true })).resolves.toMatchObject({
      total: 1, clusters: [], sources: ["lever"],
    });
    await expect(boardFacets(1, { minFit: 99, groupRepeats: true })).resolves.toEqual({
      total: 0, unblocked: 0, fresh: 0, withComp: 0, named: 0, described: 0, notApplied: 0,
      clusters: [], sources: [],
    });
  });
});
