// Suite: gerador do snippet de extração assistida (src/core/sources/snippet.ts)
// Invariante: este é o limite entre o que o projeto faz e o que ele se recusa a
// fazer. Revelo e BairesDev só publicam atrás de login, e este projeto não dirige
// a sessão autenticada de ninguém — então o snippet é código que o USUÁRIO cola no
// próprio console, lendo a página que ele já está olhando. Toda decisão aqui serve
// a isso: heurística genérica em vez de seletor por site (seletor de página que
// não podemos abrir é chute apresentado como conhecimento) e nada que saia da aba.
// Fronteira DENTRO: presets, substituições e o texto de instrução.
// Fronteira FORA: a execução do snippet no navegador do usuário.
import { describe, expect, it } from "vitest";
import { buildSnippet, knownPlatforms, snippetNote } from "../src/core/sources/snippet.ts";

describe("buildSnippet", () => {
  it("permite trocar o rótulo da empresa sem trocar o padrão de link", () => {
    // O rótulo vira `company` de toda vaga extraída; sem substituição, uma
    // plataforma nova entraria no acervo inteira como "Plataforma".
    const code = buildSnippet("revelo", { label: "Revelo Internacional" });
    expect(code).toContain('"Revelo Internacional"');
    expect(code).toContain('"/positions/"');
  });

  it("nomeia a plataforma pedida no comando de importação que sugere ao usuário", () => {
    // O snippet termina dizendo exatamente qual comando rodar. Um `--source`
    // errado joga as vagas na origem de outra plataforma.
    expect(buildSnippet("bairesdev")).toContain("--source bairesdev");
  });

  it("registra as três plataformas, inclusive a genérica", () => {
    expect(knownPlatforms()).toEqual(["revelo", "bairesdev", "generic"]);
  });
});

describe("snippetNote", () => {
  it("explica o ajuste necessário quando a plataforma é desconhecida", () => {
    // Sem preset, a instrução tem de mudar de assunto: o problema deixa de ser
    // "role a lista" e passa a ser "confira o MATCH", que é o que vai falhar.
    expect(snippetNote("plataforma-desconhecida")).toContain("MATCH");
    expect(snippetNote("plataforma-desconhecida")).toBe(snippetNote("generic"));
  });

  it("dá instrução específica para cada plataforma conhecida", () => {
    expect(snippetNote("bairesdev")).toContain("oportunidades");
    expect(snippetNote("revelo")).toContain("internacionais");
  });
});
