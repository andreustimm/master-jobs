// Suite: release policy gates
// Invariant: every releasable commit is ready to stamp and every SemVer tag can own one GitHub Release
// Boundary IN: pure release readiness/planning plus committed hook and workflow wiring
// Boundary OUT: GitHub API mutation, exercised by scripts/release/github-releases.ts after this suite passes
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  planejarGithubReleases,
  validarReleasePendente,
  type ReleaseDocuments,
} from "../src/core/release.ts";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function readyDocuments(): ReleaseDocuments {
  return {
    technical: "# Changelog\n\n## [Unreleased]\n\n### Corrigido\n\n- Gate técnico.\n",
    ptBR: "# Novidades\n\n## [Unreleased]\n\n### Correção\n\n- Correção visível.\n",
    en: "# What's New\n\n## [Unreleased]\n\n### Fixed\n\n- Visible fix.\n",
  };
}

describe("commit release gate", () => {
  it("rejects a releasable commit when the technical Unreleased body is empty", () => {
    const documents = readyDocuments();
    documents.technical = "# Changelog\n\n## [Unreleased]\n";

    expect(() =>
      validarReleasePendente({
        subjects: ["fix(ui): corrige o cabeçalho"],
        currentVersion: "1.3.7",
        documents,
        publishedAt: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "empty_body" }));
  });

  it("accepts a releasable commit only when all release documents can be stamped", () => {
    expect(
      validarReleasePendente({
        subjects: ["fix(ui): corrige o cabeçalho"],
        currentVersion: "1.3.7",
        documents: readyDocuments(),
        publishedAt: NOW,
      }),
    ).toEqual({ status: "ready", version: "1.3.8" });
  });

  it("does not demand release notes for an explicitly maintenance-only batch", () => {
    const empty = "# Changelog\n\n## [Unreleased]\n";
    expect(
      validarReleasePendente({
        subjects: ["docs: corrige uma referência interna"],
        currentVersion: "1.3.7",
        documents: { technical: empty, ptBR: empty, en: empty },
        publishedAt: NOW,
      }),
    ).toEqual({ status: "no-release" });
  });

  it("keeps the local hook and CI gate wired to the same validator", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const ci = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
      jobs: { qualidade: { steps: Array<{ name?: string; run?: string }> } };
    };
    const releaseGate = ci.jobs.qualidade.steps.find(
      (candidate) => candidate.name === "Changelogs prontos para release",
    );

    expect(pkg.scripts.prepare).toBe("node scripts/configure-git-hooks.mjs");
    expect(pkg.scripts["check:release-ready"]).toContain("validar-changelogs.ts");
    expect(pkg.scripts.check).toMatch(/^pnpm check:release-ready/);
    expect(releaseGate?.run).toContain("git log -1 --format=%B");
    expect(releaseGate?.run).toContain(
      'pnpm check:release-ready \\\n  --commit-message-file "$RUNNER_TEMP/release-commit-message"',
    );
    expect(releaseGate?.run).not.toContain("check:release-ready --");
  });
});

describe("GitHub Release planning", () => {
  const technicalChangelog = `# Changelog

## [Unreleased]

## [1.1.0] - 2026-08-21

### Corrigido

- Conteúdo técnico da versão.

## [1.0.0] - 2026-08-20

- Primeira versão.
`;

  it("plans every missing SemVer tag while preserving existing releases", () => {
    const plan = planejarGithubReleases({
      tags: ["v0.1.0", "v1.0.0", "v1.1.0", "v1.1.0"],
      existingReleaseTags: ["v1.0.0"],
      technicalChangelog,
    });

    expect(plan.map((release) => release.tag)).toEqual(["v0.1.0", "v1.1.0"]);
    expect(plan[0]!.body).toContain("antecede as entradas");
    expect(plan[1]!.body).toContain("Conteúdo técnico da versão");
  });

  it("fails closed when a current tag has no matching technical notes", () => {
    expect(() =>
      planejarGithubReleases({
        tags: ["v1.2.0"],
        existingReleaseTags: [],
        technicalChangelog,
      }),
    ).toThrow(expect.objectContaining({ code: "missing_release_notes", version: "1.2.0" }));
  });

  it("uses numeric SemVer order to identify tags older than the recorded history", () => {
    const twoDigitHistory = `# Changelog

## [Unreleased]

## [1.10.0] - 2026-08-22

- Décima versão menor.

## [1.9.0] - 2026-08-21

- Nona versão menor.
`;
    const plan = planejarGithubReleases({
      tags: ["v1.8.0"],
      existingReleaseTags: [],
      technicalChangelog: twoDigitHistory,
    });

    expect(plan[0]?.body).toContain("antecede as entradas");
  });

  it("rejects a version tag that is not canonical SemVer", () => {
    expect(() =>
      planejarGithubReleases({
        tags: ["v1.2"],
        existingReleaseTags: [],
        technicalChangelog,
      }),
    ).toThrow("tag de release inválida");
  });

  it("keeps the post-main workflow responsible for idempotent release sync", () => {
    const workflow = YAML.parse(
      readFileSync(".github/workflows/sincronizar-apos-main.yml", "utf8"),
    ) as {
      jobs: {
        marcar: {
          steps: Array<{
            name?: string;
            run?: string;
            env?: Record<string, string>;
          }>;
        };
      };
    };
    const step = workflow.jobs.marcar.steps.find(
      (candidate) => candidate.name === "Criar GitHub Releases ausentes",
    );

    expect(step?.run).toContain("scripts/release/github-releases.ts");
    expect(step?.run).toContain('--repo "$GITHUB_REPOSITORY" --apply');
    expect(step?.env?.GH_TOKEN).toBe("${{ secrets.RELEASE_PAT || github.token }}");
  });
});
