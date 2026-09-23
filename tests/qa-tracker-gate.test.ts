// Suite: QA tracker gate
// Invariant: every scenario in docs/qa/scenarios/ is checked against the state schema by `pnpm check` and by CI
// Boundary IN: package.json scripts, the CI jobs gated by `qualidade` and .gitignore wiring
// Boundary OUT: the validator's own rules, covered by .claude/skills/qa-report/tests/test_scripts.py
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ciWorkflow, gatedJobWithStep } from "./support/ci-workflow.ts";

// `docs/qa/state.csv` é visão gerada e ignorada pelo git: sem gate, o esquema só
// era conferido quando alguém rodava o validador de propósito, e a primeira vez
// que alguém rodou achou 15 registros inválidos. Estes testes existem para que o
// gate não saia do `check` nem do CI sem que alguém perceba.

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

describe("QA tracker gate", () => {
  it("runs the state validator on docs/qa without writing bytecode", () => {
    const script = pkg.scripts["check:qa-tracker"];

    expect(script).toContain(".claude/skills/qa-report/scripts/materialize_state.py docs/qa");
    // Sem isto o import deixa `__pycache__/` na árvore de quem roda o gate.
    expect(script).toMatch(/^PYTHONDONTWRITEBYTECODE=1 /);
  });

  it("is part of the local check", () => {
    expect(pkg.scripts.check?.split(" && ")).toContain("pnpm check:qa-tracker");
  });

  it("is a step of a CI job that the quality aggregator requires", () => {
    const ci = ciWorkflow();

    expect(() => gatedJobWithStep(ci, (step) => step.run === "pnpm check:qa-tracker")).not.toThrow();
  });

  it("keeps Python bytecode out of the tree for whoever skips the gate", () => {
    const ignored = readFileSync(".gitignore", "utf8").split("\n").map((line) => line.trim());

    expect(ignored).toContain("__pycache__/");
  });
});
