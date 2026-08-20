/**
 * Suíte: a guarda de entrypoint de `src/cli.ts` — as três linhas que decidem
 * se importar o arquivo executa a CLI.
 *
 * ## Por que isto merece arquivo próprio
 *
 * Todo o resto da cobertura de `cli.ts` depende de um fato: importar o módulo
 * NÃO roda nada. É esse fato que permite chamar `buildProgram()` de dentro do
 * worker do Vitest e medir cobertura de verdade — com subprocesso a
 * instrumentação do V8 ficaria no pai e o arquivo marcaria 0% para sempre.
 *
 * A consequência incômoda é que o caminho oposto — o módulo COMO programa —
 * deixa de ser exercitado por qualquer teste. As três linhas de baixo são
 * exatamente o que roda quando alguém digita `pnpm jho` no terminal, e são as
 * únicas de `cli.ts` que nenhuma outra suíte alcança.
 *
 * ## Por que num arquivo separado
 *
 * A guarda só dispara se `process.argv[1]` apontar para o próprio
 * `src/cli.ts`. Isso obriga a mexer no `argv` do processo ANTES da importação,
 * e a importação é única por worker. Num arquivo que também usasse a bancada,
 * o `carregarCli()` já teria carregado o módulo com o argv do Vitest e a
 * guarda nunca mais poderia ser testada. Aqui não há bancada e não há mais
 * nada — é o preço de um `import` ser irreversível.
 *
 * ## O comando escolhido e por que ele falha de propósito
 *
 * `jobs list` contra um banco recém-migrado: não existe candidato, e
 * `activeCandidateId()` lança. Isso percorre a linha inteira — a guarda, o
 * `parseAsync`, e o `.catch` que traduz exceção em mensagem vermelha e código
 * 1. Um comando bem-sucedido deixaria o `.catch` de fora, que é justamente a
 * parte cujo defeito seria invisível: um erro engolido faz a CLI sair com 0 e
 * qualquer script encadeado com `&&` continua como se tivesse dado certo.
 *
 * Nada de `--help` nem de argumento inválido: sem `exitOverride`, o Commander
 * chama `process.exit()` de verdade, e dentro de um worker do Vitest isso
 * derruba a suíte inteira em vez do caso.
 */
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const CAMINHO_DA_CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

let argvOriginal: string[];

beforeEach(async () => {
  argvOriginal = process.argv;
  await useTestDb();
});

afterEach(() => {
  process.argv = argvOriginal;
  process.exitCode = undefined;
  releaseTestDb();
});

/** Espera o `parseAsync` do topo do módulo terminar, sem dormir por tempo. */
async function aguardarFimDoParse(): Promise<void> {
  // A importação resolve antes do parse: a última linha do módulo não é
  // aguardada por ninguém. Ceder o laço algumas vezes é o suficiente — cada
  // turno drena as microtarefas pendentes da consulta ao SQLite.
  for (let i = 0; i < 50; i++) {
    if (process.exitCode !== undefined) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("guarda de entrypoint de src/cli.ts", () => {
  it("executa a CLI quando o arquivo é o ponto de entrada, e converte exceção em código 1", async () => {
    const erros: string[] = [];
    const spyErr = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      erros.push(a.map(String).join(" "));
    });
    const spyLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      process.argv = ["node", CAMINHO_DA_CLI, "jobs", "list"];
      await import("../src/cli.ts");
      await aguardarFimDoParse();
    } finally {
      spyErr.mockRestore();
      spyLog.mockRestore();
    }

    // Código 1 é o contrato com o shell: `jho jobs list && jho report` não
    // pode seguir para o relatório depois de a listagem ter falhado.
    expect(process.exitCode).toBe(1);
    // E a mensagem é a do erro de domínio, não um stack trace — quem digitou
    // o comando precisa saber que falta rodar `jho db seed`.
    expect(erros.join("\n")).toContain("Candidato padrão não cadastrado");
  });
});
