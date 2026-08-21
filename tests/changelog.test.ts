import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseUserChangelog, versaoAtual } from "../src/core/changelog.ts";

/**
 * O changelog que o usuário lê.
 *
 * Dois tipos de caso aqui, e vale distinguir: os primeiros exercitam o parser
 * com markdown escrito à mão no próprio teste; o último lê o arquivo REAL do
 * repositório. O parser pode estar perfeito e o arquivo, errado — e é o arquivo
 * que aparece na tela.
 */

const EXEMPLO = `# Novidades

Texto de introdução que não é versão nenhuma.

<!-- sem-nota-usuario: 1.0.1 mudança interna, nada muda para quem usa -->

## [1.1.0] - 2026-09-01

### Novidade

- A primeira coisa nova.
- A segunda coisa nova.

### Correção

- Algo que estava errado parou de estar.

## [1.0.0] - 2026-08-21

### Novidade

- O começo de tudo.
`;

describe("parseUserChangelog", () => {
  it("lê versões e datas, da mais nova para a mais antiga", () => {
    const versoes = parseUserChangelog(EXEMPLO);

    expect(versoes.map((v) => v.versao)).toEqual(["1.1.0", "1.0.0"]);
    expect(versoes[0]!.data).toBe("2026-09-01");
  });

  it("agrupa os itens sob a seção a que pertencem", () => {
    const [nova] = parseUserChangelog(EXEMPLO);

    expect(nova!.secoes.map((s) => s.titulo)).toEqual(["Novidade", "Correção"]);
    expect(nova!.secoes[0]!.itens).toHaveLength(2);
    // A seção seguinte não pode herdar os itens da anterior: seria o defeito
    // mais discreto possível, com correções listadas como novidades.
    expect(nova!.secoes[1]!.itens).toEqual(["Algo que estava errado parou de estar."]);
  });

  it("ignora os comentários de versão sem nota", () => {
    const versoes = parseUserChangelog(EXEMPLO);

    // `1.0.1` está no arquivo como registro de que a versão existiu e foi
    // considerada — que não é a mesma coisa que ter sido esquecida. Mas ela não
    // tem nada a dizer a quem usa, então não aparece.
    expect(versoes.some((v) => v.versao === "1.0.1")).toBe(false);
  });

  it("texto fora de qualquer versão não vira item", () => {
    // O parágrafo de introdução vem ANTES do primeiro cabeçalho de versão.
    // Sem a guarda, ele seria atribuído a alguma coisa.
    const total = parseUserChangelog(EXEMPLO).flatMap((v) => v.secoes).flatMap((s) => s.itens);
    expect(total.some((i) => i.includes("introdução"))).toBe(false);
  });

  it("seção declarada e vazia é descartada", () => {
    const versoes = parseUserChangelog("## [2.0.0] - 2026-10-01\n\n### Novidade\n\n### Correção\n\n- Só esta.\n");

    // Um título sozinho na tela sugere que algo não carregou.
    expect(versoes[0]!.secoes.map((s) => s.titulo)).toEqual(["Correção"]);
  });

  it("aceita `*` além de `-` como marcador", () => {
    const versoes = parseUserChangelog("## [1.0.0] - 2026-01-01\n\n### Novidade\n\n* Com asterisco.\n");
    expect(versoes[0]!.secoes[0]!.itens).toEqual(["Com asterisco."]);
  });

  it("markdown vazio devolve lista vazia, e não estoura", () => {
    // O rodapé é global: um arquivo vazio não pode derrubar toda página.
    expect(parseUserChangelog("")).toEqual([]);
    expect(parseUserChangelog("# Só um título\n")).toEqual([]);
  });

  it("item antes de qualquer seção é ignorado, não inventado", () => {
    // Tolerante com formato, mas não a ponto de criar seção que o autor não
    // escreveu — o parser não pode adivinhar se aquilo é novidade ou correção.
    const versoes = parseUserChangelog("## [1.0.0] - 2026-01-01\n\n- Solto.\n\n### Novidade\n\n- Dentro.\n");
    expect(versoes[0]!.secoes).toHaveLength(1);
    expect(versoes[0]!.secoes[0]!.itens).toEqual(["Dentro."]);
  });
});

describe("versaoAtual", () => {
  it("devolve a versão do package.json", () => {
    expect(versaoAtual({ version: "1.2.3" })).toBe("1.2.3");
  });

  it("sem versão legível, devolve 0.0.0 em vez de quebrar o rodapé", () => {
    for (const entrada of [{}, { version: "" }, { version: 42 }, { version: null }]) {
      expect(versaoAtual(entrada as { version?: unknown })).toBe("0.0.0");
    }
  });
});

describe("o arquivo real do repositório", () => {
  it("é legível pelo parser e tem ao menos uma versão", async () => {
    const bruto = await readFile("USER_CHANGELOG.md", "utf8");
    const versoes = parseUserChangelog(bruto);

    // O parser pode estar certo e o arquivo, errado — e é o arquivo que a
    // pessoa vê. Este caso é o que segura um cabeçalho digitado torto.
    expect(versoes.length).toBeGreaterThan(0);
    expect(versoes[0]!.secoes.length).toBeGreaterThan(0);
  });

  it("não vaza detalhe de implementação para a tela do usuário", async () => {
    const bruto = await readFile("USER_CHANGELOG.md", "utf8");
    const itens = parseUserChangelog(bruto)
      .flatMap((v) => v.secoes)
      .flatMap((s) => s.itens)
      .join("\n");

    // Esta tela é aberta por qualquer pessoa com acesso ao sistema. Caminho de
    // arquivo, nome de tabela e endereço de banco descrevem como o sistema é
    // montado por dentro, e não o que mudou para quem usa.
    for (const vazamento of [
      "src/",
      "app/",
      ".ts",
      "libsql://",
      "auth_user",
      "job_score",
      "TURSO_",
      "process.env",
    ]) {
      expect(itens).not.toContain(vazamento);
    }
  });

  it("a versão do topo é a mesma que o package.json declara", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    const [topo] = parseUserChangelog(await readFile("USER_CHANGELOG.md", "utf8"));

    // O rodapé mostra a versão do package.json ao lado do link para este
    // arquivo. Divergirem faria o rodapé anunciar uma versão cujas novidades
    // ninguém escreveu.
    expect(topo!.versao).toBe(pkg.version);
  });
});
