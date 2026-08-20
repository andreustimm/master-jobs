/**
 * Bancada de teste para `src/cli.ts` — a fiação do Commander.
 *
 * ## Por que existe uma bancada, em vez de `execFile("node", ...)`
 *
 * Subprocesso seria o teste mais fiel, e é exatamente por isso que não serve
 * aqui: a cobertura V8 do Vitest instrumenta o processo do worker, não os
 * filhos que ele gera. Um teste por subprocesso deixaria `src/cli.ts` em 0%
 * para sempre — que é o estado que o item E-08 do backlog existe para mudar.
 * Então o módulo roda DENTRO do worker, e o preço disso são os problemas que
 * este arquivo resolve.
 *
 * ## O que mudou: `buildProgram()` aposentou a subclasse
 *
 * A versão anterior desta bancada dublava `commander` com uma subclasse de
 * `Command` cujo construtor fazia três coisas: chamava `exitOverride()`,
 * redirecionava a saída do Commander e guardava o primeiro `Command`
 * construído — que era o `program`. Aquilo existia por falta de porta de
 * entrada: `src/cli.ts` não exportava nada e terminava em
 * `program.parseAsync(process.argv)`, então importá-lo executava a CLI com o
 * argv do Vitest e não havia como pegar o `program` a não ser interceptando o
 * construtor.
 *
 * Hoje `src/cli.ts` exporta `buildProgram()` e só executa sob guarda de
 * entrypoint (`import.meta.url` contra `process.argv[1]`). Com isso a terceira
 * função da subclasse — recuperar o `program` — virou uma chamada, e as outras
 * duas viraram um passeio pela árvore já montada. A subclasse saiu.
 *
 * ## Por que o passeio pela árvore, e não uma chamada na raiz
 *
 * `exitOverride()` e `configureOutput()` são POR COMANDO. No Commander,
 * `_exit()` consulta o `_exitCallback` do comando que falhou, e
 * `configureOutput()` substitui `this._outputConfiguration` por um objeto novo
 * só naquele nó. Os subcomandos herdam por `copyInheritedSettings`, mas isso
 * acontece no momento da criação — e a árvore inteira já foi montada quando o
 * módulo foi importado. Configurar só a raiz deixaria `jho track 1 xpto`
 * chamando `process.exit()` de dentro do subcomando, que num worker do Vitest
 * derruba a suíte inteira em vez do caso.
 *
 * ## Por que `exitOverride` não é um remendo de teste
 *
 * É o mecanismo oficial da biblioteca para embutir uma CLI: o comportamento de
 * análise de argumento continua idêntico, só o desfecho — `process.exit` —
 * vira exceção capturável.
 *
 * ## O que a bancada NÃO dubla
 *
 * Nada. O `commander` agora é o real, o banco é o SQLite de
 * `tests/support/db.ts`, as migrações são as reais, `profile.yaml` é o de
 * verdade e as funções de domínio são as de produção.
 */
import { vi } from "vitest";
import type { Command } from "commander";
import { getDb, type DB } from "../src/core/db/client.ts";

/**
 * Estado compartilhado entre a bancada e o corpo dos testes.
 *
 * Continua sendo módulo, e não closure, porque `commanderMock()` é chamado de
 * dentro de uma fábrica que o Vitest iça para o topo do arquivo de teste.
 */
export const cli = {
  /** O `program` de `src/cli.ts`, o mesmo objeto que o terminal executa. */
  root: undefined as Command | undefined,
  /** O que o próprio Commander escreveu (ajuda, erro de uso). */
  commanderOut: [] as string[],
  commanderErr: [] as string[],
};

/**
 * Dublê vestigial de `commander`.
 *
 * Não dubla mais nada: devolve o módulo real. Continua exportado porque os
 * arquivos de teste anteriores ao `buildProgram()` trazem no topo a linha
 *
 * ```ts
 * vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());
 * ```
 *
 * e removê-lo obrigaria a editar cada um deles para nada — o efeito de um
 * `vi.mock` que devolve o módulo original é exatamente nenhum. Arquivo de teste
 * novo não precisa da linha.
 */
export async function commanderMock(): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<typeof import("commander")>("commander");
  return { ...actual };
}

/**
 * Torna um comando — e todos os seus descendentes — testável no worker.
 *
 * Recursivo por necessidade, não por elegância: ver o bloco "Por que o passeio
 * pela árvore" no topo do arquivo.
 */
function prepararArvore(comando: Command): void {
  // Sem isto, `jho track 1 inexistente` derruba o processo do worker.
  comando.exitOverride();
  // A ajuda e os erros de uso do Commander não passam por console.log; vão por
  // este canal, e o teste precisa deles para asserir validação.
  comando.configureOutput({
    writeOut: (s: string) => void cli.commanderOut.push(s),
    writeErr: (s: string) => void cli.commanderErr.push(s),
  });
  for (const filho of comando.commands) prepararArvore(filho);
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
 * Carrega `src/cli.ts` e devolve o programa montado, pronto para `rodar()`.
 *
 * O `code` devolvido é o `process.exitCode` logo depois da importação, e a
 * expectativa é que seja `undefined`: importar o módulo NÃO deve executar a
 * CLI. Vale a pena continuar medindo isso — é a garantia da guarda de
 * entrypoint, e o dia em que ela sumir esta é a primeira asserção a cair.
 */
export async function carregarCli(): Promise<{ code: number | string | undefined; err: string }> {
  if (cli.root) return { code: undefined, err: "" };

  process.exitCode = undefined;
  const { buildProgram } = await import("../src/cli.ts");
  const code = process.exitCode;
  process.exitCode = undefined;

  cli.root = buildProgram();
  prepararArvore(cli.root);
  return { code, err: "" };
}

/**
 * Roda um comando como se tivesse vindo da linha de comando.
 *
 * `from: "user"` diz ao Commander que o vetor já está sem `node` e sem o
 * caminho do script — é o mesmo caminho de análise, sem simular o argv do
 * processo.
 *
 * Reparse é suportado: `_prepareForParse`/`restoreStateBeforeParse` em
 * `commander/lib/command.js` salvam o estado das opções na primeira passada e o
 * restauram nas seguintes. Sem esse suporte a bancada teria de recarregar o
 * módulo inteiro a cada caso, e o teste ficaria dominado pelo custo de
 * `vi.resetModules()`.
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

/**
 * Substitui `process.stdin` por um fluxo com linhas fixas enquanto `fn` roda.
 *
 * Uma linha por vez, cada uma empurrada de dentro de um `setTimeout`, e a razão
 * é o modo interativo de `auth set-password`: ele faz duas perguntas seguidas
 * com `readline`, e o `readline` só entrega uma linha a quem já está
 * perguntando. Um `Readable.from("a\nb\n")` entrega as duas no mesmo pedaço —
 * a segunda cai no vazio antes da segunda pergunta existir, e o fluxo termina
 * antes dela, o que faz o comando estourar `ERR_USE_AFTER_CLOSE` em vez de
 * comparar as senhas.
 *
 * O `setTimeout` não é espera: é ordenação. A continuação da promessa da
 * primeira pergunta é microtarefa, e microtarefa roda antes de qualquer timer —
 * então a segunda pergunta já está registrada quando a segunda linha chega.
 * O `push(null)` no fim fecha o fluxo, que é o que o modo `--stdin` precisa
 * para o `for await` terminar.
 */
export async function comStdin<T>(conteudo: string, fn: () => Promise<T>): Promise<T> {
  const { Readable } = await import("node:stream");
  const linhas = conteudo.split("\n").slice(0, -1).map((linha) => `${linha}\n`);
  let proxima = 0;
  const fluxo = new Readable({
    read() {
      setTimeout(() => {
        if (proxima < linhas.length) this.push(linhas[proxima++]);
        else this.push(null);
      }, 0);
    },
  });
  const descritorOriginal = Object.getOwnPropertyDescriptor(process, "stdin")!;
  Object.defineProperty(process, "stdin", { configurable: true, value: fluxo });
  // O `readline` escreve o prompt direto em `process.stdout`, sem passar por
  // `console.log` — sem engolir isto, "Senha: Repita:" aparece no meio do
  // relatório do Vitest e vira ruído permanente na saída da suíte.
  const escreverOriginal = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = escreverOriginal;
    Object.defineProperty(process, "stdin", descritorOriginal);
  }
}
