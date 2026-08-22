import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  carimbarUnreleased,
  changelogTemVersao,
  classificarBump,
  commitDaVersao,
  estadoDaTag,
  proximaVersao,
  releasePrecisaRetomarTag,
  todosChangelogsTemVersao,
} from "../src/core/release.ts";

describe("classificarBump", () => {
  it("fix puro pede patch", () => {
    expect(classificarBump(["fix: corrige o KDF"])).toBe("patch");
  });

  it("feat puro pede minor", () => {
    expect(classificarBump(["feat: score por candidato"])).toBe("minor");
  });

  it("com escopo continua valendo", () => {
    expect(classificarBump(["fix(auth): corrige o KDF"])).toBe("patch");
    expect(classificarBump(["feat(matching): deriva perfil do currículo"])).toBe("minor");
  });

  it("BREAKING CHANGE pede major, mesmo com feat e fix juntos", () => {
    const leva = [
      "fix: uma correção",
      "feat: uma funcionalidade",
      "feat!: removo a API antiga",
    ];
    expect(classificarBump(leva)).toBe("major");
  });

  it("`tipo!` sem escopo pede major", () => {
    expect(classificarBump(["feat!: quebra a interface"])).toBe("major");
    expect(classificarBump(["fix(auth)!: muda o formato da senha"])).toBe("major");
  });

  it("o maior nível vence: feat + fix → minor", () => {
    expect(classificarBump(["fix: a", "feat: b"])).toBe("minor");
  });

  it("chore, docs e mensagem livre não pedem release", () => {
    expect(classificarBump(["chore: bump de dependência"])).toBeNull();
    expect(classificarBump(["docs: atualiza o README"])).toBeNull();
    expect(classificarBump(["Backlog: M-06 marcado como entregue"])).toBeNull();
    expect(classificarBump([])).toBeNull();
  });
});

describe("proximaVersao", () => {
  it("patch, minor e major andam uma casa cada um", () => {
    expect(proximaVersao("1.0.0", "patch")).toBe("1.0.1");
    expect(proximaVersao("1.0.0", "minor")).toBe("1.1.0");
    expect(proximaVersao("1.0.0", "major")).toBe("2.0.0");
  });

  it("minor zera o patch e major zera tudo", () => {
    expect(proximaVersao("1.2.3", "minor")).toBe("1.3.0");
    expect(proximaVersao("1.2.3", "major")).toBe("2.0.0");
  });

  it("recusa versão que não é MAJOR.MINOR.PATCH", () => {
    for (const torta of ["", "1.0", "v1.0.0", "um.dois.três", "1.0.0.0"]) {
      expect(() => proximaVersao(torta, "patch")).toThrow();
    }
  });
});

describe("carimbarUnreleased", () => {
  const entrada = `## [Unreleased]

### Adicionado

- Algo novo.

## [1.0.0] - 2026-08-21
`;

  it("troca o cabeçalho, preserva o texto e reabre um Unreleased vazio", () => {
    const carimbado = carimbarUnreleased(entrada, "1.1.0", "2026-08-22");
    expect(carimbado).toContain("## [1.1.0] - 2026-08-22");
    expect(carimbado).toContain("### Adicionado");
    expect(carimbado).toContain("- Algo novo.");
    // A seção em construção reabre no topo: sem isto, a promoção seguinte
    // falharia por ausência de `[Unreleased]`.
    expect(carimbado).toContain("## [Unreleased]\n\n## [1.1.0] - 2026-08-22");
    expect(carimbado.match(/^## \[Unreleased\]\s*$/gm)).toHaveLength(1);
  });

  it("sem Unreleased falha em vez de passar mudo", () => {
    expect(() => carimbarUnreleased("## [1.0.0] - 2026-08-21\n", "1.1.0", "2026-08-22")).toThrow();
  });

  it("duas seções Unreleased falham", () => {
    const duplicado = `## [Unreleased]\n\n- a\n\n## [Unreleased]\n\n- b\n`;
    expect(() => carimbarUnreleased(duplicado, "1.1.0", "2026-08-22")).toThrow();
  });

  it("versão de destino já existente falha em vez de duplicar", () => {
    const repetido = `${entrada}\n## [1.1.0] - 2026-08-20\n`;
    expect(() => carimbarUnreleased(repetido, "1.1.0", "2026-08-22")).toThrow(
      "já contém",
    );
  });
});

describe("changelogTemVersao", () => {
  it("aceita com e sem data", () => {
    expect(changelogTemVersao("## [1.1.0]\n", "1.1.0")).toBe(true);
    expect(changelogTemVersao("## [1.1.0] - 2026-08-22\n", "1.1.0")).toBe(true);
  });

  it("não confunde 1.1.0 com 1.1.1", () => {
    expect(changelogTemVersao("## [1.1.1]\n", "1.1.0")).toBe(false);
  });
});

describe("coerência dos changelogs de release", () => {
  const comVersao = "## [1.1.0] - 2026-08-22\n";
  const semVersao = "## [Unreleased]\n";

  it("distingue versão persistida de versão ainda ausente", () => {
    expect(todosChangelogsTemVersao([comVersao, comVersao], "1.1.0")).toBe(true);
    expect(todosChangelogsTemVersao([semVersao, semVersao], "1.1.0")).toBe(false);
  });

  it("estado assimétrico falha antes de qualquer escrita", () => {
    expect(() => todosChangelogsTemVersao([comVersao, semVersao], "1.1.0")).toThrow(
      "apenas parte",
    );
  });

  it("versão duplicada falha mesmo quando aparece nos dois changelogs", () => {
    const duplicado = `${comVersao}${comVersao}`;
    expect(() => todosChangelogsTemVersao([duplicado, duplicado], "1.1.0")).toThrow(
      "duplicada",
    );
    expect(() => todosChangelogsTemVersao([duplicado, comVersao], "1.1.0")).toThrow(
      "duplicada",
    );
  });

  it("retry pré-tag retoma a versão atual em vez de criar a seguinte", () => {
    expect(releasePrecisaRetomarTag([comVersao, comVersao], "1.1.0", false)).toBe(true);
    expect(releasePrecisaRetomarTag([comVersao, comVersao], "1.1.0", true)).toBe(false);
  });

  it("tag existente não esconde divergência entre os changelogs", () => {
    expect(() => releasePrecisaRetomarTag([comVersao, semVersao], "1.1.0", true)).toThrow(
      "apenas parte",
    );
  });

  it("os dois arquivos reais mantêm exatamente um Unreleased canônico", () => {
    for (const arquivo of ["CHANGELOG.md", "USER_CHANGELOG.md"]) {
      const markdown = readFileSync(arquivo, "utf8");
      expect(markdown.match(/^## \[Unreleased\]\s*$/gm), arquivo).toHaveLength(1);
    }
  });
});

describe("retomada dos workflows de release", () => {
  it("a promoção reutiliza a versão persistida e ainda cria sua tag", () => {
    const workflow = readFileSync(".github/workflows/promover-para-staging.yml", "utf8");
    expect(workflow).toContain('if [ "$RESULTADO" = "already-released" ]; then');
    expect(workflow).toContain('VERSAO=$(node -p "require(\'./package.json\').version")');
    expect(workflow).not.toContain("steps.versao.outputs.versao != 'already-released'");
  });

  it("ambos os fluxos ancoram a tag no commit do bump", () => {
    for (const arquivo of [
      ".github/workflows/promover-para-staging.yml",
      ".github/workflows/sincronizar-apos-main.yml",
    ]) {
      expect(readFileSync(arquivo, "utf8"), arquivo).toContain(
        'scripts/release/commit-da-versao.ts origin/',
      );
    }
  });

  it("resolve somente assunto exato e recusa commit ambíguo", () => {
    const valido = "a1b2c3\tchore(release): 1.1.0\n";
    const armadilha = "d4e5f6\tdocs: menciona chore(release): 1.1.0 no corpo\n";
    expect(commitDaVersao(`${armadilha}${valido}`, "1.1.0")).toBe("a1b2c3");
    expect(() => commitDaVersao(`${valido}${valido}`, "1.1.0")).toThrow("encontrados 2");
    expect(() => commitDaVersao(armadilha, "1.1.0")).toThrow("encontrados 0");
  });

  it("main valida uma tag existente contra o commit resolvido", () => {
    const workflow = readFileSync(".github/workflows/sincronizar-apos-main.yml", "utf8");
    expect(workflow).toContain('TAG_SHA=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/v${VERSAO}"');
    expect(workflow).toContain('scripts/release/validar-tag.ts "$SHA" "$TAG_SHA"');
  });

  it("staging avança somente até o SHA publicado pela etapa da tag", () => {
    const workflow = readFileSync(".github/workflows/promover-para-staging.yml", "utf8");
    expect(workflow).toContain("id: tag");
    expect(workflow).toContain('echo "sha=$SHA" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("RELEASE_SHA: ${{ steps.tag.outputs.sha }}");
    expect(workflow).toContain("scripts/release/promover-staging.ts");
    expect(workflow).toContain('origin origin/staging origin/dev "$RELEASE_SHA"');
    expect(workflow).not.toContain('SHA=$(git rev-parse origin/dev)');
  });

  it("no-release valida a tag vigente antes de promover manutenção", () => {
    const workflow = readFileSync(".github/workflows/promover-para-staging.yml", "utf8");
    expect(workflow).toContain("name: Validar tag vigente quando não há bump");
    expect(workflow).toContain("if: steps.versao.outputs.versao == 'no-release'");
    expect(workflow).toContain('scripts/release/validar-tag.ts "$SHA" "$TAG_SHA" --required');
  });

  it("estado da tag distingue criação, existência e corrupção", () => {
    expect(estadoDaTag("release", null, false)).toBe("missing");
    expect(estadoDaTag("release", "release", true)).toBe("current");
    expect(() => estadoDaTag("release", null, true)).toThrow("obrigatória ausente");
    expect(() => estadoDaTag("release", "outro", false)).toThrow("aponta para");
  });
});
