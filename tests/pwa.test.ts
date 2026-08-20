import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A PWA, e sobretudo o que ela NÃO guarda.
 *
 * O desenho é o do `contas_casal` — caches versionados por tipo, estratégia por
 * tipo, limpeza das versões antigas no `activate` — com uma diferença
 * deliberada: lá, página autenticada é cacheada porque existe uma fronteira de
 * sessão offline que apaga tudo na troca de identidade; aqui essa máquina não
 * existe, e copiar o cache sem copiá-la seria copiar o risco sem a mitigação.
 *
 * Estes testes existem porque a política vive num arquivo que nenhum
 * `tsc` verifica: `public/sw.js` é servido como está.
 */

/**
 * O TEMPLATE, e não o arquivo gerado.
 *
 * `public/sw.js` é derivado e não está no git — num checkout limpo, antes do
 * primeiro build, ele não existe. Um teste que o lesse falharia por ausência de
 * artefato, que não é o que se quer afirmar.
 */
const sw = readFileSync("scripts/sw-template.js", "utf8");
const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));

describe("o que o service worker nunca guarda", () => {
  it("não existe cache de página nem de API", () => {
    // A ausência É a política. Um `pages-` aqui gravaria currículo e funil em
    // disco, e o disco sobrevive ao logout.
    expect(sw).not.toMatch(/const PAGES_CACHE/);
    expect(sw).not.toMatch(/const API_CACHE/);
  });

  it("as rotas privadas estão na lista de exclusão", () => {
    // Lista explícita ALÉM do padrão de negar: o padrão protege o que ninguém
    // previu, a lista documenta o que já se sabe ser sensível.
    for (const rota of ["/api/", "/admin/", "/candidate", "/pipeline", "/referrals", "/compare"]) {
      expect(sw).toContain(`"${rota}"`);
    }
  });

  it("o perfil público também não é guardado", () => {
    // Público por ESCOLHA do candidato, e a escolha pode ser revogada. Uma
    // cópia em disco não obedeceria à revogação.
    expect(sw).toContain('"/p/"');
  });

  it("só responde a GET", () => {
    // Uma mutação servida do cache seria uma escrita que não aconteceu sendo
    // reportada como se tivesse acontecido.
    expect(sw).toMatch(/request\.method !== "GET"/);
  });

  it("não guarda resposta que redirecionou para o login", () => {
    // Perder a sessão enquanto o shell é aquecido guardaria a tela de login sob
    // a URL de outra rota, e a próxima visita offline mostraria "entre".
    expect(sw).toMatch(/isRedirectToLogin/);
    expect(sw).toMatch(/pathname\.startsWith\("\/login"\)/);
  });

  it("ignora outra origem", () => {
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/);
  });
});

describe("versão e limpeza", () => {
  it("o template guarda o placeholder, e o gerado guarda a versão", () => {
    // O template está no git; `public/sw.js` é derivado e ignorado. Gerar em
    // vez de editar no lugar remove o estado intermediário: não existe momento
    // em que o arquivo servido tenha o placeholder literal, que faria todos os
    // caches se chamarem `static-__APP_VERSION__` e nenhum deploy invalidar
    // coisa alguma.
    expect(sw).toContain('CACHE_VERSION = "__APP_VERSION__"');

    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    expect(existsSync("public/sw.js")).toBe(true);
    expect(readFileSync("public/sw.js", "utf8")).toContain(`CACHE_VERSION = "${version}"`);
  });

  it("os nomes de cache derivam da versão", () => {
    // Sem isso, um chunk de JavaScript da versão anterior seria servido para
    // sempre — o `activate` não teria como saber qual cache é velho.
    expect(sw).toMatch(/static-\$\{CACHE_VERSION\}/);
    expect(sw).toMatch(/shell-\$\{CACHE_VERSION\}/);
  });

  it("apaga no activate o que não é da versão corrente", () => {
    expect(sw).toMatch(/CURRENT_CACHES\.has\(key\)/);
    expect(sw).toMatch(/caches\.delete\(key\)/);
  });

  it("o logout esvazia o privado e preserva o estático", () => {
    // O estático é público e é o que permite o shell abrir na próxima vez.
    expect(sw).toContain("clear-private-caches");
    expect(sw).toMatch(/key !== STATIC_CACHE/);
  });
});

describe("manifest", () => {
  it("instala em tela cheia com escopo na raiz", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/");
  });

  it("tem ícone maskable além do comum", () => {
    // Sem `maskable`, o Android recorta o ícone num círculo e come o glifo.
    const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
    expect(purposes).toContain("maskable");
    expect(purposes).toContain("any");
  });

  it("declara os dois tamanhos que a instalação exige", () => {
    const sizes = new Set(manifest.icons.map((i: { sizes: string }) => i.sizes));
    expect(sizes.has("192x192")).toBe(true);
    expect(sizes.has("512x512")).toBe(true);
  });
});
