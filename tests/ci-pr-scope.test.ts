// Suite: recorte do CI de PR só de documentação (#528)
// Invariant: só Markdown na lista de permissão pula os jobs pesados; o resto,
//   e qualquer dúvida, roda a suíte completa
// Boundary IN: scripts/github/pr-scope.ts, com o git injetado
// Boundary OUT: o motor do GitHub Actions
import { describe, expect, it } from "vitest";
import { isDocumentationOnly, needsFullSuite, scope } from "../scripts/github/pr-scope.ts";

describe("isDocumentationOnly", () => {
  it("aceita Markdown de docs, fragmentos, .compozy, .claude, .github e da raiz", () => {
    for (const path of [
      "docs/engineering/rules/delivery.md",
      "changelog.d/fix-x.md",
      ".compozy/tasks/x/_tests.md",
      ".claude/skills/qa-report/SKILL.md",
      ".github/PULL_REQUEST_TEMPLATE.md",
      "AGENTS.md",
      "DESIGN.md",
    ]) expect(isDocumentationOnly(path), path).toBe(true);
  });

  it("recusa Markdown que o build ou o runtime leem", () => {
    for (const path of ["CHANGELOG.md", "USER_CHANGELOG.pt-BR.md", "USER_CHANGELOG.en.md", "docs/prompts/system/score.md"]) {
      expect(isDocumentationOnly(path), path).toBe(false);
    }
  });

  it("recusa qualquer coisa que não seja Markdown, e Markdown fora da lista", () => {
    for (const path of ["app/page.tsx", "docs/qa/state.csv", "docs/diagram.svg", "src/core/i18n/README.md", "tests/e2e/notes.md", "AGENTS.mdx"]) {
      expect(isDocumentationOnly(path), path).toBe(false);
    }
  });
});

describe("needsFullSuite", () => {
  it("só documentação pula; um arquivo de fora basta para a suíte completa", () => {
    expect(needsFullSuite(["docs/a.md", "AGENTS.md"])).toBe(false);
    expect(needsFullSuite(["docs/a.md", "app/page.tsx"])).toBe(true);
  });

  it("lista vazia não prova nada", () => {
    expect(needsFullSuite([])).toBe(true);
  });
});

describe("scope", () => {
  const git = (out: string) => () => out;

  it("fora de pull_request é sempre completo, sem ler o git", () => {
    for (const event of ["push", "workflow_call", "workflow_dispatch", undefined]) {
      const result = scope(event, () => { throw new Error("não devia ler o git"); });
      expect(result.completo, String(event)).toBe(true);
    }
  });

  it("PR só de documentação não é completo", () => {
    expect(scope("pull_request", git("docs/a.md\nchangelog.d/x.md\n")).completo).toBe(false);
  });

  it("PR com código, diff vazio ou git falhando é completo", () => {
    expect(scope("pull_request", git("docs/a.md\napp/page.tsx\n")).completo).toBe(true);
    expect(scope("pull_request", git("\n")).completo).toBe(true);
    expect(scope("pull_request", () => { throw new Error("fatal: bad revision 'HEAD^1'"); }).completo).toBe(true);
  });

  it("pede o diff sem detectar renomeação, para mover código não parecer documentação", () => {
    let asked: string[] = [];
    scope("pull_request", (args) => { asked = args; return "docs/a.md"; });
    expect(asked).toEqual(["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"]);
  });
});
