/**
 * Suíte: os comandos de `src/cli.ts` que fazem o acervo crescer — `jobs add` e
 * `jobs import`.
 *
 * ## Por que estes dois entram no corte do E-08
 *
 * São os únicos caminhos em que uma vaga nasce por decisão de uma pessoa, e não
 * por um `sync` que roda de novo amanhã. Um `sync` errado se conserta sozinho
 * na próxima passada; uma importação que grava com a chave de fonte errada
 * espalha linhas atribuídas ao lugar errado, e a deduplicação por fingerprint
 * não desfaz isso.
 *
 * ## O recorte dentro do comando
 *
 * O que se testa aqui é a tradução de argumento: `-c` vira `companyName`,
 * `--posted` vira `postedAt`, `--label` cai para o valor de `--source` quando
 * não vem, `--dry-run` interrompe antes da escrita, `--source` ausente é erro
 * de uso. Nada disso está nas funções de domínio — `addJob` e `importJobs` já
 * têm suíte própria — e nada disso é o Commander: é o objeto literal que
 * `cli.ts` monta entre um e outro, que é onde um campo pode se perder sem que
 * nenhum teste puro perceba.
 *
 * Fronteira DENTRO: análise de argumento, defaults, ordem dos efeitos.
 * Fronteira FORA: rede. As URLs usadas não são de nenhum ATS conhecido, então
 * `addJob` nunca chega ao ramo que consulta board.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { application, job, jobScore, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

beforeAll(async () => {
  await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

/** Domínio propositalmente desconhecido: garante o caminho manual, sem rede. */
const URL_DESCONHECIDA = "https://vagas.empresa-interna.test/2026/arquiteto-de-ia";

async function arquivoTemporario(nome: string, conteudo: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jho-cli-"));
  const caminho = join(dir, nome);
  await writeFile(caminho, conteudo, "utf8");
  return caminho;
}

describe("jho jobs add <url>", () => {
  it("registra a vaga manualmente e a pontua na mesma execução", async () => {
    const candidatoId = await syncCandidateFromProfile();

    const r = await rodar(
      "jobs", "add", URL_DESCONHECIDA,
      "-t", "Senior AI Software Architect",
      "-c", "Empresa Interna",
      "-d", "Design and ship RAG pipelines with LLM orchestration and evaluation.",
    );

    expect(r.code).toBeUndefined();
    const [vaga] = await banco().select().from(job);
    expect(vaga?.title).toBe("Senior AI Software Architect");
    expect(vaga?.companyName).toBe("Empresa Interna");

    // Pontuar na hora é decisão do comando, não do domínio: sem isso a vaga
    // nova ficaria fora de qualquer `jobs list --min-fit`, que é a única tela
    // onde ela seria vista de novo.
    const notas = await banco()
      .select()
      .from(jobScore)
      .where(eq(jobScore.candidateId, candidatoId));
    expect(notas).toHaveLength(1);
    expect(r.out).toMatch(/fit \d/);
  });

  it("mapeia cada flag curta para o campo certo da vaga", async () => {
    await syncCandidateFromProfile();

    await rodar(
      "jobs", "add", URL_DESCONHECIDA,
      "-t", "Staff Engineer",
      "-c", "Acme",
      "-l", "Remote — LATAM",
      "-d", "Descrição longa o suficiente para o scorer ter o que ler.",
      "--posted", "2026-08-01",
      "-n", "veio por indicação",
    );

    const [vaga] = await banco().select().from(job);
    expect(vaga?.locationRaw).toBe("Remote — LATAM");
    expect(vaga?.postedAt).toContain("2026-08-01");
    expect(vaga?.descriptionText).toContain("scorer");
  });

  it("avisa o que a entrada manual custa em vez de fingir vaga completa", async () => {
    await syncCandidateFromProfile();

    const r = await rodar("jobs", "add", URL_DESCONHECIDA, "-t", "Arquiteto", "-c", "Acme");

    // Sem descrição o componente de keyword vale zero, e a nota sai baixa por
    // falta de texto, não por falta de aderência. Calar isso faria a pessoa ler
    // o número como julgamento da vaga.
    expect(r.out.toLowerCase()).toContain("descrição");
  });

  it("`--status` põe a vaga direto no funil", async () => {
    const candidatoId = await syncCandidateFromProfile();

    const r = await rodar(
      "jobs", "add", URL_DESCONHECIDA,
      "-t", "Arquiteto", "-c", "Acme",
      "-s", "shortlisted",
      "-n", "nota que vira detalhe da transição",
    );

    expect(r.code).toBeUndefined();
    const [linha] = await banco().select().from(application);
    expect(linha?.status).toBe("shortlisted");
    expect(linha?.candidateId).toBe(candidatoId);
  });

  /**
   * CARACTERIZAÇÃO DE ORDEM — a validação de `--status` acontece DEPOIS de
   * gravar e pontuar a vaga. Sai com código 1, mas a vaga fica no acervo.
   *
   * Não é bug: o comando faz duas coisas independentes, e a primeira deu certo.
   * Mas é uma decisão invisível em quem só lê a assinatura, e um teste que
   * assertasse "código 1 ⇒ nada mudou" estaria errado sobre este comando. O
   * caso existe para que quem reordenar o handler descubra que reordenou.
   */
  it("recusa `--status` inválido com código 1, mas a vaga já foi gravada", async () => {
    await syncCandidateFromProfile();

    const r = await rodar(
      "jobs", "add", URL_DESCONHECIDA, "-t", "Arquiteto", "-c", "Acme", "-s", "entrevistado",
    );

    expect(r.code).toBe(1);
    expect(r.err).toContain('Unknown status "entrevistado"');
    expect(await banco().select().from(job)).toHaveLength(1);
    expect(await banco().select().from(application)).toHaveLength(0);
  });

  it("é idempotente: a mesma URL duas vezes atualiza em vez de duplicar", async () => {
    await syncCandidateFromProfile();
    await rodar("jobs", "add", URL_DESCONHECIDA, "-t", "Arquiteto", "-c", "Acme");

    const r = await rodar("jobs", "add", URL_DESCONHECIDA, "-t", "Arquiteto", "-c", "Acme");

    expect(r.out).toContain("already known");
    expect(await banco().select().from(job)).toHaveLength(1);
  });

  it("exige candidato cadastrado antes de pontuar", async () => {
    const r = await rodar("jobs", "add", URL_DESCONHECIDA, "-t", "Arquiteto", "-c", "Acme");

    expect((r.erro as Error).message).toContain("jho db seed");
    // A vaga entrou; só a pontuação não aconteceu. O comando é retomável.
    expect(await banco().select().from(job)).toHaveLength(1);
  });
});

describe("jho jobs import <file>", () => {
  const PAYLOAD = JSON.stringify({
    positions: [
      {
        id: "abc",
        title: "Senior AI Software Architect",
        company: { name: "Acme" },
        location: { name: "Remote - LATAM" },
        url: "https://plataforma.test/vagas/abc",
        description: "<p>RAG, LLM orchestration, evaluation harnesses.</p>",
      },
    ],
  });

  it("`--dry-run` relata sem gravar nada — nem vaga, nem fonte", async () => {
    const caminho = await arquivoTemporario("revelo.json", PAYLOAD);

    const r = await rodar("jobs", "import", caminho, "--source", "revelo", "--dry-run");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("nada foi gravado");
    expect(await banco().select().from(job)).toHaveLength(0);
    // A fonte também não pode nascer: uma linha em `source` sem vaga nenhuma
    // apareceria em `jho sources list` como fonte muda, e não como ensaio.
    expect(await banco().select().from(source)).toHaveLength(0);
  });

  it("grava e usa `--source` como rótulo quando `--label` não vem", async () => {
    await syncCandidateFromProfile();
    const caminho = await arquivoTemporario("revelo.json", PAYLOAD);

    const r = await rodar("jobs", "import", caminho, "--source", "revelo");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("1 nova(s)");
    const [fonte] = await banco().select().from(source);
    expect(fonte?.id).toBe("manual:revelo");
    expect(fonte?.label).toBe("revelo");
    expect(fonte?.kind).toBe("manual");
  });

  it("`--label` substitui o rótulo sem mudar a chave da fonte", async () => {
    await syncCandidateFromProfile();
    const caminho = await arquivoTemporario("revelo.json", PAYLOAD);

    await rodar("jobs", "import", caminho, "--source", "revelo", "--label", "Revelo Internacional");

    const [fonte] = await banco().select().from(source);
    // A chave é o identificador estável; o rótulo é texto de tela. Trocar o
    // rótulo não pode migrar as vagas para outra fonte.
    expect(fonte?.id).toBe("manual:revelo");
    expect(fonte?.label).toBe("Revelo Internacional");
  });

  it("`--company` preenche o empregador que o payload não traz", async () => {
    await syncCandidateFromProfile();
    const semEmpresa = JSON.stringify([
      { title: "Backend Engineer", url: "https://plataforma.test/vagas/1" },
    ]);
    const caminho = await arquivoTemporario("anonimo.json", semEmpresa);

    await rodar("jobs", "import", caminho, "--source", "bairesdev", "--company", "BairesDev");

    const [vaga] = await banco().select().from(job);
    expect(vaga?.companyName).toBe("BairesDev");
  });

  it("`--base-url` monta a URL quando o payload só tem id", async () => {
    await syncCandidateFromProfile();
    const soIds = JSON.stringify({ positions: [{ id: "xyz", title: "Engineer" }] });
    const caminho = await arquivoTemporario("ids.json", soIds);

    await rodar(
      "jobs", "import", caminho,
      "--source", "revelo",
      "--company", "Acme",
      "--base-url", "https://app.careers.revelo.com/#/international/positions",
    );

    const [vaga] = await banco().select().from(job);
    expect(vaga?.url).toBe("https://app.careers.revelo.com/#/international/positions/xyz");
  });

  it("payload sem vaga nenhuma sai com código 1 e diz que campos encontrou", async () => {
    const caminho = await arquivoTemporario("vazio.json", JSON.stringify({ meta: { total: 0 } }));

    const r = await rodar("jobs", "import", caminho, "--source", "revelo");

    expect(r.code).toBe(1);
    expect(r.err).toContain("Nenhuma vaga reconhecida");
    expect(await banco().select().from(job)).toHaveLength(0);
  });

  it("`--source` é obrigatório e o Commander recusa antes de abrir o arquivo", async () => {
    const caminho = await arquivoTemporario("revelo.json", PAYLOAD);

    const r = await rodar("jobs", "import", caminho);

    // Erro de uso não passa pelo handler: nada é lido, nada é migrado, e a
    // mensagem nomeia a opção que falta em vez de estourar num `undefined`.
    expect(r.uso).toContain("--source");
    expect(await banco().select().from(source)).toHaveLength(0);
  });

  it("JSON inválido vira erro com o caminho do arquivo, não um stack cru", async () => {
    const caminho = await arquivoTemporario("quebrado.json", "{ isto não é json");

    const r = await rodar("jobs", "import", caminho, "--source", "revelo");

    expect((r.erro as Error).message).toContain(caminho);
    expect((r.erro as Error).message).toContain("não é JSON válido");
  });
});
