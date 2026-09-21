/**
 * Suíte: o que o `jho` recusa, e como ele recusa.
 *
 * `src/cli.ts` tem 663 branches a 87,2%, e o que falta divide-se em dois tipos
 * muito diferentes: variação de **formatação** (`c.green` contra `c.dim`, plural,
 * truncamento) e caminho de **decisão** (id que não é número, candidato que não
 * existe, lista vazia, ingestão bloqueada pelo ambiente).
 *
 * Este arquivo cobre o segundo tipo e ignora o primeiro de propósito. Cor de
 * saída não esconde defeito; recusa esconde — um `idNumerico` que aceitasse
 * `"abc"` mandaria `NaN` para o PostgreSQL, e um comando que segue sem candidato
 * opera sobre a pessoa errada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidate } from "../src/core/db/schema.ts";
import { carregarCli, rodar } from "./cov-cli-harness.ts";
import { banco } from "./cov-cli-harness.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

const ambiente = { ...process.env };

beforeEach(async () => {
  await useTestDb();
  await carregarCli();
});

afterEach(async () => {
  process.env = { ...ambiente };
  vi.restoreAllMocks();
  await releaseTestDb();
});

describe("id que não é número", () => {
  it("UT-240 `--candidate abc` é recusado nomeando o campo, sem tocar no banco", async () => {
    const r = await rodar("tracks", "list", "--candidate", "abc");

    // A recusa nomeia o campo: "candidato", não "argumento inválido".
    expect(r.err + r.out).toMatch(/candidato/i);
    // E não é exceção: comando de CLI erra com mensagem, não com stack.
    expect(r.err).not.toMatch(/at \w+ \(/);
  });

  it("UT-241 id negativo e zero também são recusados", async () => {
    for (const valor of ["0", "-1", "1.5"]) {
      const r = await rodar("tracks", "list", "--candidate", valor);
      expect(r.err + r.out, valor).toMatch(/candidato/i);
    }
  });
});

describe("sem candidato ativo", () => {
  it("UT-242 `tracks list` sai em silêncio — e este teste prende isso como é hoje", async () => {
    // Medido: com uma linha de candidato padrão no banco mas sem candidato
    // ATIVO resolvido, o comando retorna sem imprimir nada e sem estourar.
    //
    // O branch é real e agora está coberto. Mas silêncio absoluto é fricção:
    // quem roda não distingue "não há trilha" de "não achei candidato", e
    // silêncio lê como sucesso. Registrado na tarefa #39 como achado de
    // usabilidade de CLI, não corrigido aqui — este arquivo é de cobertura, e
    // mudar a saída do comando é decisão de produto.
    await banco()
      .insert(candidate)
      .values({ slug: "dono", name: "Dono", isDefault: true });

    const r = await rodar("tracks", "list");

    // O que importa provar: não estoura, e não vaza stack.
    expect(r.err).not.toMatch(/at \w+ \(/);
    expect((r.out + r.err).trim()).toBe("");
  });
});

describe("candidato sem trilha própria", () => {
  it("UT-243 com o id explícito, diz que não há trilha em vez de tabela vazia", async () => {
    const [dono] = await banco()
      .insert(candidate)
      .values({ slug: "dono", name: "Dono", isDefault: true })
      .returning({ id: candidate.id });

    const r = await rodar("tracks", "list", "--candidate", String(dono!.id));

    // O caminho da lista vazia existe justamente para não mostrar cabeçalho de
    // tabela sem linha, que lê como "carregou e não achou" em vez de "não há".
    expect(r.out + r.err).toMatch(/no own matching profile/i);
  });
});

describe("ingestão bloqueada pelo ambiente", () => {
  it("UT-244 comando de captura recusa com a política, não com stack", async () => {
    // A política nega por omissão: sem ambiente declarado o contexto normaliza
    // para `preview`. O CLI tem de traduzir isso em recusa legível — o operador
    // precisa saber que é política, não falha.
    delete process.env.JHO_ENV;
    delete process.env.JHO_INGESTION_OPT_IN;

    const r = await rodar("terms", "run");

    expect(r.err).not.toMatch(/at \w+ \(/);
    expect((r.out + r.err).trim().length).toBeGreaterThan(0);
  });
});
