import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  applicationEvent,
  candidate,
  job,
  source,
  verifyTask,
} from "../src/core/db/schema.ts";
import { archiveClosedJobs } from "../src/core/ingest/archive.ts";
import { recordVerdict } from "../src/core/ingest/verify-queue.ts";
import { runDatabaseCleanup } from "../src/core/db/retention.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Suite: arquivamento de vagas fechadas (F-07, IT-001, IT-002 e IT-005)
 * Invariant: arquivar esconde e é reversível; nunca apaga e nunca toca no funil.
 * Boundary IN: a migration aplicada e a escrita real em PostgreSQL.
 * Boundary OUT: a decisão pura, coberta por tests/job-lifecycle.test.ts.
 */

const NOW = new Date("2026-09-18T12:00:00.000Z");
const LONG_AGO = "2026-01-01T00:00:00.000Z";
const RECENT = "2026-09-10T00:00:00.000Z";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  await db.insert(source).values([
    { id: "web:test", kind: "greenhouse", handle: "test", label: "Fonte de teste" },
    { id: "manual:test", kind: "manual", handle: "manual", label: "Cadastro manual" },
  ]);
});

afterEach(async () => {
  await releaseTestDb();
});

type JobSeed = {
  externalId: string;
  closedAt: string | null;
  archivedAt?: string | null;
  checkStatus?: string | null;
  sourceId?: string;
};

async function seedJob(seed: JobSeed): Promise<number> {
  const [row] = await db
    .insert(job)
    .values({
      fingerprint: `fp:${seed.externalId}`,
      contentHash: `hash:${seed.externalId}`,
      sourceId: seed.sourceId ?? "web:test",
      externalId: seed.externalId,
      companyName: "Acme",
      title: `Vaga ${seed.externalId}`,
      url: `https://example.test/${seed.externalId}`,
      closedAt: seed.closedAt,
      archivedAt: seed.archivedAt ?? null,
      checkStatus: seed.checkStatus ?? null,
      raw: {},
    })
    .returning({ id: job.id });
  return row!.id;
}

async function seedApplication(jobId: number): Promise<number> {
  const [person] = await db
    .insert(candidate)
    .values({ slug: `candidato-${jobId}`, name: "Candidato" })
    .returning({ id: candidate.id });
  const [row] = await db
    .insert(application)
    .values({ candidateId: person!.id, jobId, status: "applied" })
    .returning({ id: application.id });
  await db.insert(applicationEvent).values({
    applicationId: row!.id,
    kind: "status_change",
    toStatus: "applied",
    at: LONG_AGO,
  });
  return row!.id;
}

describe("IT-001 — a varredura escreve só o que decidiu escrever", () => {
  it("dry-run conta os elegíveis e não muda uma linha", async () => {
    const old = await seedJob({ externalId: "velha", closedAt: LONG_AGO });
    await seedJob({ externalId: "aberta", closedAt: null });

    const report = await archiveClosedJobs({ now: NOW, closedDays: 90 });

    expect(report.eligible).toBe(1);
    expect(report.applied).toBeNull();
    const [row] = await db.select({ archivedAt: job.archivedAt }).from(job).where(eq(job.id, old));
    expect(row!.archivedAt).toBeNull();
  });

  it("apply arquiva a fechada antiga e deixa as demais em paz", async () => {
    const old = await seedJob({ externalId: "velha", closedAt: LONG_AGO });
    const recent = await seedJob({ externalId: "recente", closedAt: RECENT });
    const manual = await seedJob({
      externalId: "manual",
      closedAt: LONG_AGO,
      sourceId: "manual:test",
    });
    const blocked = await seedJob({
      externalId: "inconclusiva",
      closedAt: LONG_AGO,
      checkStatus: "inconclusive",
    });

    const report = await archiveClosedJobs({ now: NOW, closedDays: 90, apply: true });

    expect(report.applied).toEqual({ archived: 1, claimedByAnotherRun: 0 });
    expect(report.kept["recent-closure"]).toBe(1);
    expect(report.kept["manual-source"]).toBe(1);
    expect(report.kept["inconclusive-probe"]).toBe(1);

    const rows = await db.select({ id: job.id, archivedAt: job.archivedAt }).from(job);
    const archived = new Map(rows.map((r) => [r.id, r.archivedAt]));
    expect(archived.get(old)).toBe(NOW.toISOString());
    for (const id of [recent, manual, blocked]) expect(archived.get(id)).toBeNull();
  });

  it("zero elegível produz relatório de zero mudança, não erro", async () => {
    await seedJob({ externalId: "aberta", closedAt: null });
    const report = await archiveClosedJobs({ now: NOW, apply: true });
    expect(report.eligible).toBe(0);
    expect(report.applied).toEqual({ archived: 0, claimedByAnotherRun: 0 });
  });

  it("corte inválido é recusado antes de qualquer escrita", async () => {
    const old = await seedJob({ externalId: "velha", closedAt: LONG_AGO });
    await expect(archiveClosedJobs({ now: NOW, closedDays: -1, apply: true })).rejects.toThrow(
      /inteiro maior ou igual a zero/,
    );
    const [row] = await db.select({ archivedAt: job.archivedAt }).from(job).where(eq(job.id, old));
    expect(row!.archivedAt).toBeNull();
  });

  it("o teto pagina e avisa que sobrou trabalho, com totais estáveis", async () => {
    for (const n of [1, 2, 3]) await seedJob({ externalId: `velha-${n}`, closedAt: LONG_AGO });

    const first = await archiveClosedJobs({ now: NOW, limit: 2 });
    expect(first.scanned).toBe(2);
    expect(first.hasMore).toBe(true);
    // Repetir a mesma leitura devolve o mesmo total: a ordem é declarada.
    const again = await archiveClosedJobs({ now: NOW, limit: 2 });
    expect(again.eligible).toBe(first.eligible);
  });
});

describe("IT-001 — candidatura atravessa o arquivamento intacta", () => {
  it("arquiva a vaga e preserva candidatura, evento e estágio", async () => {
    const jobId = await seedJob({ externalId: "com-candidatura", closedAt: LONG_AGO });
    const applicationId = await seedApplication(jobId);

    const report = await archiveClosedJobs({ now: NOW, apply: true });

    expect(report.preservedByApplication).toBe(1);
    expect(report.applied?.archived).toBe(1);

    const [app] = await db
      .select({ status: application.status, jobId: application.jobId })
      .from(application)
      .where(eq(application.id, applicationId));
    expect(app).toEqual({ status: "applied", jobId });

    const events = await db
      .select({ id: applicationEvent.id })
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, applicationId));
    expect(events).toHaveLength(1);
  });
});

describe("IT-002 — arquivar e podar são políticas separadas", () => {
  it("poda só a fechada sem candidatura; a arquivada com candidatura continua lá", async () => {
    const tracked = await seedJob({ externalId: "com-candidatura", closedAt: LONG_AGO });
    const untracked = await seedJob({ externalId: "sem-candidatura", closedAt: LONG_AGO });
    await seedApplication(tracked);

    await archiveClosedJobs({ now: NOW, apply: true });
    await runDatabaseCleanup({ apply: true, closedJobDays: 90, now: NOW });

    const rows = await db.select({ id: job.id, archivedAt: job.archivedAt }).from(job);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(tracked);
    expect(ids).not.toContain(untracked);
    expect(rows.find((r) => r.id === tracked)!.archivedAt).toBe(NOW.toISOString());
  });
});

describe("IT-005 — repetição e concorrência não multiplicam escrita", () => {
  it("aplicar duas vezes é no-op na segunda", async () => {
    const jobId = await seedJob({ externalId: "velha", closedAt: LONG_AGO });

    const first = await archiveClosedJobs({ now: NOW, apply: true });
    const later = new Date("2026-09-19T12:00:00.000Z");
    const second = await archiveClosedJobs({ now: later, apply: true });

    expect(first.applied?.archived).toBe(1);
    expect(second.eligible).toBe(0);
    expect(second.applied).toEqual({ archived: 0, claimedByAnotherRun: 0 });

    const [row] = await db.select({ archivedAt: job.archivedAt }).from(job).where(eq(job.id, jobId));
    // O carimbo é o da primeira execução: reexecutar não reescreve a data.
    expect(row!.archivedAt).toBe(NOW.toISOString());
  });

  it("execuções concorrentes arquivam a linha uma vez só", async () => {
    for (const n of [1, 2, 3]) await seedJob({ externalId: `velha-${n}`, closedAt: LONG_AGO });

    const reports = await Promise.all([
      archiveClosedJobs({ now: NOW, apply: true }),
      archiveClosedJobs({ now: NOW, apply: true }),
    ]);

    const archived = reports.reduce((sum, r) => sum + (r.applied?.archived ?? 0), 0);
    expect(archived).toBe(3);

    const rows = await db.select({ archivedAt: job.archivedAt }).from(job);
    expect(rows.filter((r) => r.archivedAt !== null)).toHaveLength(3);
  });

  it("um alive posterior devolve a vaga arquivada ao quadro, sem mexer no funil", async () => {
    const jobId = await seedJob({ externalId: "ressuscitada", closedAt: LONG_AGO });
    const applicationId = await seedApplication(jobId);
    await archiveClosedJobs({ now: NOW, apply: true });

    const [task] = await db
      .insert(verifyTask)
      .values({ jobId, url: "https://example.test/ressuscitada" })
      .returning({ id: verifyTask.id });

    const decision = await recordVerdict(task!.id, jobId, "alive", 200);

    expect(decision).toEqual({ kind: "reopen", clearsArchive: true });
    const [row] = await db
      .select({ closedAt: job.closedAt, archivedAt: job.archivedAt, fingerprint: job.fingerprint })
      .from(job)
      .where(eq(job.id, jobId));
    expect(row!.closedAt).toBeNull();
    expect(row!.archivedAt).toBeNull();
    // Reabrir é a MESMA linha voltando: fingerprint duplicado seria uma vaga nova.
    expect(row!.fingerprint).toBe("fp:ressuscitada");

    const [app] = await db
      .select({ status: application.status })
      .from(application)
      .where(eq(application.id, applicationId));
    expect(app!.status).toBe("applied");

    const rows = await db.select({ id: job.id }).from(job);
    expect(rows).toHaveLength(1);
  });

  it("gone e inconclusive não desarquivam nada", async () => {
    const jobId = await seedJob({ externalId: "velha", closedAt: LONG_AGO });
    await archiveClosedJobs({ now: NOW, apply: true });
    const [task] = await db
      .insert(verifyTask)
      .values({ jobId, url: "https://example.test/velha" })
      .returning({ id: verifyTask.id });

    const decision = await recordVerdict(task!.id, jobId, "inconclusive", 403);

    expect(decision).toEqual({ kind: "noop", reason: "not-alive" });
    const [row] = await db.select({ archivedAt: job.archivedAt }).from(job).where(eq(job.id, jobId));
    expect(row!.archivedAt).toBe(NOW.toISOString());
  });
});
