/**
 * A mensagem de erro e a linha de diagnóstico do changelog, campo por campo.
 *
 * As duas são texto que sai num log de CI e nada mais — e é justamente por isso
 * que erram em silêncio. Quem lê `localized_content_missing` sem saber o idioma
 * nem a versão precisa abrir os três arquivos e comparar à mão; com os dois
 * campos, abre um arquivo numa linha.
 *
 * Os campos são condicionais, e o ramo ausente de cada um nunca tinha caso. Este
 * arquivo cobre os dois lados de cada condição, e prende o formato: `code
 * locale=… version=…`, nessa ordem, separado por espaço. O formato é consumido
 * por olho humano no log, então mudá-lo é mudar contrato de leitura.
 *
 * Também a coleta de versões que `validateLocalizedChangelogs` percorre: uma
 * versão presente APENAS como problema em um dos idiomas precisa entrar no
 * conjunto, senão a divergência que a envolve nunca é comparada.
 */
import { describe, expect, it } from "vitest";
import {
  ChangelogDomainError,
  formatChangelogDiagnostic,
  parseUserChangelog,
  validateLocalizedChangelogs,
  versaoAtual,
  type ChangelogIssue,
} from "../src/core/changelog.ts";

describe("a mensagem de `ChangelogDomainError`", () => {
  it("UT-410 sem detalhe nenhum, a mensagem é só o código", () => {
    const erro = new ChangelogDomainError("localized_content_missing");

    expect(erro.message).toBe("localized_content_missing");
    expect(erro.locale).toBeUndefined();
    expect(erro.version).toBeUndefined();
    expect(erro.name).toBe("ChangelogDomainError");
  });

  it("UT-411 cada campo presente entra na mensagem, na ordem fixa", () => {
    expect(new ChangelogDomainError("localized_content_missing", { locale: "en" }).message).toBe(
      "localized_content_missing locale=en",
    );
    expect(
      new ChangelogDomainError("localized_version_mismatch", { version: "1.2.0" }).message,
    ).toBe("localized_version_mismatch version=1.2.0");
    // Os dois juntos: `locale` antes de `version`, sempre.
    expect(
      new ChangelogDomainError("localized_content_missing", {
        locale: "pt-BR",
        version: "1.2.0",
      }).message,
    ).toBe("localized_content_missing locale=pt-BR version=1.2.0");
  });

  it("UT-412 campo vazio não entra: `version=` sem valor não diz nada", () => {
    // String vazia é falsa, então o campo é omitido em vez de aparecer truncado.
    const erro = new ChangelogDomainError("localized_content_missing", {
      version: "",
    });

    expect(erro.message).toBe("localized_content_missing");
    expect(erro.message).not.toContain("version=");
  });

  it("UT-413 é um `Error` de verdade, e o `code` sobrevive ao `instanceof`", () => {
    // O chamador decide pelo `code`. Se a classe deixar de ser `Error`, um
    // `catch (e) { if (e instanceof ChangelogDomainError) }` para de casar e o
    // erro vira falha genérica.
    const erro = new ChangelogDomainError("localized_visibility_mismatch", { version: "1.2.0" });

    expect(erro).toBeInstanceOf(Error);
    expect(erro).toBeInstanceOf(ChangelogDomainError);
    expect(erro.code).toBe("localized_visibility_mismatch");
    expect(erro.version).toBe("1.2.0");
  });
});

describe("a linha de diagnóstico", () => {
  const problema = (over: Partial<ChangelogIssue> = {}): ChangelogIssue =>
    ({ code: "empty_release", line: 12, ...over }) as ChangelogIssue;

  it("UT-414 sem versão, traz código e idioma", () => {
    expect(formatChangelogDiagnostic(problema(), "pt-BR")).toBe(
      "changelog:empty_release locale=pt-BR",
    );
  });

  it("UT-415 com versão, acrescenta o campo ao fim", () => {
    expect(formatChangelogDiagnostic(problema({ version: "1.2.0" }), "en")).toBe(
      "changelog:empty_release locale=en version=1.2.0",
    );
  });
});

describe("a coleta de versões a comparar", () => {
  it("UT-416 versão que existe só como PROBLEMA em um idioma entra na comparação", () => {
    // Um corpo vazio em pt gera `empty_release` com a versão, e nenhuma entrada
    // em `releases`. Se a coleta ignorasse os problemas, essa versão sairia do
    // conjunto e a divergência contra o `en` — que a tem publicada — nunca seria
    // vista. O gate passaria sobre changelogs que discordam.
    const ptBR = parseUserChangelog("# Novidades\n\n## [1.2.0] - 2026-09-21\n\n");
    const en = parseUserChangelog("# What's New\n\n## [1.2.0] - 2026-09-21\n\n- Something.\n");

    expect(ptBR.issues.some((problema) => problema.version === "1.2.0")).toBe(true);
    expect(() => validateLocalizedChangelogs(ptBR, en)).toThrow(ChangelogDomainError);
  });

  it("UT-417 e o simétrico: o problema no lado `en` também traz a versão", () => {
    const ptBR = parseUserChangelog("# Novidades\n\n## [1.2.0] - 2026-09-21\n\n- Algo.\n");
    const en = parseUserChangelog("# What's New\n\n## [1.2.0] - 2026-09-21\n\n");

    expect(en.issues.some((problema) => problema.version === "1.2.0")).toBe(true);
    expect(() => validateLocalizedChangelogs(ptBR, en)).toThrow(ChangelogDomainError);
  });
});

describe("a versão que o rodapé mostra", () => {
  it("UT-418 metadados de pacote são entrada não confiável, e o padrão fecha em 0.0.0", () => {
    // `package.json` é lido em tempo de execução. Um valor ausente ou de outro
    // tipo não pode virar `undefined` no rodapé de toda tela.
    expect(versaoAtual({ version: "1.20.1" })).toBe("1.20.1");
    expect(versaoAtual({ version: "  1.20.1  " })).toBe("1.20.1");
    for (const ruim of [undefined, null, "", "   ", 1.2, {}, []]) {
      expect(versaoAtual({ version: ruim }), String(ruim)).toBe("0.0.0");
    }
  });
});
