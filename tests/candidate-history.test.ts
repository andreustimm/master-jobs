import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { application, candidate, job, source } from "../src/core/db/schema.ts";
import { PIPELINE_PAGE_SIZE, pipelineCounts, pipelineRows } from "../src/core/db/repo.ts";
import { jobLifecycleState } from "../src/core/ingest/lifecycle.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Suite: histórico de candidaturas do candidato (F-07, UT-006 e IT-003)
 * Invariant: o escopo é do candidato da sessão, e vaga encerrada não some.
 * Boundary IN: a query real contra PostgreSQL e o rótulo puro de estado.
 * Boundary OUT: a renderização, coberta pelo E2E.
 */

let db: DB;
let mine: number;
let other: number;

beforeEach(async () => {
  db = await useTestDb();
  await db.insert(source).values({
    id: "web:test",
    kind: "greenhouse",
    handle: "test",
    label: "Fonte de teste",
  });
  const people = await db
    .insert(candidate)
    .values([
      { slug: "eu", name: "Candidato" },
      { slug: "outro", name: "Outra pessoa" },
    ])
    .returning({ id: candidate.id, slug: candidate.slug });
  mine = people.find((p) => p.slug === "eu")!.id;
  other = people.find((p) => p.slug === "outro")!.id;
});

afterEach(async () => {
  await releaseTestDb();
});

type JobSeed = { closedAt?: string | null; archivedAt?: string | null };

async function seedApplication(
  candidateId: number,
  externalId: string,
  status: string,
  seed: JobSeed = {},
): Promise<number> {
  const [row] = await db
    .insert(job)
    .values({
      fingerprint: `fp:${externalId}`,
      contentHash: `hash:${externalId}`,
      sourceId: "web:test",
      externalId,
      companyName: "Acme",
      title: `Vaga ${externalId}`,
      url: `https://example.test/${externalId}`,
      closedAt: seed.closedAt ?? null,
      archivedAt: seed.archivedAt ?? null,
      raw: {},
    })
    .returning({ id: job.id });
  await db.insert(application).values({
    candidateId,
    jobId: row!.id,
    status: status as never,
  });
  return row!.id;
}

describe("UT-006 — o rótulo de estado da vaga é puro e específico", () => {
  it("arquivada vence fechada, e vaga viva não ganha rótulo", () => {
    expect(jobLifecycleState({ closedAt: null, archivedAt: null })).toBe("active");
    expect(jobLifecycleState({ closedAt: "2026-01-01", archivedAt: null })).toBe("closed");
    expect(jobLifecycleState({ closedAt: "2026-01-01", archivedAt: "2026-06-01" })).toBe("archived");
    // Arquivada sem fechamento não deveria existir, mas se existir o rótulo
    // mais específico continua valendo em vez de mentir "ativa".
    expect(jobLifecycleState({ closedAt: null, archivedAt: "2026-06-01" })).toBe("archived");
  });
});

describe("UT-006 — o escopo é do candidato, não do pedido", () => {
  it("não devolve candidatura de outra pessoa", async () => {
    await seedApplication(mine, "minha", "applied");
    await seedApplication(other, "dela", "applied");

    const rows = await pipelineRows(mine);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Vaga minha");
  });

  it("filtro por estágio não alarga o escopo", async () => {
    await seedApplication(mine, "minha", "applied");
    await seedApplication(other, "dela", "applied");

    const rows = await pipelineRows(mine, { status: "applied" });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Vaga minha");
  });

  it("contagem por estágio também é escopada", async () => {
    await seedApplication(mine, "minha", "applied");
    await seedApplication(other, "dela1", "applied");
    await seedApplication(other, "dela2", "applied");

    expect(await pipelineCounts(mine)).toEqual({ applied: 1 });
  });
});

describe("IT-003 — a leitura do histórico", () => {
  it("mantém visível a candidatura cuja vaga fechou ou foi arquivada", async () => {
    await seedApplication(mine, "fechada", "applied", { closedAt: "2026-01-01T00:00:00.000Z" });
    await seedApplication(mine, "arquivada", "interviewing", {
      closedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: "2026-06-01T00:00:00.000Z",
    });

    const rows = await pipelineRows(mine);

    expect(rows).toHaveLength(2);
    const states = rows.map((row) =>
      jobLifecycleState({ closedAt: row.jobClosedAt, archivedAt: row.jobArchivedAt }),
    );
    expect(states.sort()).toEqual(["archived", "closed"]);
    // O estágio da candidatura não foi tocado pelo estado da vaga.
    expect(rows.map((row) => row.status).sort()).toEqual(["applied", "interviewing"]);
  });

  it("filtra por estágio sem mudar o total do funil", async () => {
    await seedApplication(mine, "a", "applied");
    await seedApplication(mine, "b", "applied");
    await seedApplication(mine, "c", "interviewing");

    const counts = await pipelineCounts(mine);
    const filtered = await pipelineRows(mine, { status: "interviewing" });

    expect(filtered).toHaveLength(1);
    expect(counts).toEqual({ applied: 2, interviewing: 1 });
  });

  it("pagina com ordem estável e sem repetir linha entre páginas", async () => {
    for (const n of [1, 2, 3, 4, 5]) await seedApplication(mine, `vaga-${n}`, "applied");

    const first = await pipelineRows(mine, { limit: 2, offset: 0 });
    const second = await pipelineRows(mine, { limit: 2, offset: 2 });
    const third = await pipelineRows(mine, { limit: 2, offset: 4 });

    const ids = [...first, ...second, ...third].map((row) => row.jobId);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    // Reler a primeira página devolve exatamente a mesma página.
    expect((await pipelineRows(mine, { limit: 2, offset: 0 })).map((r) => r.jobId)).toEqual(
      first.map((r) => r.jobId),
    );
  });

  it("não devolve mais que o teto de página por omissão", async () => {
    expect(PIPELINE_PAGE_SIZE).toBeGreaterThan(0);
    for (const n of Array.from({ length: PIPELINE_PAGE_SIZE + 3 }, (_, i) => i)) {
      await seedApplication(mine, `vaga-${n}`, "applied");
    }

    expect(await pipelineRows(mine)).toHaveLength(PIPELINE_PAGE_SIZE);
  });

  it("histórico vazio é lista vazia, não erro", async () => {
    expect(await pipelineRows(mine)).toEqual([]);
    expect(await pipelineCounts(mine)).toEqual({});
  });
});
