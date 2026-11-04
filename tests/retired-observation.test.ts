import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "../src/core/db/client.ts";
import { job, jobRetentionTombstone, source } from "../src/core/db/schema.ts";
import { fingerprint } from "../src/core/ingest/normalize.ts";
import { observeRawJob, observeRawJobs } from "../src/core/ingest/observe.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
const raw = { externalId: "42", companyName: "Acme", title: "Engineer", url: "https://example.test/42", raw: {} };

beforeEach(async () => {
  db = await useTestDb();
  await db.insert(source).values([
    { id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" },
    { id: "manual:local", kind: "manual", handle: "local", label: "Manual" },
    { id: "personal-feed", kind: "manual", handle: "personal", label: "Pessoal" },
  ]);
  await db.insert(jobRetentionTombstone).values({
    fingerprint: fingerprint(raw), sourceId: "lever:acme", externalId: "42", externalUsable: true,
    firstSeenAt: "2026-01-01T00:00:00.000Z", expiredAt: "2026-02-01T00:00:00.000Z",
  });
});
afterEach(() => releaseTestDb());

describe("observação de vaga com identidade expirada", () => {
  it("não reimporta a mesma vaga nem edição com id externo confiável", async () => {
    const same = await observeRawJobs([raw], "lever:acme");
    const edited = await observeRawJobs([{ ...raw, title: "Senior Engineer" }], "lever:acme");
    expect(same[0]).toMatchObject({ outcome: "retired", jobId: null });
    expect(edited[0]).toMatchObject({ outcome: "retired", jobId: null });
    expect(await db.select().from(job)).toHaveLength(0);
  });

  it("permite inclusão manual e preserva a linha viva em observações posteriores", async () => {
    const manual = await observeRawJob({ ...raw, descriptionText: "Texto da pessoa", raw: { notes: "Contato pessoal" } }, "manual:local");
    expect(manual.outcome).toBe("inserted");
    const again = await observeRawJobs([raw], "lever:acme");
    expect(again[0]).toMatchObject({ jobId: manual.jobId, outcome: "unchanged" });
    const [preserved] = await db.select().from(job).where(eq(job.id, manual.jobId));
    expect(preserved).toMatchObject({ sourceId: "manual:local", descriptionText: "Texto da pessoa", raw: { notes: "Contato pessoal" } });
  });

  it("não usa id ambíguo quando a mesma listagem traz fingerprints diferentes", async () => {
    const results = await observeRawJobs([
      { ...raw, title: "Architect" }, { ...raw, title: "Designer" },
    ], "lever:acme");
    expect(results.map((result) => result.outcome)).toEqual(["inserted", "inserted"]);
  });

  it("reconhece fonte manual pelo tipo, mesmo sem prefixo no identificador", async () => {
    const manual = await observeRawJob({ ...raw, raw: { notes: "Não perder" } }, "personal-feed");
    await observeRawJobs([raw], "lever:acme");
    const [stored] = await db.select().from(job).where(eq(job.id, manual.jobId));
    expect(stored).toMatchObject({ sourceId: "personal-feed", raw: { notes: "Não perder" } });
  });
});

it("insere nova publicação com o mesmo fingerprint e outro id confiável", async () => {
  const [result] = await observeRawJobs([{ ...raw, externalId: "new-42" }], "lever:acme");
  expect(result).toMatchObject({ outcome: "inserted" });
  expect(await db.select().from(job)).toHaveLength(1);
});
