import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { application, candidate, job, source } from "../src/core/db/schema.ts";
import { recruiterCandidateSummaries } from "../src/core/db/repo.ts";
import { authorize } from "../src/contexts/auth/domain/policy.ts";
import type { Session } from "../src/contexts/auth/domain/types.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Suite: histórico escopado ao recrutador (F-07, UT-007 e IT-004)
 * Invariant: o escopo vem da sessão e entra em SQL; id da URL nunca o alarga.
 * Boundary IN: a decisão pura de política e a query real contra PostgreSQL.
 * Boundary OUT: a renderização, coberta pelo E2E.
 */

let db: DB;
let followed: number;
let stranger: number;

function recruiterSession(linked: number[]): Session {
  return {
    userId: 10,
    email: "recrutador@local.test",
    roles: ["recruiter"],
    candidateId: null,
    linkedCandidateIds: linked,
    impersonatedBy: null,
    // Validade explícita: sem ela a política trata a sessão como expirada, e o
    // teste passaria a medir isso em vez do vínculo.
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

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
      { slug: "acompanhado", name: "Ana Acompanhada" },
      { slug: "estranho", name: "Bruno Estranho" },
    ])
    .returning({ id: candidate.id, slug: candidate.slug });
  followed = people.find((p) => p.slug === "acompanhado")!.id;
  stranger = people.find((p) => p.slug === "estranho")!.id;
});

afterEach(async () => {
  await releaseTestDb();
});

async function seedApplication(candidateId: number, externalId: string, status: string) {
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
      raw: {},
    })
    .returning({ id: job.id });
  await db
    .insert(application)
    .values({ candidateId, jobId: row!.id, status: status as never });
}

describe("UT-007 — a política decide pelo vínculo da sessão", () => {
  it("permite ler quem o recrutador acompanha", () => {
    const session = recruiterSession([followed]);
    expect(() =>
      authorize(session, "candidate:read", { kind: "candidate", candidateId: followed }),
    ).not.toThrow();
  });

  it("nega candidato que a sessão não acompanha", () => {
    const session = recruiterSession([followed]);
    expect(() =>
      authorize(session, "candidate:read", { kind: "candidate", candidateId: stranger }),
    ).toThrow();
  });

  it("um id vindo do pedido não vira vínculo", () => {
    // O recurso é construído a partir da URL; o VÍNCULO continua vindo da
    // sessão. Sem esta separação, bastaria trocar o número no endereço.
    const session = recruiterSession([]);
    expect(() =>
      authorize(session, "candidate:read", { kind: "candidate", candidateId: followed }),
    ).toThrow();
  });

  it("recrutador não escreve no funil de ninguém", () => {
    const session = recruiterSession([followed]);
    for (const action of ["application:write", "candidate:write"] as const) {
      expect(() =>
        authorize(session, action, { kind: "candidate", candidateId: followed }),
      ).toThrow();
    }
  });
});

describe("IT-004 — a leitura escopada não alcança quem está fora", () => {
  it("resume só os candidatos do escopo", async () => {
    await seedApplication(followed, "a", "applied");
    await seedApplication(followed, "b", "interviewing");
    await seedApplication(stranger, "c", "applied");

    const summaries = await recruiterCandidateSummaries([followed]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.candidateId).toBe(followed);
    expect(summaries[0]!.counts).toEqual({ applied: 1, interviewing: 1 });
    expect(summaries[0]!.total).toBe(2);
  });

  it("escopo vazio não consulta e não devolve nada", async () => {
    await seedApplication(followed, "a", "applied");
    expect(await recruiterCandidateSummaries([])).toEqual([]);
  });

  it("candidato sem candidatura aparece com zero, não some", async () => {
    // Sumir seria indistinguível de "o vínculo não existe", e o recrutador
    // precisa saber que acompanha alguém que ainda não se candidatou.
    const summaries = await recruiterCandidateSummaries([followed]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.total).toBe(0);
  });

  it("id inexistente no escopo não inventa linha", async () => {
    const summaries = await recruiterCandidateSummaries([followed, 999_999]);
    expect(summaries.map((s) => s.candidateId)).toEqual([followed]);
  });

  it("ordena por nome, para a lista não mudar de ordem a cada leitura", async () => {
    const summaries = await recruiterCandidateSummaries([stranger, followed]);
    expect(summaries.map((s) => s.name)).toEqual(["Ana Acompanhada", "Bruno Estranho"]);
  });
});
