import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ROLES } from "../src/contexts/auth/index.ts";

/**
 * O primeiro acesso precisa funcionar com o comando que está escrito.
 *
 * O papel `owner` foi renomeado para `candidate` quando os três papéis
 * entraram, e o default de `--role` ficou para trás. O efeito era o pior
 * possível: `jho auth add-user <email>` — o comando que a regra 14 manda rodar
 * e que a tela de login mostra para quem ainda não tem conta — falhava com
 * "Papel inválido: owner". Quem instalasse o sistema do zero não conseguiria
 * criar a primeira conta.
 *
 * Verificado por texto porque `cli.ts` não exporta nada: importá-lo executa a
 * CLI. É um teste de consistência entre documentação e código, e é a única
 * forma barata de impedir que os dois voltem a divergir.
 */

const cli = readFileSync("src/cli.ts", "utf8");
const claude = readFileSync("CLAUDE.md", "utf8");
const login = readFileSync("app/login/page.tsx", "utf8");

/** Papéis citados em `--role ...` em qualquer lugar do repositório. */
function papeisCitados(texto: string): string[] {
  return [...texto.matchAll(/--role\s+([a-z,]+)/g)]
    .flatMap((m) => m[1]!.split(","))
    .map((r) => r.trim())
    .filter(Boolean);
}

describe("papéis citados existem de verdade", () => {
  it("o default de --role é um papel válido", () => {
    const match = cli.match(/--role <papel>",\s*"[^"]*",\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    for (const role of match![1]!.split(",")) {
      expect(ROLES as readonly string[]).toContain(role.trim());
    }
  });

  it("a ajuda de --role lista apenas papéis existentes", () => {
    const ajuda = cli.match(/--role <papel>",\s*"([^"]*)"/)?.[1] ?? "";
    for (const citado of ajuda.split("|").map((p) => p.split("(")[0]!.trim()).filter(Boolean)) {
      expect(ROLES as readonly string[]).toContain(citado);
    }
  });

  it("CLAUDE.md e a tela de login mandam rodar um comando que funciona", () => {
    // Documentação que ensina um comando quebrado é pior que documentação
    // nenhuma: quem segue conclui que o sistema está com defeito.
    for (const [nome, texto] of [["CLAUDE.md", claude], ["/login", login]] as const) {
      const citados = papeisCitados(texto);
      expect(citados.length, `${nome} não cita --role`).toBeGreaterThan(0);
      for (const role of citados) {
        expect(ROLES as readonly string[], `${nome} cita papel inexistente`).toContain(role);
      }
    }
  });

  it("nenhum resquício de `owner` decide comportamento", () => {
    // A derivação `roles.includes("owner")` virou código morto sem avisar: toda
    // conta criada sem `--candidate` nascia sem `candidateId`, inclusive uma de
    // papel candidato — justamente a que precisa dele.
    expect(cli).not.toMatch(/includes\("owner"\)/);
    expect(cli).toMatch(/includes\("candidate"\)/);
  });
});
