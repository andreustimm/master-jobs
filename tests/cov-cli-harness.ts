/**
 * Bancada de teste para `src/cli.ts` — a fiação do Commander.
 *
 * ## Por que existe uma bancada, em vez de `execFile("node", ...)`
 *
 * Subprocesso seria o teste mais fiel, e é exatamente por isso que não serve
 * aqui: a cobertura V8 do Vitest instrumenta o processo do worker, não os
 * filhos que ele gera. Um teste por subprocesso deixaria `src/cli.ts` em 0%
 * para sempre — que é o estado que o item E-08 do backlog existe para mudar.
 * Então o módulo roda DENTRO do worker, e o preço disso são os dois problemas
 * que este arquivo resolve.
 *
 * ## Problema 1: o módulo é o programa
 *
 * `src/cli.ts` não exporta nada. A última linha é
 * `program.parseAsync(process.argv)`, ou seja, importar o arquivo **executa**
 * a CLI com os argumentos do processo — que, num worker do Vitest, são os
 * argumentos do Vitest. Sem um `process.argv` controlado, a primeira coisa que
 * o teste faria seria pedir ao Commander para interpretar `--run --coverage`.
 *
 * A saída é capturar o objeto `program` no construtor e, dali em diante,
 * chamar `parseAsync` nós mesmos. O Commander 15 suporta reparse: veja
 * `_prepareForParse`/`restoreStateBeforeParse` em `commander/lib/command.js`,
 * que salvam o estado das opções na primeira passada e o restauram nas
 * seguintes. Sem esse suporte a bancada teria de recarregar o módulo inteiro a
 * cada caso, e o teste ficaria dominado pelo custo de `vi.resetModules()`.
 *
 * ## Problema 2: erro de uso mata o worker
 *
 * Diante de argumento inválido, o Commander chama `process.exit()`. Num worker
 * do Vitest isso derruba a suíte inteira, não o caso. `exitOverride()` troca a
 * saída por uma exceção — é o mecanismo oficial da biblioteca para embutir uma
 * CLI, e não é um remendo de teste: o comportamento de análise de argumento
 * continua o mesmo, só o desfecho vira capturável.
 *
 * ## O que a bancada NÃO dubla
 *
 * Nada do produto. O banco é o SQLite real de `tests/support/db.ts`, as
 * migrações são as reais, `profile.yaml` é o de verdade e as funções de
 * domínio são as de produção. A única coisa trocada é `commander`, e por uma
 * subclasse que herda o comportamento inteiro — o `Command` real continua
 * fazendo a análise.
 */
import { vi } from "vitest";
import { getDb, type DB } from "../src/core/db/client.ts";

type AnyCommand = {
  parseAsync(argv: readonly string[], options?: { from?: string }): Promise<unknown>;
};

/**
 * Estado compartilhado entre a fábrica do mock (que o Vitest iça para o topo do
 * arquivo de teste) e o corpo do teste. Precisa ser módulo, e não closure,
 * justamente por causa desse içamento.
 */
export const cli = {
  /** O `program` de `src/cli.ts`: o primeiro `Command` construído no módulo. */
  root: undefined as AnyCommand | undefined,
  /** A promessa do parse disparado no topo do módulo, na importação. */
  boot: undefined as Promise<unknown> | undefined,
  /** O que o próprio Commander escreveu (ajuda, erro de uso). */
  commanderOut: [] as string[],
  commanderErr: [] as string[],
};

/**
 * Fábrica do mock de `commander`.
 *
 * Uso, no topo de cada arquivo de teste (o `vi.mock` é içado, então a
 * importação dinâmica aqui dentro é obrigatória):
 *
 * ```ts
 * vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());
 * ```
 */
export async function commanderMock(): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<typeof import("commander")>("commander");

  class TestCommand extends actual.Command {
    constructor(name?: string) {
      super(name);
      // Sem isto, `jho track 1 inexistente` derruba o processo do worker.
      this.exitOverride();
      // A ajuda e os erros de uso do Commander não passam por console.log;
      // vão por este canal, e o teste precisa deles para asserir validação.
      this.configureOutput({
        writeOut: (s: string) => void cli.commanderOut.push(s),
        writeErr: (s: string) => void cli.commanderErr.push(s),
      });
      // O primeiro Command construído é o `program`. Todo o resto nasce de
      // `.command()`, que passa por `createCommand` abaixo.
      cli.root ??= this as unknown as AnyCommand;
    }

    /** Faz os subcomandos herdarem `exitOverride` e a captura de saída. */
    override createCommand(name?: string): actual.Command {
      return new TestCommand(name);
    }

    override parseAsync(
      argv?: readonly string[],
      options?: Parameters<actual.Command["parseAsync"]>[1],
    ): Promise<actual.Command> {
      const promise = super.parseAsync(argv, options);
      // Só a primeira: é a do topo do módulo, e o teste precisa esperá-la
      // antes de disparar a próxima para não sobrepor dois parses.
      if ((this as unknown as AnyCommand) === cli.root) cli.boot ??= promise;
      return promise;
    }
  }

  return { ...actual, Command: TestCommand };
}

const ANSI = /\x1b\[[0-9;]*m/g;

export function semCor(text: string): string {
  return text.replace(ANSI, "");
}

export type Execucao = {
  /** `process.exitCode` ao fim do comando. `undefined` significa sucesso. */
  code: number | string | undefined;
  /** Tudo que o comando escreveu por `console.log`, sem ANSI. */
  out: string;
  /** Tudo que o comando escreveu por `console.error`, sem ANSI. */
  err: string;
  /** O que o Commander escreveu por conta própria (uso inválido, ajuda). */
  uso: string;
  /** A exceção que escapou do parse, quando escapou. */
  erro: unknown;
};

/**
 * Carrega `src/cli.ts` uma única vez, com `process.argv` sob controle.
 *
 * O argv de carga é `["node", "jho"]` de propósito: `jho` sem subcomando faz o
 * Commander imprimir a ajuda e sair com código 1, o que exercita — de graça e
 * uma vez só — o `catch` do topo do módulo, o único trecho que nenhum reparse
 * alcança, porque a partir daí é o teste, e não `src/cli.ts`, quem chama
 * `parseAsync`.
 */
export async function carregarCli(): Promise<{ code: number | string | undefined; err: string }> {
  if (cli.root) return { code: undefined, err: "" };

  const argvOriginal = process.argv;
  const errs: string[] = [];
  const spyLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const spyErr = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errs.push(a.map(String).join(" "));
  });
  process.exitCode = undefined;
  try {
    process.argv = ["node", "jho"];
    await import("../src/cli.ts");
    // A importação resolve antes do parse terminar: a última linha do módulo
    // não é aguardada. Esperar a promessa capturada é o que torna o `catch`
    // do topo observável em vez de uma corrida.
    await cli.boot?.catch(() => undefined);
    // Um turno a mais para o `.catch` de `src/cli.ts` gravar o exitCode.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.argv = argvOriginal;
    spyLog.mockRestore();
    spyErr.mockRestore();
  }
  const code = process.exitCode;
  process.exitCode = undefined;
  return { code, err: semCor(errs.join("\n")) };
}

/**
 * Roda um comando como se tivesse vindo da linha de comando.
 *
 * `from: "user"` diz ao Commander que o vetor já está sem `node` e sem o
 * caminho do script — é o mesmo caminho de análise, sem simular o argv do
 * processo.
 */
export async function rodar(...args: string[]): Promise<Execucao> {
  if (!cli.root) throw new Error("carregarCli() antes de rodar()");
  const logs: string[] = [];
  const errs: string[] = [];
  cli.commanderOut.length = 0;
  cli.commanderErr.length = 0;
  const spyLog = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  const spyErr = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errs.push(a.map(String).join(" "));
  });
  process.exitCode = undefined;
  let erro: unknown;
  try {
    await cli.root.parseAsync(args, { from: "user" });
  } catch (e) {
    erro = e;
  } finally {
    spyLog.mockRestore();
    spyErr.mockRestore();
  }
  const code = process.exitCode;
  process.exitCode = undefined;
  return {
    code,
    out: semCor(logs.join("\n")),
    err: semCor(errs.join("\n")),
    uso: semCor(cli.commanderOut.join("") + cli.commanderErr.join("")),
    erro,
  };
}

/**
 * Conexão nova com o banco de teste.
 *
 * Necessário porque `withDb()` fecha o cliente no `finally` de todo comando: a
 * referência devolvida por `useTestDb()` fica inservível depois do primeiro
 * `rodar()`. O arquivo é o mesmo, então o `getDb()` seguinte reabre sobre os
 * dados que o comando gravou.
 */
export function banco(): DB {
  return getDb();
}

/** Substitui `process.stdin` por um conteúdo fixo enquanto `fn` roda. */
export async function comStdin<T>(conteudo: string, fn: () => Promise<T>): Promise<T> {
  const { Readable } = await import("node:stream");
  const descritorOriginal = Object.getOwnPropertyDescriptor(process, "stdin")!;
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: Readable.from([Buffer.from(conteudo, "utf8")]),
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "stdin", descritorOriginal);
  }
}
