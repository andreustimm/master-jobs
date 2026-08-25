import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseUserChangelog } from "../src/core/changelog.ts";
import {
  carimbarUnreleased,
  changelogTemVersao,
  classificarBump,
  commitDaVersao,
  estadoDaTag,
  exigirTagAlvoAusente,
  prepareRelease,
  proximaVersao,
  releasePrecisaRetomarTag,
  shaDaTagRemota,
  todosChangelogsTemVersao,
  ReleaseDomainError,
  type ReleaseDocuments,
} from "../src/core/release.ts";
import { applyReleaseFiles } from "../scripts/release/versionar.ts";

const NOW = new Date("2026-08-22T11:46:00.000Z");

function documents(options: { noUserChange?: boolean; technicalTerm?: string } = {}): ReleaseDocuments {
  const ptBody = options.noUserChange
    ? "<!-- sem-nota-usuario -->"
    : "### Novidade\n\n- Primeira linha\n  continuada sem truncar.";
  const enBody = options.noUserChange
    ? "<!-- sem-nota-usuario -->"
    : "### New\n\n- First line\n  continued without truncation.";
  return {
    technical: `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- ${options.technicalTerm ?? "Technical change."}\n\n## [1.1.0] - 2026-08-21\n\n- Previous technical release.\n`,
    ptBR: `# Novidades\n\n## [Unreleased]\n\n${ptBody}\n\n## [1.1.0] - 2026-08-21\n\n- Versão anterior.\n`,
    en: `# What's New\n\n## [Unreleased]\n\n${enBody}\n\n## [1.1.0] - 2026-08-21\n\n- Previous release.\n`,
  };
}

function expectReleaseCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("existing semantic version helpers", () => {
  it("classifies the highest release bump", () => {
    expect(classificarBump(["fix: one"])).toBe("patch");
    expect(classificarBump(["fix(ui): one"])).toBe("patch");
    expect(classificarBump(["fix(ci): repair workflow"])).toBeNull();
    expect(classificarBump(["fix: one", "feat: two"])).toBe("minor");
    expect(classificarBump(["feat!: three"])).toBe("major");
    expect(classificarBump(["chore: internal"])).toBeNull();
    expect(classificarBump(["unlabelled product change"])).toBe("patch");
  });

  it("ignores the squash subject generated when staging is promoted", () => {
    expect(classificarBump(["Promover staging para produção — v1.3.3 (#44)"])).toBeNull();
    expect(classificarBump(["Promover staging para produção — v1.3.3"])).toBeNull();
  });

  it("increments canonical versions and rejects malformed input", () => {
    expect(proximaVersao("1.2.3", "patch")).toBe("1.2.4");
    expect(proximaVersao("1.2.3", "minor")).toBe("1.3.0");
    expect(proximaVersao("1.2.3", "major")).toBe("2.0.0");
    expect(() => proximaVersao("v1.2", "patch")).toThrow();
    expect(proximaVersao("1.2.9007199254740993", "patch")).toBe(
      "1.2.9007199254740994",
    );
  });

  it("keeps the legacy single-header stamp strict", () => {
    const source = "## [Unreleased]\n\n- Change.\n";
    expect(carimbarUnreleased(source, "1.2.0", "2026-08-22")).toContain(
      "## [1.2.0] - 2026-08-22",
    );
    expect(() => carimbarUnreleased("", "1.2.0", "2026-08-22")).toThrow();
    expect(() => carimbarUnreleased(`${source}${source}`, "1.2.0", "2026-08-22")).toThrow();
    expect(changelogTemVersao("## [1.2.0] - 2026-08-22\n", "1.2.0")).toBe(true);
    expect(changelogTemVersao("## [1.2.1]\n", "1.2.0")).toBe(false);

    const documented = `## [Unreleased]

\`\`\`md
## [Unreleased]
## [1.2.0] - 2026-08-22
\`\`\`

- Change.
`;
    expect(changelogTemVersao(documented, "1.2.0")).toBe(false);
    expect(carimbarUnreleased(documented, "1.2.0", "2026-08-22")).toContain(
      "## [1.2.0] - 2026-08-22",
    );
  });

  it("sanitizes invalid version values before they reach release logs", () => {
    const error = new ReleaseDomainError("invalid_release_version", {
      version: "1.2.3\n::warning title=spoofed::forged\u001B[2J",
    });
    expect(error.message).toMatch(
      /^invalid_release_version version=[A-Za-z0-9._+?-]{1,64}$/,
    );
    expect(error.message).not.toMatch(/[\r\n\u001B]/);
    expect(error.version).toBe(error.message.replace("invalid_release_version version=", ""));
  });
});

describe("prepareRelease", () => {
  it("UT-020 prepares all three documents coherently", () => {
    const result = prepareRelease({ documents: documents(), version: "1.2.0", publishedAt: NOW });
    expect(result.status).toBe("prepared");
    expect(result.documents.technical).toContain("## [1.2.0] - 2026-08-22");
    expect(result.documents.ptBR).toContain("## [1.2.0] - 2026-08-22T11:46:00.000Z");
    expect(result.documents.en).toContain("## [1.2.0] - 2026-08-22T11:46:00.000Z");
  });

  it("UT-021 keeps the technical date while localized editions retain the instant", () => {
    const result = prepareRelease({ documents: documents(), version: "1.2.0", publishedAt: NOW });
    expect(result.documents.technical).not.toContain("T11:46");
    expect(result.documents.ptBR.match(/2026-08-22T11:46:00\.000Z/g)).toHaveLength(1);
    expect(result.documents.en.match(/2026-08-22T11:46:00\.000Z/g)).toHaveLength(1);
  });

  it("UT-022 rejects any required document without Unreleased", () => {
    for (const key of ["technical", "ptBR", "en"] as const) {
      const input = documents();
      input[key] = input[key].replace("## [Unreleased]", "## Draft");
      expectReleaseCode(() => prepareRelease({ documents: input, version: "1.2.0", publishedAt: NOW }), "missing_unreleased");
    }
  });

  it("UT-023 rejects duplicate Unreleased sections", () => {
    for (const key of ["technical", "ptBR", "en"] as const) {
      const input = documents();
      input[key] = input[key].replace("## [Unreleased]", "## [Unreleased]\n\n## [Unreleased]");
      expectReleaseCode(() => prepareRelease({ documents: input, version: "1.2.0", publishedAt: NOW }), "duplicate_unreleased");
    }
  });

  it("UT-023 rejects a dated Unreleased placeholder", () => {
    for (const key of ["technical", "ptBR", "en"] as const) {
      const input = documents();
      input[key] = input[key].replace(
        "## [Unreleased]",
        "## [Unreleased] - 2026-08-22",
      );
      expectReleaseCode(
        () => prepareRelease({ documents: input, version: "1.2.0", publishedAt: NOW }),
        "missing_unreleased",
      );
    }
  });

  it("UT-023 ignores fenced release metadata during coherent preparation", () => {
    const input = documents();
    for (const key of ["technical", "ptBR", "en"] as const) {
      input[key] = input[key].replace(
        "## [Unreleased]\n\n",
        `## [Unreleased]

## Details

\`\`\`md
## [Unreleased]
## [1.2.0] - 2026-08-22
\`\`\`

`,
      );
    }
    const result = prepareRelease({
      documents: input,
      version: "1.2.0",
      publishedAt: NOW,
    });
    expect(result.status).toBe("prepared");
    expect(result.documents.ptBR).toContain("## Details");
    expect(parseUserChangelog(result.documents.ptBR).issues).toEqual([]);
  });

  it("UT-023 publishes a leading indented omission example as visible content", () => {
    const input = documents();
    input.ptBR = input.ptBR.replace(
      "### Novidade\n\n- Primeira linha\n  continuada sem truncar.",
      "    <!-- sem-nota-usuario -->",
    );
    input.en = input.en.replace(
      "### New\n\n- First line\n  continued without truncation.",
      "    <!-- sem-nota-usuario -->",
    );
    const result = prepareRelease({ documents: input, version: "1.2.0", publishedAt: NOW });
    expect(result.status).toBe("prepared");
    for (const localized of [result.documents.ptBR, result.documents.en]) {
      const parsed = parseUserChangelog(localized);
      expect(parsed).toMatchObject({ issues: [], omitted: [] });
      expect(parsed.releases).toContainEqual(
        expect.objectContaining({
          version: "1.2.0",
          markdown: "    <!-- sem-nota-usuario -->",
        }),
      );
    }
  });

  it("UT-024 rejects malformed localized metadata before returning output", () => {
    const input = documents();
    input.en += "\n## [1.0.0] - 2026-02-30\n\n- Invalid history.\n";
    expectReleaseCode(
      () => prepareRelease({ documents: input, version: "1.2.0", publishedAt: NOW }),
      "invalid_publication",
    );
  });

  it("rejects a stamped technical release whose Unreleased body is empty", () => {
    const input = documents();
    input.technical = input.technical.replace(
      /## \[Unreleased\][\s\S]*?(?=## \[1\.1\.0\])/,
      "## [Unreleased]\n\n",
    );
    expectReleaseCode(
      () => prepareRelease({ documents: input, version: "1.2.0", publishedAt: NOW }),
      "empty_body",
    );
  });

  it("UT-025 returns an explicit already-released result without changing bytes", () => {
    const first = prepareRelease({ documents: documents(), version: "1.2.0", publishedAt: NOW });
    const retry = prepareRelease({
      documents: first.documents,
      version: "1.2.0",
      publishedAt: new Date("2026-08-23T12:00:00.000Z"),
    });
    expect(retry).toEqual({ status: "already-released", documents: first.documents });
  });

  it("UT-025 resumes the checked-in date-only release without rewriting history", () => {
    const current = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const realDocuments = {
      technical: readFileSync("CHANGELOG.md", "utf8"),
      ptBR: readFileSync("USER_CHANGELOG.pt-BR.md", "utf8"),
      en: readFileSync("USER_CHANGELOG.en.md", "utf8"),
    };
    const retry = prepareRelease({
      documents: realDocuments,
      version: current.version,
      publishedAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(retry).toEqual({ status: "already-released", documents: realDocuments });
  });

  it("UT-026 rejects a target present only in the technical document", () => {
    const input = documents();
    input.technical = carimbarUnreleased(input.technical, "1.2.0", "2026-08-22");
    expectReleaseCode(
      () => prepareRelease({ documents: input, version: "1.2.0", publishedAt: NOW }),
      "partial_existing_release",
    );
  });

  it("UT-027 writes one captured instant as identical locale bytes", () => {
    const result = prepareRelease({ documents: documents(), version: "1.2.0", publishedAt: NOW });
    const pt = parseUserChangelog(result.documents.ptBR).releases[0]!.publication;
    const en = parseUserChangelog(result.documents.en).releases[0]!.publication;
    expect(pt).toEqual(en);
    expect(pt).toEqual({ kind: "instant", value: NOW.toISOString() });
  });

  it("UT-028 preserves the first instant on a later retry", () => {
    const first = prepareRelease({ documents: documents(), version: "1.2.0", publishedAt: NOW });
    const retry = prepareRelease({
      documents: first.documents,
      version: "1.2.0",
      publishedAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(retry.documents.ptBR).toContain(NOW.toISOString());
    expect(retry.documents.ptBR).not.toContain("2030-01-01T00:00:00.000Z");
  });

  it("UT-029 advances technical history while symmetric no-user-change stays hidden", () => {
    const result = prepareRelease({
      documents: documents({ noUserChange: true }),
      version: "1.2.0",
      publishedAt: NOW,
    });
    expect(result.documents.technical).toContain("## [1.2.0] - 2026-08-22");
    for (const localized of [result.documents.ptBR, result.documents.en]) {
      const parsed = parseUserChangelog(localized);
      expect(parsed.releases.some((release) => release.version === "1.2.0")).toBe(false);
      expect(parsed.omitted).toContainEqual({
        version: "1.2.0",
        publication: { kind: "instant", value: NOW.toISOString() },
      });
    }
  });
});

async function withFixture(
  source: ReleaseDocuments,
  action: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "jho-release-"));
  try {
    await Promise.all([
      writeFile(join(directory, "CHANGELOG.md"), source.technical),
      writeFile(join(directory, "USER_CHANGELOG.pt-BR.md"), source.ptBR),
      writeFile(join(directory, "USER_CHANGELOG.en.md"), source.en),
      writeFile(join(directory, "package.json"), '{\n  "name": "fixture",\n  "version": "1.1.0"\n}\n'),
    ]);
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function snapshot(directory: string): Promise<Record<string, string>> {
  const files = ["CHANGELOG.md", "USER_CHANGELOG.pt-BR.md", "USER_CHANGELOG.en.md", "package.json"];
  return Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, await readFile(join(directory, file), "utf8")])),
  );
}

describe("release filesystem boundary", () => {
  it("IT-005 writes the successful fixture and preserves multiline bodies", async () => {
    await withFixture(documents(), async (directory) => {
      const result = applyReleaseFiles({ directory, version: "1.2.0", publishedAt: NOW });
      expect(result.status).toBe("prepared");
      const state = await snapshot(directory);
      expect(state["CHANGELOG.md"]).toContain("## [1.2.0] - 2026-08-22");
      expect(state["USER_CHANGELOG.pt-BR.md"]).toContain("Primeira linha\n  continuada");
      expect(state["USER_CHANGELOG.en.md"]).toContain(NOW.toISOString());
      expect(JSON.parse(state["package.json"]!).version).toBe("1.2.0");
    });
  });

  it("IT-005 rejects exact-byte corruption in every persisted release artifact", async () => {
    const corruptions = [
      {
        file: "CHANGELOG.md",
        mutate: (content: string) => content.replace("Technical change", "CORRUPTED technical prose"),
      },
      {
        file: "USER_CHANGELOG.pt-BR.md",
        mutate: (content: string) => content.replace("Primeira linha", "Prosa persistida CORROMPIDA"),
      },
      {
        file: "USER_CHANGELOG.en.md",
        mutate: (content: string) => content.replace("First line", "CORRUPTED persisted prose"),
      },
      {
        file: "package.json",
        mutate: (content: string) => content.replace(
          '  "version":',
          '  "corrupted": true,\n  "version":',
        ),
      },
    ];

    for (const corruption of corruptions) {
      await withFixture(documents(), async (directory) => {
        const operations = {
          read: (path: string) => readFileSync(path, "utf8"),
          write: (path: string, content: string) => {
            writeFileSync(path, content);
            if (path === join(directory, "package.json")) {
              const target = join(directory, corruption.file);
              writeFileSync(target, corruption.mutate(readFileSync(target, "utf8")));
            }
          },
        };
        expectReleaseCode(
          () => applyReleaseFiles({ directory, version: "1.2.0", publishedAt: NOW }, operations),
          "partial_existing_release",
        );
      });
    }
  });

  it("IT-006 rejects missing English content with every file byte-identical", async () => {
    const source = documents();
    source.en = source.en.replace(
      "### New\n\n- First line\n  continued without truncation.",
      "<!-- translator note -->",
    );
    await withFixture(source, async (directory) => {
      const before = await snapshot(directory);
      expect(() => applyReleaseFiles({ directory, version: "1.2.0", publishedAt: NOW })).toThrow();
      expect(await snapshot(directory)).toEqual(before);
    });
  });

  it("IT-007 retries with a later clock without duplicating or restamping", async () => {
    await withFixture(documents(), async (directory) => {
      applyReleaseFiles({ directory, version: "1.2.0", publishedAt: NOW });
      const beforeRetry = await snapshot(directory);
      const retry = applyReleaseFiles({
        directory,
        version: "1.2.0",
        publishedAt: new Date("2026-08-30T00:00:00.000Z"),
      });
      expect(retry.status).toBe("already-released");
      expect(await snapshot(directory)).toEqual(beforeRetry);
      expect(beforeRetry["USER_CHANGELOG.en.md"]!.match(/## \[1\.2\.0\]/g)).toHaveLength(1);
    });
  });

  it("IT-008 rejects a partial target without additional writes", async () => {
    const source = documents();
    source.technical = carimbarUnreleased(source.technical, "1.2.0", "2026-08-22");
    await withFixture(source, async (directory) => {
      const before = await snapshot(directory);
      expectReleaseCode(
        () => applyReleaseFiles({ directory, version: "1.2.0", publishedAt: NOW }),
        "partial_existing_release",
      );
      expect(await snapshot(directory)).toEqual(before);
    });
  });

  it("IT-009 publishes no empty locale card for a no-user-change fixture", async () => {
    await withFixture(documents({ noUserChange: true }), async (directory) => {
      applyReleaseFiles({ directory, version: "1.2.0", publishedAt: NOW });
      const state = await snapshot(directory);
      expect(parseUserChangelog(state["USER_CHANGELOG.pt-BR.md"]!).releases.map((item) => item.version)).not.toContain("1.2.0");
      expect(parseUserChangelog(state["USER_CHANGELOG.en.md"]!).releases.map((item) => item.version)).not.toContain("1.2.0");
      expect(JSON.parse(state["package.json"]!).version).toBe("1.2.0");
    });
  });

  it("IT-010 never copies technical implementation content into localized documents", async () => {
    const internal = "src/core/release.ts uses process.env and auth_user";
    await withFixture(documents({ technicalTerm: internal }), async (directory) => {
      applyReleaseFiles({ directory, version: "1.2.0", publishedAt: NOW });
      const state = await snapshot(directory);
      expect(state["CHANGELOG.md"]).toContain(internal);
      expect(state["USER_CHANGELOG.pt-BR.md"]).not.toContain(internal);
      expect(state["USER_CHANGELOG.en.md"]).not.toContain(internal);
    });
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

  it("os três arquivos reais mantêm exatamente um Unreleased canônico", () => {
    for (const arquivo of [
      "CHANGELOG.md",
      "USER_CHANGELOG.pt-BR.md",
      "USER_CHANGELOG.en.md",
    ]) {
      const markdown = readFileSync(arquivo, "utf8");
      expect(markdown.match(/^## \[Unreleased\]\s*$/gm), arquivo).toHaveLength(1);
    }
  });
});

describe("retomada dos workflows de release", () => {
  it("marca a PR de promoção como manutenção para não abrir outra versão no retorno", () => {
    const workflow = readFileSync(".github/workflows/promover-para-staging.yml", "utf8");
    expect(workflow).toContain(
      '--title "chore(release): Promover staging para produção — v${VERSAO}"',
    );
  });

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
    expect(workflow).toContain('scripts/release/tag-remota.ts "$GITHUB_REPOSITORY" "$VERSAO"');
    expect(workflow).toContain('scripts/release/validar-tag.ts "$SHA" "$TAG_SHA"');
  });

  it("main confirma a tag vigente e não a recria durante uma promoção sem bump", () => {
    const workflow = readFileSync(".github/workflows/sincronizar-apos-main.yml", "utf8");
    expect(workflow).toContain('echo "tagar=nao" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("name: Confirmar tag vigente quando não há bump");
    expect(workflow).toContain("if: steps.versao.outputs.tagar == 'nao'");
    expect(workflow).toContain('if [ -z "$TAG_SHA" ]; then');
    expect(workflow).toContain("if: steps.versao.outputs.tagar == 'sim'");
  });

  it("retorno main→dev não usa --json em gh pr create", () => {
    const workflow = readFileSync(".github/workflows/sincronizar-apos-main.yml", "utf8");
    const inicio = workflow.indexOf("gh pr create --base dev --head main");
    const fim = workflow.indexOf("ABERTA=$(gh pr list", inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    expect(workflow.slice(inicio, fim)).not.toContain("--json");
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
    expect(exigirTagAlvoAusente(null)).toBe("missing");
    expect(() => exigirTagAlvoAusente("conflito")).toThrow("já existe");
  });

  it("a tag da versão nova é verificada antes do commit e do push", () => {
    for (const arquivo of [
      ".github/workflows/promover-para-staging.yml",
      ".github/workflows/sincronizar-apos-main.yml",
    ]) {
      const workflow = readFileSync(arquivo, "utf8");
      const preflight = workflow.indexOf("--must-be-missing");
      const commit = workflow.indexOf('git commit -m "chore(release): ${VERSAO}"');
      expect(preflight, arquivo).toBeGreaterThan(-1);
      expect(preflight, arquivo).toBeLessThan(commit);
    }
  });

  it("matching-refs ignora tags que apenas compartilham o prefixo", () => {
    const payload = [
      { ref: "refs/tags/v1.10.0", object: { sha: "prefixo" } },
      { ref: "refs/tags/v1.1.0", object: { sha: "exata" } },
    ];
    expect(shaDaTagRemota(payload, "1.1.0")).toBe("exata");
    expect(shaDaTagRemota(payload, "2.0.0")).toBeNull();
    expect(() => shaDaTagRemota({}, "1.1.0")).toThrow("não é uma lista");
  });

  it("IT-016 mantém os dois escritores na mesma fila de concorrência", () => {
    for (const arquivo of [
      ".github/workflows/promover-para-staging.yml",
      ".github/workflows/sincronizar-apos-main.yml",
    ]) {
      const workflow = parse(readFileSync(arquivo, "utf8")) as {
        concurrency?: unknown;
      };
      expect(workflow.concurrency, arquivo).toEqual({
        group: "release-versionar",
        queue: "max",
        "cancel-in-progress": false,
      });
    }
  });
});
