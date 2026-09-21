/**
 * As guardas da CLI: id que não é número, e o código de saída do `security check`.
 *
 * ## Por que uma suíte inteira para a mesma recusa em dez comandos
 *
 * `idNumerico` é uma função só, e testá-la uma vez prova que ela recusa. Não
 * prova que cada comando a CHAMA — e o bug possível aqui é exatamente esse: um
 * comando que esquece a guarda e passa `Number("abc")` adiante manda `NaN` para
 * o PostgreSQL. Dez comandos aceitam id na linha de comando, e cada um tem a
 * sua chamada. A verificação por comando é a única que vê a omissão de um.
 *
 * A recusa também tem de ser LEGÍVEL: mensagem com o valor recusado, o que se
 * esperava, e código de saída 1. Recusa silenciosa com código 0 é pior que
 * aceitar, porque um script que chame `jho` não tem como saber que nada foi
 * feito.
 *
 * ## O `security check` é o único comando que decide o código de saída pelo que
 * encontrou
 *
 * Ele existe para rodar em gancho e em CI. Um achado crítico precisa sair com 1,
 * senão o gate nunca reprova — e um gate que não reprova é um relatório com
 * custo de gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carregarCli, rodar } from "./cov-cli-harness.ts";
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

/**
 * Cada comando que recebe id, com o rótulo que ele passa a `idNumerico`.
 *
 * O rótulo é parte do contrato de usabilidade: "Esperado o número de vaga" e
 * "Esperado o número de sugestão" mandam a pessoa para lugares diferentes.
 */
const COMANDOS_COM_ID: Array<{ argv: string[]; rotulo: string }> = [
  { argv: ["track", "abc", "applied"], rotulo: "vaga" },
  { argv: ["mail", "accept", "abc"], rotulo: "sugestão" },
  { argv: ["mail", "dismiss", "abc"], rotulo: "sugestão" },
  { argv: ["engage", "done", "abc"], rotulo: "engajamento" },
  { argv: ["engage", "skip", "abc"], rotulo: "engajamento" },
  { argv: ["analyze", "abc"], rotulo: "vaga" },
  { argv: ["prep", "abc"], rotulo: "vaga" },
  { argv: ["skills", "confirm", "abc"], rotulo: "skill" },
  { argv: ["skills", "reject", "abc"], rotulo: "skill" },
];

describe("id que não é número, comando por comando", () => {
  for (const { argv, rotulo } of COMANDOS_COM_ID) {
    const nome = argv.join(" ");
    it(`UT-250 \`${nome}\` recusa antes de tocar no banco, com código 1`, async () => {
      const r = await rodar(...argv);

      expect(r.err, nome).toContain("Id inválido: abc");
      // O rótulo diz QUAL número se esperava — é o que diferencia a mensagem
      // útil da genérica.
      expect(r.out, nome).toContain(rotulo);
      expect(r.code, nome).toBe(1);
      // Recusa é mensagem, nunca exceção que escapa.
      expect(r.erro, nome).toBeUndefined();
      expect(r.err, nome).not.toMatch(/at \w+ \(/);
    });
  }

  it("UT-251 zero, negativo e fracionário são recusados igual a letra", async () => {
    for (const valor of ["0", "-3", "2.5", "Infinity"]) {
      const r = await rodar("prep", valor);
      expect(r.err, valor).toContain(`Id inválido: ${valor}`);
      expect(r.code, valor).toBe(1);
    }
  });

  it("UT-252 `terms run --max abc` recusa o teto sem enfileirar nada", async () => {
    // `--max` não é id de registro, e por isso o rótulo é outro: "capturas".
    // A guarda é a mesma, e sem ela o valor viraria `NaN` no limite do laço.
    const r = await rodar("terms", "run", "--max", "abc");

    expect(r.err).toContain("Id inválido: abc");
    expect(r.out).toContain("capturas");
    expect(r.code).toBe(1);
  });

  it("UT-253 status desconhecido no `track` é recusado listando os válidos", async () => {
    // A segunda guarda do mesmo comando: id válido, status inventado. Ela lista
    // os valores aceitos, porque quem erra o status não sabe quais existem.
    const r = await rodar("track", "1", "quase-contratado");

    expect(r.err).toContain('Unknown status "quase-contratado"');
    expect(r.err).toMatch(/applied|interviewing|offer/);
    expect(r.code).toBe(1);
  });
});

describe("o código de saída do `security check`", () => {
  /** Uma raiz de projeto falsa, com os dois defeitos que valem crítico. */
  async function raizComCritico(): Promise<string> {
    const raiz = await mkdtemp(join(tmpdir(), "jho-security-"));
    // `next dev` sem `--hostname` é o defeito que a regra 12 existe para pegar.
    await writeFile(
      join(raiz, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev", start: "next start" } }),
    );
    // `.gitignore` sem `data/`, `.env` nem `out/` versiona o acervo inteiro.
    await writeFile(join(raiz, ".gitignore"), "node_modules\n");
    return raiz;
  }

  it("UT-254 achado crítico sai com 1 e imprime o conserto", async () => {
    const raiz = await raizComCritico();
    vi.spyOn(process, "cwd").mockReturnValue(raiz);

    const r = await rodar("security");

    expect(r.out).toContain("Dashboard exposto na rede");
    expect(r.out).toContain(".gitignore incompleto");
    // Cada achado com conserto imprime o conserto: relatório que aponta o
    // problema sem o caminho de saída faz a pessoa procurar duas vezes.
    expect(r.out).toContain("--hostname 127.0.0.1");
    expect(r.out).toMatch(/2 crítico\(s\)/);
    // O gate: sem isto, rodar em CI nunca reprova.
    expect(r.code).toBe(1);
  });

  it("UT-255 no próprio repositório não há crítico, e o código fica limpo", async () => {
    // O outro lado do mesmo ternário — e uma verificação de verdade sobre este
    // repositório: se alguém tirar o `--hostname` dos scripts, este caso cai.
    const r = await rodar("security");

    expect(r.out).toContain("nenhum crítico");
    expect(r.code).toBeUndefined();
  });
});
