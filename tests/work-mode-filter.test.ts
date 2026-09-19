import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boardFacets, countBoard, listBoard } from "../src/contexts/matching/index.ts";
import { readWorkMode } from "../src/contexts/matching/domain/work-mode.ts";
import { candidate, job, jobPage, jobScore, source } from "../src/core/db/schema.ts";
import { extractPage } from "../src/core/scrape/extract.ts";
import { clearRobotsCache } from "../src/core/scrape/robots.ts";
import { careersAdapter } from "../src/core/sources/careers.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

let db: Awaited<ReturnType<typeof useTestDb>>;
beforeEach(async () => {
  db = await useTestDb();
  await db.insert(source).values({ id: "manual:modes", kind: "manual", handle: "modes", label: "Modes" });
});
afterEach(() => {
  resetHttpPort();
  clearRobotsCache();
  releaseTestDb();
});

async function seed(id: number, values: Partial<typeof job.$inferInsert> = {}) {
  await db.insert(job).values({
    id, sourceId: "manual:modes", externalId: String(id), companyName: "Modes",
    title: `Mode role ${id}`, url: `https://example.test/${id}`,
    fingerprint: `mode-${id}`, contentHash: `mode-${id}`, raw: {}, ...values,
  });
}

describe("work-mode filters", () => {
  it("keeps list, count and facets consistent across known, absent and conflicting signals", async () => {
    await seed(1, { remote: true });
    await seed(2, { remote: false, raw: { workplaceType: " Hybrid " } });
    await seed(3, { remote: false, raw: { workplaceType: "On-site" } });
    await seed(4, { locationRaw: "Remote · Brazil" });
    await seed(5, { locationRaw: "São Paulo (HÍBRIDO)", remote: true });
    await seed(6, { locationRaw: "São Paulo · presencial" });
    await seed(7, { remote: null });
    await seed(8, { remote: false });
    await seed(9, { title: "Hybrid cloud architect", descriptionText: "Remote sensing and hybrid cloud systems" });
    await seed(10, { raw: { workplaceType: " " }, locationRaw: "fully remote" });
    await seed(11, { raw: { workplaceType: "unknown" }, locationRaw: "Híbrido" });
    await seed(12);
    await db.insert(jobPage).values({
      jobId: 12, finalUrl: "https://example.test/12", httpStatus: 200,
      contentHash: "captured", extracted: { fields: { workplace: "on site" } },
    });
    await seed(13, { locationRaw: "Remotely, Hybridization" });
    await seed(14, { remote: true, closedAt: "2026-01-01" });
    await seed(15, { raw: { workplaceType: "Remote" }, locationRaw: "Hybrid", remote: false });

    for (const [workMode, ids] of [
      ["remote", [1, 4, 10, 15]], ["hybrid", [2, 5, 11]], ["onsite", [3, 6]],
    ] as const) {
      const rows = await listBoard(null, { workMode });
      expect(rows.map((row) => row.jobId).sort((a, b) => a - b)).toEqual(ids);
      expect(rows.every((row) => row.fit === null && row.status === null)).toBe(true);
      await expect(countBoard(null, { workMode })).resolves.toBe(ids.length);
      const facets = await boardFacets(null, { workMode });
      expect(facets.total).toBe(ids.length);
      expect(facets.sources).toEqual(["manual"]);
      expect(facets.clusters).toEqual([]);
    }
    await expect(countBoard(null)).resolves.toBe(14);
  });

  it("ignores description guesses from captured pages and the careers adapter", async () => {
    const body = "We build dependable systems with engineers and product teams. ".repeat(5);
    const html = (text: string) => `<main><h1>Software engineer</h1><p>${text}. ${body}</p></main>`;
    for (const [id, text] of [[20, "Build hybrid cloud systems"], [21, "Develop remote sensing systems"], [22, "Maintain on-site customer hardware"]] as const) {
      await seed(id);
      const extracted = extractPage(html(text));
      expect(extracted.fields.workplace).toBeTruthy();
      await db.insert(jobPage).values({ jobId: id, finalUrl: `https://example.test/${id}`, httpStatus: 200, contentHash: String(id), extracted });
    }
    setHttpPort(fixtureHttp({
      "mode-careers.test/robots.txt": "",
      "mode-careers.test/careers": '<a href="/vagas/cloud">Cloud engineer\nRemote — Brazil</a><a href="/vagas/sensing">Sensing engineer\nSão Paulo</a>',
      "mode-careers.test/vagas/cloud": html("Build hybrid cloud systems"),
      "mode-careers.test/vagas/sensing": html("Develop remote sensing systems"),
    }));
    const { jobs } = await careersAdapter().fetchJobs({ kind: "careers", handle: "https://mode-careers.test/careers", label: "Modes" });
    expect(jobs).toHaveLength(2);
    expect(jobs[1]!.remote).toBe(true);
    await db.insert(source).values({ id: "careers:modes", kind: "careers", handle: "modes", label: "Modes" });
    for (const [index, incoming] of jobs.entries()) {
      await seed(30 + index, { sourceId: "careers:modes", locationRaw: incoming.locationRaw, remote: incoming.remote, raw: incoming.raw, descriptionText: incoming.descriptionText });
    }
    for (const [workMode, ids] of [["remote", [30]], ["hybrid", []], ["onsite", []]] as const) {
      expect((await listBoard(null, { workMode })).map((row) => row.jobId)).toEqual(ids);
      await expect(countBoard(null, { workMode })).resolves.toBe(ids.length);
      expect((await boardFacets(null, { workMode })).total).toBe(ids.length);
    }
    await expect(countBoard(null)).resolves.toBe(5);
  });

  it("filters before pagination and composes with candidate score, search and source", async () => {
    await db.insert(candidate).values({ id: 1, slug: "owner", name: "Owner" });
    for (let id = 1; id <= 24; id++) {
      await seed(id, { remote: id % 2 === 0 });
      await db.insert(jobScore).values({
        candidateId: 1, jobId: id, fit: id > 4 ? 70 : 30,
        trackId: await primaryTrackId(db, 1),
        titleScore: 10, keywordScore: 10, seniorityScore: 10, geoScore: 10,
        compScore: 10, freshnessScore: 10, benefitScore: 10, penalty: 0,
        cluster: "architect", matchedKeywords: [], missingKeywords: [],
        reasons: [], blockers: [], scorerVersion: "fixture",
      });
    }
    const filters = { workMode: "remote", minFit: 45, sourceKind: "manual", q: "Mode role" } as const;
    const first = await listBoard(1, { ...filters, limit: 5 });
    const second = await listBoard(1, { ...filters, limit: 5, offset: 5 });
    expect(first).toHaveLength(5);
    expect(second).toHaveLength(5);
    expect(new Set([...first, ...second].map((row) => row.jobId)).size).toBe(10);
    expect([...first, ...second].every((row) => row.jobId > 4 && row.jobId % 2 === 0)).toBe(true);
    await expect(countBoard(1, filters)).resolves.toBe(10);
    expect((await boardFacets(1, filters)).clusters).toEqual(["architect"]);
    await db.update(job).set({ closedAt: "2026-01-01" }).where(eq(job.id, 24));
    await expect(countBoard(1, filters)).resolves.toBe(9);
    await expect(countBoard(1, { ...filters, q: "does not exist" })).resolves.toBe(0);
  });

  it("ignores unsupported URL values instead of accepting arbitrary SQL input", () => {
    expect(readWorkMode("remote")).toBe("remote");
    expect(readWorkMode("hybrid")).toBe("hybrid");
    expect(readWorkMode("onsite")).toBe("onsite");
    expect(readWorkMode("all")).toBeUndefined();
    expect(readWorkMode(undefined)).toBeUndefined();
    expect(readWorkMode("remote' or 1=1 --")).toBeUndefined();
  });
});
