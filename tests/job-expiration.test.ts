import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { DB } from "../src/core/db/client.ts";
import { application, candidate, job, jobRetentionTombstone, source } from "../src/core/db/schema.ts";
import { expireOldJobsBatch } from "../src/core/db/retention.ts";
import { observeRawJob, observeRawJobs } from "../src/core/ingest/observe.ts";
import { fingerprint } from "../src/core/ingest/normalize.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
const old = "2026-08-01T00:00:00.000Z";
const now = new Date("2026-08-29T12:00:00.000Z");
const raw = (id: string) => ({ externalId: id, companyName: "Acme", title: `Engineer ${id}`, url: `https://example.test/${id}`, raw: {} });

beforeEach(async () => {
  db = await useTestDb();
  await db.insert(source).values([
    { id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" },
    { id: "manual:local", kind: "manual", handle: "local", label: "Manual" },
  ]);
});
afterEach(() => releaseTestDb());

describe("retenção administrativa de 14 dias", () => {
  it("expira em lotes, mantém decisões e não reimporta o mesmo id após edição", async () => {
    const disposable = await observeRawJob(raw("one"), "lever:acme", { observedAt: old });
    const tracked = await observeRawJob(raw("two"), "lever:acme", { observedAt: old });
    const manual = await observeRawJob(raw("three"), "manual:local", { observedAt: old });
    await observeRawJob(raw("fresh"), "lever:acme", { observedAt: "2026-08-28T00:00:00.000Z" });
    const [owner] = await db.insert(candidate).values({ slug: "owner", name: "Owner" }).returning();
    await db.insert(application).values({ candidateId: owner!.id, jobId: tracked.jobId, status: "untracked" });

    const result = await expireOldJobsBatch({ now, limit: 1 });
    expect(result.jobs.map((item) => item.id)).toEqual([disposable.jobId]);
    expect(await db.select().from(job).where(eq(job.id, disposable.jobId))).toHaveLength(0);
    expect(await db.select().from(job).where(eq(job.id, tracked.jobId))).toHaveLength(1);
    expect(await db.select().from(job).where(eq(job.id, manual.jobId))).toHaveLength(1);
    expect(await db.select().from(application)).toHaveLength(1);
    const markers = await db.select().from(jobRetentionTombstone);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ externalId: "one", externalUsable: true, firstSeenAt: old, originalJobId: disposable.jobId, batchId: result.batchId });
    const repeated = await observeRawJobs([{ ...raw("one"), title: "Renamed Engineer" }], "lever:acme");
    expect(repeated[0]).toMatchObject({ outcome: "retired", jobId: null });
    expect((await expireOldJobsBatch({ now })).jobs).toEqual([]);
  });

  it("não transforma um id externo duplicado em identidade confiável", async () => {
    const rows = await observeRawJobs([
      { ...raw("same"), title: "Engineer" }, { ...raw("same"), title: "Designer" },
    ], "lever:acme", { observedAt: old });
    expect(rows).toHaveLength(2);
    expect((await db.select({ id: job.id, externalId: job.externalId, sourceId: job.sourceId }).from(job)).map((x) => [x.sourceId, x.externalId])).toEqual([["lever:acme", "same"], ["lever:acme", "same"]]);
    const duplicateQuery = db.select({ value: sql<boolean>`not exists (select 1 from ${job} other where other.source_id = "job"."source_id" and other.external_id = "job"."external_id" and other.id <> "job"."id")` }).from(job);
    const duplicateCheck = await duplicateQuery;
    expect(duplicateCheck.map((item) => item.value)).toEqual([false, false]);
    expect((await expireOldJobsBatch({ now })).jobs).toHaveLength(2);
    const markers = await db.select().from(jobRetentionTombstone);
    expect(markers.map((item) => item.externalUsable)).toEqual([false, false]);
    const newPosting = await observeRawJobs([{ ...raw("same"), title: "Manager" }], "lever:acme");
    expect(newPosting[0]?.outcome).toBe("inserted");
  });

  it("reverte o marcador se a exclusão falhar", async () => {
    const row = await observeRawJob(raw("rollback"), "lever:acme", { observedAt: old });
    await db.execute(sql`create function production.reject_expiry_test() returns trigger language plpgsql as $$ begin raise exception 'test rejection'; end $$`);
    await db.execute(sql`create trigger reject_expiry_test before delete on production.job for each row execute function production.reject_expiry_test()`);
    await expect(expireOldJobsBatch({ now })).rejects.toThrow();
    expect(await db.select().from(job).where(eq(job.id, row.jobId))).toHaveLength(1);
    expect(await db.select().from(jobRetentionTombstone)).toHaveLength(0);
  });

  it("não descarta vaga enquanto uma candidatura concorrente aguarda confirmação", async () => {
    const tracked = await observeRawJob(raw("racing"), "lever:acme", { observedAt: old });
    const [owner] = await db.insert(candidate).values({ slug: "race", name: "Race" }).returning();
    const other = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const connection = await other.reserve();
    try {
      await connection`begin`;
      await connection`insert into production.application (candidate_id, job_id, status) values (${owner!.id}, ${tracked.jobId}, 'applied')`;
      const batch = await expireOldJobsBatch({ now });
      expect(batch.jobs).toEqual([]);
      await connection`commit`;
      expect(await db.select().from(application).where(eq(application.jobId, tracked.jobId))).toHaveLength(1);
      expect(await db.select().from(job).where(eq(job.id, tracked.jobId))).toHaveLength(1);
    } finally {
      connection.release();
      await other.end({ timeout: 5 });
    }
  });

  it("espera a retenção terminar antes de ler marcadores para uma nova observação", async () => {
    const original = await observeRawJob(raw("overlap"), "lever:acme", { observedAt: old });
    const other = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
    const connection = await other.reserve();
    try {
      await connection`begin`;
      await connection`lock table production.job in share row exclusive mode`;
      await connection`insert into production.job_retention_tombstone (fingerprint, source_id, external_id, external_usable, first_seen_at, expired_at) values (${fingerprint(raw("overlap"))}, 'lever:acme', 'overlap', true, ${old}, ${now.toISOString()})`;
      await connection`delete from production.job where id = ${original.jobId}`;
      const observing = observeRawJobs([raw("overlap")], "lever:acme");
      let waiting = false;
      for (let attempt = 0; attempt < 250; attempt++) {
        const [state] = await other<{ n: number }[]>`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`;
        if (state!.n > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await connection`commit`;
      expect((await observing)[0]).toMatchObject({ outcome: "retired", jobId: null });
      expect(await db.select().from(job)).toHaveLength(0);
    } finally {
      connection.release();
      await other.end({ timeout: 5 });
    }
  });

  it("uma colisão de fingerprint não invalida a transação de observação", async () => {
    const [first, second] = await observeRawJobs([raw("first"), raw("second")], "lever:acme", { observedAt: old });
    if (first?.outcome === "retired" || second?.outcome === "retired" || !first || !second) throw new Error("seed inválido");
    const other = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
    const connection = await other.reserve();
    try {
      await connection`begin`;
      await connection`select id from production.job where id = ${first.jobId} for update`;
      const observingFirst = observeRawJobs([{ ...raw("first"), title: "Shared title" }], "lever:acme");
      let waiting = false;
      for (let attempt = 0; attempt < 250; attempt++) {
        const [state] = await other<{ n: number }[]>`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`;
        if (state!.n > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await connection`update production.job set fingerprint = ${fingerprint({ ...raw("second"), title: "Shared title" })}, title = 'Shared title' where id = ${second.jobId}`;
      await connection`commit`;
      expect((await observingFirst)[0]?.jobId).toBe(first.jobId);
      expect(await db.select().from(job)).toHaveLength(2);
    } finally {
      connection.release();
      await other.end({ timeout: 5 });
    }
  });
});
