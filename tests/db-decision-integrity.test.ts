/**
 * Suíte: decisões do usuário sobrevivem à ingestão repetida e ao descarte.
 *
 * Por que isto existe: `application.job_id` é `ON DELETE CASCADE`. A FK não
 * protege a decisão — ela a leva junto. Quem protege é o predicado do descarte
 * ("vaga fechada há muito tempo e SEM candidatura"), e um predicado avaliado
 * com a fotografia errada é tão ruim quanto nenhum.
 *
 * A corrida que motivou esta suíte: em READ COMMITTED, o `DELETE` avalia o
 * `not exists (application)` com a fotografia do início do comando. Se uma
 * candidatura é criada em outra transação nesse intervalo, o `DELETE` espera o
 * lock que a FK pôs na vaga, e quando a outra transação confirma ele segue em
 * frente — a vaga não mudou, só estava travada, então nada é reavaliado. O
 * cascade então apaga a candidatura recém-confirmada. Os testes sequenciais de
 * `db-retention` e `cov-ingest-run` não enxergam isso: só duas conexões de
 * verdade, com a ordem forçada, enxergam.
 *
 * Fronteira DENTRO: os dois caminhos de descarte (`jho db prune` e
 * `jho db cleanup --apply`) e a importação repetida, contra PostgreSQL real.
 * Fronteira FORA: rollback e disputa entre transições do funil, que
 * `repo.application.test.ts` já cobre.
 */
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { setApplicationStatus } from "../src/core/db/repo.ts";
import { deleteClosedJobsWithoutApplication, runDatabaseCleanup } from "../src/core/db/retention.ts";
import { application, applicationEvent, candidate, job, source } from "../src/core/db/schema.ts";
import { importJobs, parsePayload } from "../src/core/ingest/import.ts";
import { pruneClosed } from "../src/core/ingest/run.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let other: postgres.Sql;

beforeEach(async () => {
  db = await useTestDb();
  // Uma conexão fora do pool da aplicação: é "o outro usuário", que cria a
  // candidatura enquanto o descarte roda.
  other = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
});

afterEach(async () => {
  await other.end({ timeout: 5 });
  await releaseTestDb();
});

const OLD = "2020-01-01T00:00:00.000Z";
const NOW = new Date("2026-08-29T12:00:00.000Z");

async function seedOwner(): Promise<number> {
  const [row] = await db
    .insert(candidate)
    .values({ slug: "dono", name: "Dono", isDefault: true })
    .returning({ id: candidate.id });
  return row!.id;
}

async function seedClosedJob(suffix: string): Promise<number> {
  await db
    .insert(source)
    .values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" })
    .onConflictDoNothing();
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "lever:acme",
      companyName: "Acme",
      externalId: suffix,
      title: "Arquiteto",
      url: `https://exemplo.test/${suffix}`,
      fingerprint: `fp-${suffix}`,
      contentHash: `ch-${suffix}`,
      raw: "{}",
      closedAt: OLD,
    })
    .returning({ id: job.id });
  return row!.id;
}

/** Espera até alguma sessão deste banco estar parada num lock de linha. */
async function untilSomeoneWaitsOnALock(): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const [row] = await other<{ waiting: number }[]>`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `;
    if (row!.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("o descarte não chegou a esperar o lock da candidatura");
}

/**
 * Abre a candidatura numa transação que ainda não confirmou, dispara o
 * descarte, garante que ele está bloqueado nela, e só então confirma.
 */
async function raceDiscardAgainstApplication<T>(
  candidateId: number,
  jobId: number,
  discard: () => Promise<T>,
): Promise<T> {
  const tx = await other.reserve();
  try {
    await tx`begin`;
    await tx`
      insert into production.application (candidate_id, job_id, status, applied_at)
      values (${candidateId}, ${jobId}, 'applied', ${NOW.toISOString()})
    `;
    const discarding = discard();
    await untilSomeoneWaitsOnALock();
    await tx`commit`;
    return await discarding;
  } finally {
    tx.release();
  }
}

describe("descarte concorrente com candidatura", () => {
  it("jho db cleanup --apply não apaga a candidatura confirmada durante o descarte", async () => {
    const owner = await seedOwner();
    const jobId = await seedClosedJob("disputada");

    const result = await raceDiscardAgainstApplication(owner, jobId, () =>
      runDatabaseCleanup({ apply: true, now: NOW, closedJobDays: 90, pageHtmlDays: 0 }),
    );

    expect(result.applied?.prunedJobs).toBe(0);
    const decisions = await db.select().from(application);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ jobId, candidateId: owner, status: "applied" });
    await expect(db.select().from(job).where(eq(job.id, jobId))).resolves.toHaveLength(1);
  });

  it("jho db prune não apaga a candidatura confirmada durante o descarte", async () => {
    const owner = await seedOwner();
    const jobId = await seedClosedJob("disputada");
    const orphan = await seedClosedJob("sem-candidatura");

    const removed = await raceDiscardAgainstApplication(owner, jobId, () => pruneClosed(90));

    // A vaga sem candidatura continua elegível: a correção não pode virar
    // "não descartar nada", só "não descartar o que ganhou uma decisão".
    expect(removed).toBe(1);
    await expect(db.select().from(job).where(eq(job.id, orphan))).resolves.toHaveLength(0);
    const decisions = await db.select().from(application);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ jobId, status: "applied" });
  });

  it("quem chega depois do descarte recebe erro, nunca uma candidatura que some em silêncio", async () => {
    // A ordem inversa: o descarte já travou a vaga. A candidatura espera e, com
    // a vaga apagada, a FK recusa o insert. O usuário vê a falha e a decisão
    // não fica gravada num registro que o cascade apagaria logo depois.
    const owner = await seedOwner();
    const jobId = await seedClosedJob("apagada-antes");

    // O descarte real, com a transação segurada aberta depois de apagar: é a
    // janela em que a candidatura chega.
    let finish!: () => void;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    let deleted!: () => void;
    const afterDelete = new Promise<void>((resolve) => { deleted = resolve; });
    const discarding = db.transaction(async (tx) => {
      const removed = await deleteClosedJobsWithoutApplication(tx, NOW.toISOString());
      deleted();
      await held;
      return removed;
    });
    await afterDelete;
    const applying = setApplicationStatus(owner, jobId, "applied");
    await untilSomeoneWaitsOnALock();
    finish();
    await expect(discarding).resolves.toEqual([{ id: jobId }]);
    await expect(applying).rejects.toThrow();
    await expect(db.select().from(application)).resolves.toHaveLength(0);
    await expect(db.select().from(applicationEvent)).resolves.toHaveLength(0);
  });
});

describe("importação repetida contra decisões", () => {
  it("reimportar a mesma vaga, igual e alterada, não toca candidatura nem histórico", async () => {
    const owner = await seedOwner();
    const payload = (description: string) =>
      parsePayload([
        {
          id: "json-1",
          title: "Staff AI Engineer",
          companyName: "Import Company",
          url: "https://import.example.test/jobs/json-1",
          description,
        },
      ]);
    const options = { sourceKey: "observer-json", label: "Observer JSON" };
    const first = await importJobs(payload("Build reliable AI platforms."), options);
    const jobId = first.jobIds[0]!;
    await setApplicationStatus(owner, jobId, "applied", "enviei pelo ATS");
    await setApplicationStatus(owner, jobId, "screening", "recrutadora respondeu");
    const [before] = await db.select().from(application);
    const eventsBefore = await db.select().from(applicationEvent).orderBy(applicationEvent.id);

    await importJobs(payload("Build reliable AI platforms."), options);
    await importJobs(payload("Build reliable AI platforms and production RAG."), options);
    await importJobs(payload("Build reliable AI platforms and production RAG."), options);

    await expect(db.select().from(application)).resolves.toEqual([before]);
    await expect(
      db.select().from(applicationEvent).orderBy(applicationEvent.id),
    ).resolves.toEqual(eventsBefore);
    const [count] = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from production.job`,
    );
    expect(count!.total).toBe(1);
  });
});
