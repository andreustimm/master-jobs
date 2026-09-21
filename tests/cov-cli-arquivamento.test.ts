/**
 * O relatório de `jho jobs archive`, que é o que o operador lê para decidir.
 *
 * `archiveClosedJobs` tem suíte própria e prova a decisão. O que não tinha caso
 * era a SAÍDA: cinco linhas condicionais, cada uma correspondendo a um estado
 * que muda o que fazer a seguir.
 *
 * - "N com candidatura preservada" conta quantas das arquivadas têm candidatura.
 *   Candidatura **nunca impede** arquivar (AC-2, ADR 0020): arquivar tira do
 *   quadro ativo e a linha de `application` continua inteira. O número existe
 *   para o operador ver que histórico foi afetado no quadro — e a regra 3 do
 *   repositório, que proíbe DELETAR, continua valendo em `db prune`, não aqui;
 * - "mantidas: N por-motivo" diz por que o resto ficou, e sem essa linha o
 *   relatório mostra um total de elegíveis sem explicar a diferença;
 * - "Nada mudou. Rode de novo com --apply" é o que separa inventário de
 *   mutação — e o dia em que essa linha aparecer DEPOIS de aplicar, alguém vai
 *   rodar `--apply` duas vezes achando que a primeira não pegou;
 * - "já tinham sido arquivadas por outra execução" é a corrida entre dois
 *   operadores, ou entre a rotina e a mão;
 * - "Há mais elegíveis além do teto" é a única indicação de que o trabalho não
 *   terminou. Sem ela, um acervo grande fica meio arquivado em silêncio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { application, candidate, company, job, source } from "../src/core/db/schema.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

beforeEach(async () => {
  await useTestDb();
  await carregarCli();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await releaseTestDb();
});

/** Uma data ISO a N dias atrás. */
function diasAtras(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/**
 * Semeia vagas fechadas, e devolve os ids na ordem em que foram pedidas.
 *
 * `closedAt` distante é o que as torna elegíveis; `checkStatus` é o motivo que
 * aparece na linha "mantidas".
 */
async function semearFechadas(
  linhas: Array<{ closedDias: number; checkStatus?: string; comCandidatura?: boolean }>,
): Promise<number[]> {
  const db = banco();
  // Fonte ONLINE de propósito: vaga de cadastro manual é preservada por
  // política, e usá-la aqui mediria `manual-source` em vez do corte por data.
  await db
    .insert(source)
    .values({ id: "lever:arquivo", kind: "lever", handle: "arquivo", label: "Arquivo" })
    .onConflictDoNothing();
  const [empresa] = await db
    .insert(company)
    .values({ slug: "arquivo-co", name: "Arquivo Co" })
    .onConflictDoNothing()
    .returning({ id: company.id });
  const empresaId = empresa?.id ?? null;

  const ids: number[] = [];
  for (const [n, linha] of linhas.entries()) {
    const [row] = await db
      .insert(job)
      .values({
        sourceId: "lever:arquivo",
        companyId: empresaId,
        companyName: "Arquivo Co",
        externalId: `arq-${n}`,
        title: `Vaga fechada ${n}`,
        url: `https://jobs.lever.co/arquivo/${n}`,
        fingerprint: `arq-fp-${n}`,
        contentHash: `arq-hash-${n}`,
        raw: {},
        closedAt: diasAtras(linha.closedDias),
        ...(linha.checkStatus ? { checkStatus: linha.checkStatus } : {}),
      })
      .returning({ id: job.id });
    ids.push(row!.id);
    if (linha.comCandidatura) {
      const [dono] = await db
        .insert(candidate)
        .values({ slug: "dono", name: "Dono", isDefault: true })
        .onConflictDoNothing()
        .returning({ id: candidate.id });
      const candidateId =
        dono?.id ??
        (await db.select({ id: candidate.id }).from(candidate).limit(1))[0]!.id;
      await db.insert(application).values({ candidateId, jobId: row!.id, status: "applied" });
    }
  }
  return ids;
}

describe("o inventário, antes de qualquer mutação", () => {
  it("UT-310 conta a preservada por candidatura e diz que nada mudou", async () => {
    // Duas fechadas há muito tempo, uma com candidatura. O relatório separa o
    // total examinado do que carrega histórico de candidatura.
    await semearFechadas([
      { closedDias: 200 },
      { closedDias: 200, comCandidatura: true },
    ]);

    const r = await rodar("jobs", "archive");

    expect(r.out).toContain("dry-run");
    expect(r.out).toMatch(/2 examinada\(s\)/);
    // As duas são elegíveis: candidatura não impede arquivar.
    expect(r.out).toMatch(/2 elegível\(is\)/);
    // E uma delas é anunciada como carregando candidatura — é o que o operador
    // precisa saber antes de aplicar, porque essa vaga sai do quadro ativo.
    expect(r.out).toMatch(/1 com candidatura preservada/);
    // E o inventário não escreve nada.
    expect(r.out).toContain("Nada mudou");
    expect(r.code).toBeUndefined();
  });

  it("UT-311 vaga fechada recentemente entra na linha de mantidas, com o motivo", async () => {
    // Fechada ontem: dentro do corte de 90 dias, logo mantida. O motivo é o que
    // explica a diferença entre examinadas e elegíveis.
    await semearFechadas([{ closedDias: 1 }, { closedDias: 200 }]);

    const r = await rodar("jobs", "archive");

    expect(r.out).toMatch(/mantidas:/);
    expect(r.out).toMatch(/1 elegível\(is\)/);
  });
});

describe("com `--apply`", () => {
  it("UT-312 arquiva, e o teto anuncia que sobrou trabalho", async () => {
    await semearFechadas([
      { closedDias: 300 },
      { closedDias: 250 },
      { closedDias: 200 },
    ]);

    // Teto de 1: examina uma, e a linha extra lida pelo comando é como ele sabe
    // que há mais — sem uma segunda contagem sobre o acervo inteiro.
    const primeira = await rodar("jobs", "archive", "--apply", "--limit", "1");

    expect(primeira.out).toMatch(/1 arquivada\(s\)/);
    expect(primeira.out).toContain("Há mais elegíveis além do teto");
    expect(primeira.out).not.toContain("Nada mudou");

    // A segunda execução continua de onde a primeira parou.
    const segunda = await rodar("jobs", "archive", "--apply", "--limit", "1");
    expect(segunda.out).toMatch(/1 arquivada\(s\)/);

    // A terceira fecha a conta e não anuncia mais trabalho.
    const terceira = await rodar("jobs", "archive", "--apply", "--limit", "10");
    expect(terceira.out).toMatch(/1 arquivada\(s\)/);
    expect(terceira.out).not.toContain("Há mais elegíveis");
  });

  it("UT-313 aplicar sobre acervo já arquivado não arquiva de novo", async () => {
    await semearFechadas([{ closedDias: 300 }]);

    await rodar("jobs", "archive", "--apply");
    const segunda = await rodar("jobs", "archive", "--apply");

    // A vaga já arquivada sai da consulta: zero examinadas, zero arquivadas, e
    // nenhuma linha de erro. Idempotência é requisito do repositório.
    expect(segunda.out).toMatch(/0 examinada\(s\)/);
    expect(segunda.out).toMatch(/0 arquivada\(s\)/);
    expect(segunda.code).toBeUndefined();
  });

  it("UT-314 arquivar tira do quadro e NÃO apaga a candidatura", async () => {
    // O teste que importa mais deste arquivo, e ele mede a garantia que existe
    // de verdade. Medido: as duas são arquivadas — `decideArchive` documenta que
    // candidatura não impede arquivar. O que não pode acontecer é a linha de
    // `application` desaparecer, porque ela é o único dado irrecuperável aqui.
    const [semCandidatura, comCandidatura] = await semearFechadas([
      { closedDias: 300 },
      { closedDias: 300, comCandidatura: true },
    ]);

    const r = await rodar("jobs", "archive", "--apply");
    expect(r.out).toMatch(/2 arquivada\(s\)/);

    const linhas = await banco()
      .select({ id: job.id, archivedAt: job.archivedAt })
      .from(job);
    const porId = new Map(linhas.map((linha) => [linha.id, linha.archivedAt]));
    expect(porId.get(semCandidatura!)).not.toBeNull();
    expect(porId.get(comCandidatura!)).not.toBeNull();

    // E a candidatura continua apontando para a vaga arquivada.
    const candidaturas = await banco()
      .select({ jobId: application.jobId, status: application.status })
      .from(application);
    expect(candidaturas).toEqual([{ jobId: comCandidatura, status: "applied" }]);
  });
});
