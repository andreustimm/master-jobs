/**
 * As recusas do preflight de release.
 *
 * `prepareRelease` é o único ponto entre um commit e uma tag publicada, e o
 * valor dele está quase todo em dizer **não**. Cada exceção aqui existe porque o
 * estado que ela recusa já apareceu, ou apareceria em silêncio:
 *
 * - versão fora do SemVer viraria uma tag que nenhuma ordenação entende;
 * - `Date` inválida viraria `## [1.2.0] - Invalid Date` no changelog público;
 * - marcador "sem nota de usuário" em um idioma só produziria duas histórias
 *   diferentes para a mesma versão;
 * - seção vazia sem o marcador viraria uma release muda, publicada.
 *
 * E as recusas em volta da tag remota: `shaDaTagRemota` lê a resposta da API do
 * GitHub, que é entrada externa. Duas ocorrências para a mesma ref significam
 * que a tag foi movida ou duplicada — continuar dali publicaria uma release
 * apontando para o commit errado.
 */
import { describe, expect, it } from "vitest";
import {
  carimbarUnreleased,
  prepareRelease,
  planejarGithubReleases,
  shaDaTagRemota,
  todosChangelogsTemVersao,
  type ReleaseDocuments,
} from "../src/core/release.ts";

const AGORA = new Date("2026-09-21T12:00:00.000Z");

function documentos(
  opcoes: { ptSemNota?: boolean; enSemNota?: boolean; ptVazio?: boolean; enVazio?: boolean } = {},
): ReleaseDocuments {
  const corpo = (semNota: boolean, vazio: boolean, texto: string) => {
    if (semNota) return "<!-- sem-nota-usuario -->";
    if (vazio) return "";
    return texto;
  };
  return {
    technical: "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Technical change.\n\n## [1.1.0] - 2026-09-20\n\n- Anterior.\n",
    ptBR: `# Novidades\n\n## [Unreleased]\n\n${corpo(opcoes.ptSemNota ?? false, opcoes.ptVazio ?? false, "### Novidade\n\n- Uma linha.")}\n\n## [1.1.0] - 2026-09-20\n\n- Anterior.\n`,
    en: `# What's New\n\n## [Unreleased]\n\n${corpo(opcoes.enSemNota ?? false, opcoes.enVazio ?? false, "### New\n\n- One line.")}\n\n## [1.1.0] - 2026-09-20\n\n- Previous.\n`,
  };
}

/** Executa e devolve o `code` do erro de domínio, ou falha dizendo o que veio. */
function codigoDoErro(acao: () => unknown): string {
  try {
    acao();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    throw new Error(`erro sem código de domínio: ${String(error)}`);
  }
  throw new Error("esperava uma recusa, e nada foi lançado");
}

describe("a versão e a data que o preflight recusa", () => {
  it("UT-280 versão fora do SemVer é recusada antes de qualquer leitura de changelog", () => {
    for (const versao of ["1.2", "v1.2.0", "1.2.0-rc1", "01.2.0", "", "latest"]) {
      expect(
        codigoDoErro(() => prepareRelease({ documents: documentos(), version: versao, publishedAt: AGORA })),
        versao,
      ).toBe("invalid_release_version");
    }
  });

  it("UT-281 `Date` inválida é recusada em vez de carimbar `Invalid Date`", () => {
    // `new Date("ontem").toISOString()` estoura, e `String(...)` daria
    // "Invalid Date" dentro do cabeçalho — publicado, e irreversível.
    expect(
      codigoDoErro(() =>
        prepareRelease({
          documents: documentos(),
          version: "1.2.0",
          publishedAt: new Date("ontem"),
        }),
      ),
    ).toBe("invalid_published_at");
  });
});

describe("os dois idiomas precisam concordar sobre haver nota", () => {
  it("UT-282 marcador em um idioma só é recusado, nas duas direções", () => {
    expect(
      codigoDoErro(() =>
        prepareRelease({
          documents: documentos({ ptSemNota: true }),
          version: "1.2.0",
          publishedAt: AGORA,
        }),
      ),
    ).toBe("localized_visibility_mismatch");

    expect(
      codigoDoErro(() =>
        prepareRelease({
          documents: documentos({ enSemNota: true }),
          version: "1.2.0",
          publishedAt: AGORA,
        }),
      ),
    ).toBe("localized_visibility_mismatch");
  });

  it("UT-283 seção vazia sem o marcador é recusada, nomeando o idioma", () => {
    // Vazio não é "nada mudou para o usuário": é "ninguém escreveu". A distinção
    // é o marcador, e é ele que autoriza a release sem nota.
    expect(
      codigoDoErro(() =>
        prepareRelease({
          documents: documentos({ ptVazio: true, enVazio: true }),
          version: "1.2.0",
          publishedAt: AGORA,
        }),
      ),
    ).toBe("localized_content_missing");
  });

  it("UT-284 marcador nos DOIS idiomas é a release sem nota, e passa", () => {
    // O lado positivo da mesma regra: declarar em ambos é declaração legítima.
    const resultado = prepareRelease({
      documents: documentos({ ptSemNota: true, enSemNota: true }),
      version: "1.2.0",
      publishedAt: AGORA,
    });

    expect(resultado.status).toBe("prepared");
    expect(resultado.documents.technical).toContain("## [1.2.0] - 2026-09-21");
  });
});

describe("carimbar uma versão que já está no changelog", () => {
  it("UT-285 é recusado: duas seções para a mesma versão seriam duas histórias", () => {
    const markdown =
      "# Changelog\n\n## [Unreleased]\n\n- nova.\n\n## [1.2.0] - 2026-09-20\n\n- já publicada.\n";

    expect(() => carimbarUnreleased(markdown, "1.2.0", "2026-09-21")).toThrow(/já contém a versão/);
  });
});

describe("a coerência entre os três changelogs", () => {
  it("UT-286 validar sem changelog nenhum é erro de chamada, não um `false` silencioso", () => {
    // Devolver `false` aqui faria a promoção seguir achando que a versão não
    // existe em lugar nenhum — que é exatamente a resposta que ela quer ouvir.
    expect(() => todosChangelogsTemVersao([], "1.2.0")).toThrow(/nenhum changelog/);
  });

  it("UT-287 a mesma versão duas vezes num changelog é recusada", () => {
    const duplicado =
      "# Changelog\n\n## [1.2.0] - 2026-09-20\n\n- a.\n\n## [1.2.0] - 2026-09-21\n\n- b.\n";

    expect(() => todosChangelogsTemVersao([duplicado], "1.2.0")).toThrow(/duplicada/);
  });
});

describe("a resposta da API de refs, que é entrada externa", () => {
  it("UT-288 resposta que não é lista é recusada em vez de virar `null`", () => {
    // `null` significaria "a tag não existe", e a partir dele o fluxo criaria
    // uma tag que pode já existir apontando para outro commit.
    for (const payload of [null, undefined, {}, "refs/tags/v1.2.0", 42]) {
      expect(() => shaDaTagRemota(payload, "1.2.0"), String(payload)).toThrow(
        /não é uma lista/,
      );
    }
  });

  it("UT-289 item malformado na lista é ignorado, e a ausência é `null`", () => {
    // Lista válida com lixo dentro: o que não tem a forma acordada não conta, e
    // uma lista sem a ref procurada é ausência legítima.
    const sha = shaDaTagRemota(
      [null, "texto", { ref: "refs/tags/v1.1.0", object: { sha: "aaa" } }, { ref: "refs/tags/v1.2.0" }],
      "1.2.0",
    );

    expect(sha).toBeNull();
  });

  it("UT-290 duas ocorrências da mesma ref são recusadas", () => {
    const duas = [
      { ref: "refs/tags/v1.2.0", object: { sha: "aaa" } },
      { ref: "refs/tags/v1.2.0", object: { sha: "bbb" } },
    ];

    expect(() => shaDaTagRemota(duas, "1.2.0")).toThrow(/2 ocorrências/);
  });

  it("UT-291 uma ocorrência bem formada devolve o sha", () => {
    const sha = shaDaTagRemota(
      [{ ref: "refs/tags/v1.2.0", object: { sha: "c0ffee" } }],
      "1.2.0",
    );

    expect(sha).toBe("c0ffee");
  });
});

describe("o plano de GitHub Releases", () => {
  const tecnico =
    "# Changelog\n\n## [1.2.0] - 2026-09-21\n\n- nova.\n\n## [1.1.0] - 2026-09-20\n\n- anterior.\n";

  it("UT-292 tag fora do padrão `vX.Y.Z` é recusada nomeando a tag", () => {
    for (const tag of ["1.2.0", "v1.2", "release-1.2.0", "v1.2.0-rc1"]) {
      expect(
        () =>
          planejarGithubReleases({
            tags: [tag],
            existingReleaseTags: [],
            technicalChangelog: tecnico,
          }),
        tag,
      ).toThrow(/tag de release inválida/);
    }
  });

  it("UT-293 tag repetida e vazia não geram plano duplicado", () => {
    const plano = planejarGithubReleases({
      tags: ["v1.2.0", "  ", "v1.2.0", ""],
      existingReleaseTags: [],
      technicalChangelog: tecnico,
    });

    expect(plano.map((item) => item.tag)).toEqual(["v1.2.0"]);
  });

  it("UT-294 release que já existe é preservada, e só a ausente entra no plano", () => {
    const plano = planejarGithubReleases({
      tags: ["v1.1.0", "v1.2.0"],
      existingReleaseTags: ["v1.1.0"],
      technicalChangelog: tecnico,
    });

    expect(plano.map((item) => item.tag)).toEqual(["v1.2.0"]);
  });
});
