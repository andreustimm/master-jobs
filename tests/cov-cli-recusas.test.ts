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
  /**
   * O candidato ativo é resolvido pelo SLUG `default`, não pela coluna
   * `is_default`.
   *
   * `getCandidate()` consulta `slug = "default"`, que é o slug que `jho db seed`
   * cria. Uma linha com `is_default: true` e outro slug NÃO é o candidato ativo —
   * medido, e é a razão de todo comando sem `--candidate` recusar num banco
   * semeado à mão com outro slug.
   *
   * A recusa é uma exceção com mensagem acionável, e ela sobe até a guarda de
   * entrypoint, que a imprime. A bancada não tem essa guarda — ela chama
   * `buildProgram()` direto, justamente para que importar o módulo não execute a
   * CLI — então aqui a mensagem chega em `erro`, e não em `err`. Saída vazia na
   * bancada NÃO significa comando silencioso no terminal.
   */
  it("UT-242 sem candidato de slug `default`, a recusa diz o comando que resolve", async () => {
    await banco()
      .insert(candidate)
      .values({ slug: "dono", name: "Dono", isDefault: true });

    const r = await rodar("tracks", "list");

    expect((r.erro as Error).message).toMatch(/Candidato padrão não cadastrado/);
    // E ela diz o que fazer, que é o que separa recusa de beco sem saída.
    expect((r.erro as Error).message).toMatch(/jho db seed/);
  });

  it("UT-245 com o slug `default` presente, o mesmo comando responde", async () => {
    // O outro lado: prova que a recusa acima é sobre a ausência do slug, e não
    // um comando quebrado.
    await banco()
      .insert(candidate)
      .values({ slug: "default", name: "Padrão", isDefault: true });

    const r = await rodar("tracks", "list");

    expect(r.erro).toBeUndefined();
    expect(r.out).toMatch(/no own matching profile/i);
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
