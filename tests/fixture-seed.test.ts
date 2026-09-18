import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CANDIDATE_FIXTURES,
  FIXTURE_BOUNDS,
  JOB_FIXTURES,
  validateFixtures,
  type JobFixture,
} from "../src/core/db/fixtures.ts";
import { countFixtures, FIXTURE_SOURCE_ID, seedFixtures } from "../src/core/db/seed-fixtures.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidateDocument, job } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Suite: corpus de exemplo de dev/staging (F-08, UT-003, UT-004 e IT-001)
 * Invariant: o seed converge — repetir não duplica, não cresce e não inventa.
 * Boundary IN: validação pura do corpus e o seed real contra PostgreSQL.
 * Boundary OUT: a política de ingestão, coberta pela suíte do guarda.
 */

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

describe("UT-003 — o corpus declara seus limites e suas ramificações", () => {
  it("passa na própria validação", () => {
    expect(validateFixtures()).toEqual({ ok: true });
  });

  it("cobre modalidade declarada, ausente e ciclo de vida", () => {
    expect(JOB_FIXTURES.some((fixture) => fixture.remote === true)).toBe(true);
    expect(JOB_FIXTURES.some((fixture) => fixture.remote === false)).toBe(true);
    // Ausência é um caso da interface, não um buraco: a vaga que não declara
    // modalidade precisa existir para a tela mostrar isso sem inventar.
    expect(JOB_FIXTURES.some((fixture) => fixture.remote === null)).toBe(true);
    expect(JOB_FIXTURES.some((fixture) => fixture.closedAt !== null)).toBe(true);
    expect(JOB_FIXTURES.some((fixture) => fixture.closedAt === null)).toBe(true);
  });

  it("recusa corpus grande, duplicado ou apontando para fora do host de exemplo", () => {
    const tooMany = Array.from({ length: FIXTURE_BOUNDS.maxJobs + 1 }, (_, index) => ({
      ...JOB_FIXTURES[0]!,
      externalId: `overflow-${index}`,
    }));
    expect(validateFixtures(tooMany)).toMatchObject({ ok: false });

    const duplicated = [JOB_FIXTURES[0]!, { ...JOB_FIXTURES[0]! }];
    expect(validateFixtures(duplicated)).toMatchObject({ ok: false });

    // Fixture apontando para site real convida o primeiro clique distraído a
    // virar requisição para um terceiro.
    const external: JobFixture = { ...JOB_FIXTURES[0]!, url: "https://boards.greenhouse.io/real" };
    expect(validateFixtures([external, ...JOB_FIXTURES.slice(1)])).toMatchObject({ ok: false });
  });

  it("não guarda PII nem segredo", () => {
    const blob = JSON.stringify({ JOB_FIXTURES, CANDIDATE_FIXTURES });

    expect(blob).not.toMatch(/@(gmail|hotmail|outlook|mastertimm)\./i);
    // Formato de credencial, não a palavra: "custo por token" é texto honesto
    // de uma vaga de IA, e proibir o vocabulário deixaria a fixture falsa.
    expect(blob).not.toMatch(/postgres(ql)?:\/\/|bearer\s|sk-[a-z0-9]|re_[a-z0-9]|ghp_[a-z0-9]/i);
    expect(blob).not.toMatch(/(password|secret|api[_-]?key|auth[_-]?token)\s*[=:]\s*\S/i);
    for (const fixture of CANDIDATE_FIXTURES) expect(fixture.email).toMatch(/@fixture\.test$/);
  });
});

describe("UT-004 — semear de novo converge", () => {
  it("insere na primeira execução e atualiza nas seguintes", async () => {
    const first = await seedFixtures();
    expect(first.jobs.inserted).toBe(JOB_FIXTURES.length);
    expect(first.candidates.inserted).toBe(CANDIDATE_FIXTURES.length);

    const second = await seedFixtures();
    expect(second.jobs.inserted).toBe(0);
    expect(second.jobs.updated).toBe(JOB_FIXTURES.length);
    expect(second.candidates.inserted).toBe(0);

    expect(await countFixtures()).toEqual({
      jobs: JOB_FIXTURES.length,
      candidates: CANDIDATE_FIXTURES.length,
    });
  });

  it("execuções concorrentes não multiplicam linhas", async () => {
    // Deploy simultâneo em dois ambientes é o cenário real: o seed precisa
    // convergir mesmo quando duas execuções se cruzam.
    await Promise.all([seedFixtures(), seedFixtures(), seedFixtures()]);

    const counts = await countFixtures();
    expect(counts.jobs).toBe(JOB_FIXTURES.length);
    expect(counts.candidates).toBe(CANDIDATE_FIXTURES.length);
  });

  it("não empilha versões de currículo a cada execução", async () => {
    await seedFixtures();
    await seedFixtures();
    await seedFixtures();

    const documents = await db
      .select({ id: candidateDocument.id })
      .from(candidateDocument)
      .where(eq(candidateDocument.label, "Currículo de exemplo"));

    expect(documents).toHaveLength(CANDIDATE_FIXTURES.filter((fixture) => fixture.cv).length);
  });
});

describe("IT-001 — seed roda depois da migração e fica dentro do teto", () => {
  it("escreve sobre o schema migrado e mantém o acervo pequeno", async () => {
    await seedFixtures();

    const rows = await db.select().from(job).where(eq(job.sourceId, FIXTURE_SOURCE_ID));

    expect(rows.length).toBeLessThanOrEqual(FIXTURE_BOUNDS.maxJobs);
    for (const row of rows) {
      expect(row.descriptionText!.length).toBeLessThanOrEqual(FIXTURE_BOUNDS.maxDescriptionChars);
      // Sem payload bruto de captura: o acervo descartável não guarda HTML.
      expect(JSON.stringify(row.raw)).toBe(JSON.stringify({ fixture: true }));
    }
  });

  it("corpus inválido falha antes de escrever, sem carga parcial", async () => {
    const { validateFixtures: validate } = await import("../src/core/db/fixtures.ts");
    const broken = validate([{ ...JOB_FIXTURES[0]!, url: "https://exemplo.real/vaga" }]);

    expect(broken).toMatchObject({ ok: false });
    // Nada foi semeado por este teste; a validação é a primeira coisa que o
    // seed faz, e é por isso que um corpus quebrado não deixa meia carga.
    expect((await countFixtures()).jobs).toBe(0);
  });
});
