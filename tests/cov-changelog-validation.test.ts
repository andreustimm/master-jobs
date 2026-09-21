/**
 * O que o changelog do usuário recusa, e como ele recusa.
 *
 * `src/core/changelog.ts` estava em 87,4% de branches, e o que faltava era a
 * metade que diz "não": data impossível, instante fora de hora, cerca de código
 * mal formada, versão repetida, e as cinco divergências entre os dois idiomas.
 *
 * Isto é gate de release: quando ele erra, a versão fecha com nota faltando num
 * idioma — foi exatamente o que aconteceu na 1.18.0, cujas entradas
 * desapareceram antes da tag. Recusa que não é testada é recusa que não
 * acontece.
 */
import { describe, expect, it } from "vitest";
import {
  ChangelogDomainError,
  bodyHasUserContent,
  changelogFile,
  changelogSections,
  compareSemanticVersions,
  formatPublication,
  hasNoUserChangeMarker,
  parsePublication,
  parseUserChangelog,
  validateLocalizedChangelogs,
} from "../src/core/changelog.ts";

/** Um changelog de usuário mínimo, com uma versão. */
function changelog(versao: string, publicacao: string, corpo = "- algo mudou"): string {
  return `# Novidades\n\n## [${versao}] - ${publicacao}\n\n### Adicionado\n\n${corpo}\n`;
}

describe("publicação: data ou instante, e nada além", () => {
  it("UT-170 data de calendário impossível é recusada", () => {
    expect(parsePublication("2026-02-30")).toBeNull();
    expect(parsePublication("2026-13-01")).toBeNull();
    // Instante com data impossível também: a validação do dia vale nos dois.
    expect(parsePublication("2026-02-30T12:00:00.000Z")).toBeNull();
  });

  it("UT-171 hora, minuto e segundo fora da faixa são recusados", () => {
    expect(parsePublication("2026-09-21T24:00:00.000Z")).toBeNull();
    expect(parsePublication("2026-09-21T12:60:00.000Z")).toBeNull();
    expect(parsePublication("2026-09-21T12:00:60.000Z")).toBeNull();
    // E o limite válido passa, que é o que distingue `<=` de `<`.
    expect(parsePublication("2026-09-21T23:59:59.999Z")).toMatchObject({ kind: "instant" });
  });

  it("UT-172 data simples e instante sem milissegundo são aceitos", () => {
    expect(parsePublication("2026-09-21")).toEqual({ kind: "date", value: "2026-09-21" });
    expect(parsePublication("2026-09-21T12:00:00Z")).toMatchObject({ kind: "instant" });
    expect(parsePublication("ontem")).toBeNull();
  });
});

describe("cercas de código e seções", () => {
  it("UT-173 cerca de backtick com backtick na info string não abre cerca", () => {
    // ```` ```js`foo ```` não é cerca válida em CommonMark, e tratá-la como
    // cerca engoliria as versões seguintes.
    const md = [
      "# Novidades",
      "",
      "```js`foo",
      "",
      "## [1.0.0] - 2026-09-21",
      "",
      "- entrada real",
    ].join("\n");

    const secoes = changelogSections(md);

    expect(secoes.some((secao) => secao.token === "1.0.0")).toBe(true);
  });

  it("UT-174 cerca de til aberta esconde o que parece versão dentro dela", () => {
    const md = [
      "# Novidades",
      "",
      "~~~",
      "## [9.9.9] - 2026-09-21",
      "~~~",
      "",
      "## [1.0.0] - 2026-09-21",
      "",
      "- entrada real",
    ].join("\n");

    const tokens = changelogSections(md).map((secao) => secao.token);

    expect(tokens).toContain("1.0.0");
    expect(tokens).not.toContain("9.9.9");
  });

  it("UT-175 terminador CRLF não vaza para o corpo da versão", () => {
    const md = "# Novidades\r\n\r\n## [1.0.0] - 2026-09-21\r\n\r\n- entrada\r\n";

    const { releases } = parseUserChangelog(md);

    const lancamento = releases.find((release) => release.version === "1.0.0");
    expect(lancamento).toBeTruthy();
    // O `\r` é do arquivo, não do conteúdo: quem exibe a nota não deve recebê-lo.
    expect(lancamento!.markdown).not.toContain("\r");
  });

  it("UT-176 marcador de 'sem nota' e corpo sem conteúdo de usuário", () => {
    expect(hasNoUserChangeMarker("<!-- sem-nota-usuario: 1.0.1 nada muda -->")).toBe(true);
    expect(hasNoUserChangeMarker("## [1.0.1] - 2026-09-21")).toBe(false);
    // Corpo em branco não tem nota; comentário HTML também não conta, porque é
    // como o "sem nota para o usuário" é escrito.
    expect(bodyHasUserContent("   \n\n\t\n")).toBe(false);
    expect(bodyHasUserContent("<!-- nada para o usuário -->\n")).toBe(false);
    expect(bodyHasUserContent("### Adicionado\n\n- algo\n")).toBe(true);
  });
});

describe("versão: comparação e diagnóstico", () => {
  it("UT-177 versão com menos de três componentes completa com zero", () => {
    // `1.2` e `1.2.0` são a mesma versão para ordenação.
    expect(compareSemanticVersions("1.2", "1.2.0")).toBe(0);
    expect(compareSemanticVersions("2", "1.9.9")).toBeLessThan(0);
    // Mais dígitos é número maior, e é o que evita `10` perder de `9`.
    expect(compareSemanticVersions("1.10.0", "1.9.0")).toBeLessThan(0);
  });

  it("UT-178 versão repetida vira problema em vez de duas entradas", () => {
    const md = [changelog("1.0.0", "2026-09-21"), changelog("1.0.0", "2026-09-22")].join("\n");

    const { issues } = parseUserChangelog(md);

    expect(issues.some((issue) => issue.version === "1.0.0")).toBe(true);
  });

  it("UT-179 corpo vazio é problema, e o diagnóstico nomeia a versão", () => {
    const { issues } = parseUserChangelog("# Novidades\n\n## [1.0.0] - 2026-09-21\n\n");

    expect(issues.some((issue) => issue.code === "empty_body" && issue.version === "1.0.0")).toBe(true);
  });

  it("UT-180 publicação ilegível não derruba as versões vizinhas", () => {
    const md = [
      "# Novidades",
      "",
      "## [1.1.0] - ontem",
      "",
      "- entrada",
      "",
      "## [1.0.0] - 2026-09-21",
      "",
      "- entrada",
    ].join("\n");

    const { releases, issues } = parseUserChangelog(md);

    // A boa continua legível: um cabeçalho torto não esconde as irmãs.
    expect(releases.map((r) => r.version)).toContain("1.0.0");
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("os dois idiomas têm de contar a mesma história", () => {
  const pt = (md: string) => parseUserChangelog(md);

  it("UT-181 versão só num idioma é divergência de versão", () => {
    const ptBR = pt(changelog("1.0.0", "2026-09-21"));
    const en = pt("# Novidades\n");

    expect(() => validateLocalizedChangelogs(ptBR, en)).toThrow(ChangelogDomainError);
    try {
      validateLocalizedChangelogs(ptBR, en);
    } catch (erro) {
      expect((erro as ChangelogDomainError).message).toMatch(/localized_version_mismatch/);
    }
  });

  it("UT-182 corpo vazio num idioma é conteúdo faltando, e nomeia o idioma", () => {
    const ptBR = pt("# Novidades\n\n## [1.0.0] - 2026-09-21\n\n");
    const en = pt(changelog("1.0.0", "2026-09-21"));

    try {
      validateLocalizedChangelogs(ptBR, en);
      throw new Error("deveria ter recusado");
    } catch (erro) {
      expect((erro as ChangelogDomainError).message).toMatch(/localized_content_missing/);
      expect((erro as ChangelogDomainError).message).toMatch(/pt-BR/);
    }
  });

  it("UT-183 visível num idioma e omitida no outro é divergência de visibilidade", () => {
    const ptBR = pt(changelog("1.0.0", "2026-09-21"));
    const en = pt("# Novidades\n\n<!-- sem-nota-usuario: 1.0.0 - 2026-09-21 -->\n");

    try {
      validateLocalizedChangelogs(ptBR, en);
      throw new Error("deveria ter recusado");
    } catch (erro) {
      expect((erro as ChangelogDomainError).message).toMatch(/localized_visibility_mismatch/);
    }
  });

  it("UT-184 mesma versão com publicação diferente é divergência de publicação", () => {
    const ptBR = pt(changelog("1.0.0", "2026-09-21"));
    const en = pt(changelog("1.0.0", "2026-09-22"));

    try {
      validateLocalizedChangelogs(ptBR, en);
      throw new Error("deveria ter recusado");
    } catch (erro) {
      expect((erro as ChangelogDomainError).message).toMatch(/localized_publication_mismatch/);
    }
  });

  it("UT-185 os dois iguais passam, e omitida nos dois também", () => {
    const iguais = changelog("1.0.0", "2026-09-21");
    expect(() => validateLocalizedChangelogs(pt(iguais), pt(iguais))).not.toThrow();

    const omitida = "# Novidades\n\n<!-- sem-nota-usuario: 1.0.0 - 2026-09-21 -->\n";
    expect(() => validateLocalizedChangelogs(pt(omitida), pt(omitida))).not.toThrow();
  });
});

describe("apoio", () => {
  it("UT-186 o arquivo do idioma, e nada fora da lista", () => {
    expect(changelogFile("pt-BR")).toMatch(/USER_CHANGELOG\.pt-BR\.md$/);
    expect(changelogFile("en")).toMatch(/USER_CHANGELOG\.en\.md$/);
    expect(changelogFile("fr")).toBeNull();
    expect(changelogFile(undefined)).toBeNull();
  });

  it("UT-187 formatar publicação respeita o tipo e o idioma", () => {
    expect(formatPublication({ kind: "date", value: "2026-09-21" }, "pt-BR")).toBeTruthy();
    expect(
      formatPublication({ kind: "instant", value: "2026-09-21T12:00:00.000Z" }, "en", "UTC"),
    ).toBeTruthy();
  });
});
