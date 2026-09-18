/**
 * Suíte: a jornada do operador em `jho jobs archive` (F-07, E2E-003).
 *
 * O que se confere aqui é o que pertence à CLI: que sem `--apply` nada muda,
 * que o relatório impresso é o número real, e que repetir o comando não
 * arquiva de novo. A regra de elegibilidade tem suíte própria em
 * `job-lifecycle` e `job-archive`; nada dela é reencenado aqui.
 *
 * Fronteira DENTRO: flags, ordem dos efeitos, texto agregado, persistência.
 * Fronteira FORA: rede — arquivar não abre socket nenhum, por construção.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { job, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar, semCor } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

const LONG_AGO = "2026-01-01T00:00:00.000Z";

beforeAll(async () => {
  await carregarCli();
});

afterAll(async () => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

async function semearFechada(externalId: string): Promise<number> {
  const db = banco();
  await db
    .insert(source)
    .values({ id: "web:teste", kind: "greenhouse", handle: "teste", label: "Teste" })
    .onConflictDoNothing();
  const [linha] = await db
    .insert(job)
    .values({
      fingerprint: `fp:${externalId}`,
      contentHash: `hash:${externalId}`,
      sourceId: "web:teste",
      externalId,
      companyName: "Acme",
      title: `Vaga ${externalId}`,
      url: `https://example.test/${externalId}`,
      closedAt: LONG_AGO,
      raw: {},
    })
    .returning({ id: job.id });
  return linha!.id;
}

describe("jobs archive", () => {
  it("E2E-003 sem --apply relata o que faria e não muda linha nenhuma", async () => {
    const id = await semearFechada("velha");

    const execucao = await rodar("jobs", "archive", "--closed-days", "90");

    const saida = semCor(execucao.out);
    expect(saida).toContain("dry-run");
    expect(saida).toContain("1 elegível(is)");
    expect(saida).toContain("Rode de novo com --apply");

    const [linha] = await banco()
      .select({ archivedAt: job.archivedAt })
      .from(job)
      .where(eq(job.id, id));
    expect(linha!.archivedAt).toBeNull();
  });

  it("E2E-003 com --apply arquiva, e repetir não arquiva de novo", async () => {
    const id = await semearFechada("velha");

    const primeira = semCor((await rodar("jobs", "archive", "--apply")).out);
    expect(primeira).toContain("1 arquivada(s)");

    const [depois] = await banco()
      .select({ archivedAt: job.archivedAt })
      .from(job)
      .where(eq(job.id, id));
    expect(depois!.archivedAt).not.toBeNull();

    const segunda = semCor((await rodar("jobs", "archive", "--apply")).out);
    expect(segunda).toContain("0 elegível(is)");
    expect(segunda).toContain("0 arquivada(s)");

    const [final] = await banco()
      .select({ archivedAt: job.archivedAt })
      .from(job)
      .where(eq(job.id, id));
    // O carimbo é o da primeira execução: a segunda não reescreveu a data.
    expect(final!.archivedAt).toBe(depois!.archivedAt);
  });

  it("E2E-003 corte inválido é recusado sem tocar no acervo", async () => {
    const id = await semearFechada("velha");

    const execucao = await rodar("jobs", "archive", "--closed-days", "-5", "--apply");

    // Mesmo caminho de erro dos demais comandos: mensagem legível que sobe até
    // o entrypoint, sem meia escrita no banco antes.
    expect((execucao.erro as Error).message).toMatch(/inteiro maior ou igual a zero/);
    expect(execucao.out).toBe("");
    const [linha] = await banco()
      .select({ archivedAt: job.archivedAt })
      .from(job)
      .where(eq(job.id, id));
    expect(linha!.archivedAt).toBeNull();
  });
});
