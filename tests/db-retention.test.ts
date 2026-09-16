import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  candidate,
  job,
  jobPage,
  source,
} from "../src/core/db/schema.ts";
import { runDatabaseCleanup } from "../src/core/db/retention.ts";
import { observeRawJob } from "../src/core/ingest/observe.ts";
import { listBoard } from "../src/core/db/repo.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  await db.insert(source).values([
    { id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" },
    { id: "manual:local", kind: "manual", handle: "local", label: "Manual" },
  ]);
});

afterEach(() => releaseTestDb());

describe("retenção do banco", () => {
  it("não persiste HTML nem payload integral de observações vindas da internet", async () => {
    await observeRawJob(
      {
        externalId: "web-1",
        companyName: "Acme",
        title: "Staff Engineer",
        url: "https://jobs.example/web-1",
        descriptionHtml: `<main>${"lixo ".repeat(500)}</main>`,
        descriptionText: "Descrição útil",
        raw: { response: "payload grande", nested: { description: "duplicada" } },
      },
      "lever:acme",
    );

    const [stored] = await db.select().from(job);
    expect(stored?.descriptionText).toBe("Descrição útil");
    expect(stored?.descriptionHtml).toBeNull();
    expect(stored?.raw).toEqual({});
  });

  it("preserva o workplaceType mínimo para o filtro de modalidade", async () => {
    await observeRawJob(
      {
        externalId: "hybrid-1",
        companyName: "Acme",
        title: "Staff Engineer",
        url: "https://jobs.example/hybrid-1",
        descriptionText: "Descrição útil",
        raw: { workplaceType: "Hybrid", response: "payload grande" },
      },
      "lever:acme",
    );

    const [stored] = await db.select().from(job);
    expect(stored?.raw).toEqual({ workplaceType: "Hybrid" });
    const rows = await listBoard(null, { workMode: "hybrid" });
    expect(rows.map((row) => row.jobId)).toEqual([stored!.id]);
  });

  it("preserva metadados autorais de cadastro manual", async () => {
    await observeRawJob(
      {
        externalId: "manual-1",
        companyName: "Acme",
        title: "Architect",
        url: "manual://local/1",
        descriptionText: "Texto colado pela pessoa",
        raw: { manual: true, notes: "Indicação da Ana" },
      },
      "manual:local",
    );

    const [stored] = await db.select().from(job);
    expect(stored?.raw).toEqual({ manual: true, notes: "Indicação da Ana" });
  });

  it("dry-run mede o descarte sem alterar nenhuma linha", async () => {
    const jobId = await seedLegacyWebJob("2020-01-01T00:00:00.000Z");
    await seedParsedPage(jobId);

    const result = await runDatabaseCleanup({
      apply: false,
      now: new Date("2026-08-29T12:00:00.000Z"),
      closedJobDays: 90,
      pageHtmlDays: 0,
    });

    expect(result.candidates).toMatchObject({
      onlineJobs: 1,
      parsedPages: 1,
      closedJobs: 1,
    });
    expect(result.candidates.reclaimableBytes).toBeGreaterThan(10_000);
    expect(result.applied).toBeNull();
    const [storedJob] = await db.select().from(job).where(eq(job.id, jobId));
    const [storedPage] = await db.select().from(jobPage).where(eq(jobPage.jobId, jobId));
    expect(storedJob?.descriptionHtml).not.toBeNull();
    expect(storedPage?.html).not.toBeNull();
  });

  it("aplica a limpeza e nunca remove vaga ligada a candidatura", async () => {
    const removableId = await seedLegacyWebJob("2020-01-01T00:00:00.000Z");
    await seedParsedPage(removableId);
    const protectedId = await seedLegacyWebJob("2020-01-01T00:00:00.000Z", "protected");
    const [owner] = await db
      .insert(candidate)
      .values({ slug: "owner", name: "Owner", isDefault: true })
      .returning({ id: candidate.id });
    await db.insert(application).values({
      candidateId: owner!.id,
      jobId: protectedId,
      status: "applied",
    });

    const result = await runDatabaseCleanup({
      apply: true,
      now: new Date("2026-08-29T12:00:00.000Z"),
      closedJobDays: 90,
      pageHtmlDays: 0,
    });

    expect(result.applied).toEqual({ compactedJobs: 2, clearedPages: 1, prunedJobs: 1 });
    const remaining = await db.select().from(job);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(protectedId);
    expect(remaining[0]?.descriptionHtml).toBeNull();
    expect(remaining[0]?.raw).toEqual({ workplaceType: "Hybrid" });

    const second = await runDatabaseCleanup({
      apply: true,
      now: new Date("2026-08-29T12:00:00.000Z"),
      closedJobDays: 90,
      pageHtmlDays: 0,
    });
    expect(second.candidates.onlineJobs).toBe(0);
    expect(second.applied).toEqual({ compactedJobs: 0, clearedPages: 0, prunedJobs: 0 });
  });
});

async function seedLegacyWebJob(closedAt: string, suffix = "legacy"): Promise<number> {
  const [stored] = await db
    .insert(job)
    .values({
      fingerprint: `fp-${suffix}`,
      contentHash: `hash-${suffix}`,
      sourceId: "lever:acme",
      externalId: suffix,
      companyName: "Acme",
      title: "Legacy",
      url: `https://jobs.example/${suffix}`,
      descriptionHtml: `<main>${"html bruto ".repeat(800)}</main>`,
      descriptionText: "Descrição útil preservada",
      raw: { fullApiResponse: "payload duplicado", workplaceType: "Hybrid" },
      closedAt,
    })
    .returning({ id: job.id });
  return stored!.id;
}

async function seedParsedPage(jobId: number): Promise<void> {
  const html = `<html>${"navegação e scripts ".repeat(800)}</html>`;
  await db.insert(jobPage).values({
    jobId,
    finalUrl: `https://jobs.example/${jobId}`,
    httpStatus: 200,
    html,
    text: "Descrição extraída",
    extracted: { title: "Legacy", fields: {}, requirements: [] },
    contentHash: `page-${jobId}`,
    bytes: html.length,
    fetchedAt: "2026-08-20T00:00:00.000Z",
    parsedAt: "2026-08-20T00:00:01.000Z",
  });
}
