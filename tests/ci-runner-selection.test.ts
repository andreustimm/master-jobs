// Suite: runner de CI selecionável por variável, sem literal novo, sem fork
//   no runner próprio (issue #367, Fase 2 da contingência de CI/deploy)
// Invariant: todo `runs-on:` de `ci.yml` é a mesma expressão — ausência de
//   `vars.CI_RUNS_ON` mantém o hospedado, e PR de fork nunca resolve para o
//   runner próprio, mesmo com a variável setada (ADR 0030 decisões 1 e 4)
// Boundary IN: `.github/workflows/ci.yml` e a fixture desta suíte, lidos como
//   dado (YAML), e `scripts/github/fork-guard.ts`, executado de verdade
// Boundary OUT: o motor de expressões do GitHub Actions e o runner real
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isForkPullRequest } from "../scripts/github/fork-guard.ts";
import { CANONICAL_RUNS_ON, ciWorkflow, ciWorkflowFrom, runsOnViolations } from "./support/ci-workflow.ts";

const ci = ciWorkflow();

describe("F2-01 — runs-on só pela variável, sem literal novo", () => {
  it("todo job de ci.yml usa a mesma expressão canônica", () => {
    expect(Object.keys(ci.jobs).length).toBeGreaterThan(0);
    expect(runsOnViolations(ci)).toEqual([]);
  });

  it("a expressão cai no hospedado quando CI_RUNS_ON está ausente/vazia", () => {
    expect(CANONICAL_RUNS_ON).toContain("fromJSON(vars.CI_RUNS_ON || '\"ubuntu-latest\"')");
  });
});

describe("F2-02 — o gate pega regressão, não só o estado atual", () => {
  it("reprova um job novo com runs-on literal na fixture, sem tocar em ci.yml real", () => {
    const fixture = ciWorkflowFrom(readFileSync("tests/fixtures/ci-runner-selection/job-com-literal.yml", "utf8"));
    expect(runsOnViolations(fixture)).toEqual(["job-novo-com-literal"]);
  });
});

describe("F2-03 — a guarda de fork é uma função pura testável isolada", () => {
  it("é true só para pull_request cuja head pertence a outro repositório", () => {
    expect(
      isForkPullRequest({
        eventName: "pull_request",
        pullRequestHeadRepoFullName: "outra-conta/master-jobs",
        repository: "andreustimm/master-jobs",
      }),
    ).toBe(true);
  });

  it("é false para pull_request do próprio repositório", () => {
    expect(
      isForkPullRequest({
        eventName: "pull_request",
        pullRequestHeadRepoFullName: "andreustimm/master-jobs",
        repository: "andreustimm/master-jobs",
      }),
    ).toBe(false);
  });

  it("é false para push, mesmo sem head de PR nenhuma", () => {
    expect(isForkPullRequest({ eventName: "push", repository: "andreustimm/master-jobs" })).toBe(false);
  });

  it("é false para workflow_dispatch e para o workflow_call da promoção", () => {
    expect(isForkPullRequest({ eventName: "workflow_dispatch", repository: "andreustimm/master-jobs" })).toBe(false);
    expect(isForkPullRequest({ eventName: "workflow_call", repository: "andreustimm/master-jobs" })).toBe(false);
  });
});

describe("F2-04 — a guarda de F2-03 está embutida em todo runs-on que pode resolver self-hosted", () => {
  it("a expressão canônica usa exatamente a comparação de isForkPullRequest", () => {
    // As duas fontes (aqui e scripts/github/fork-guard.ts) não podem divergir
    // sem que este teste, ou o de F2-03, quebre primeiro.
    expect(CANONICAL_RUNS_ON).toContain("github.event_name == 'pull_request'");
    expect(CANONICAL_RUNS_ON).toContain(
      "github.event.pull_request.head.repo.full_name != github.repository",
    );
    // Trava o fragmento exato, não só as duas metades soltas: prova que o
    // `&&`/`||` que decide "fork cai no hospedado, senão lê a variável" está
    // na ordem certa, não só que as palavras aparecem em algum lugar
    // (revisão L2 da PR #376, minor F2-04).
    expect(CANONICAL_RUNS_ON).toContain("!= github.repository && 'ubuntu-latest' ||");
    // A guarda decide ANTES do fromJSON: uma PR de fork nunca alcança
    // `vars.CI_RUNS_ON`, mesmo que ela aponte para o runner próprio.
    const guardIndex = CANONICAL_RUNS_ON.indexOf("head.repo.full_name != github.repository");
    const fromJsonIndex = CANONICAL_RUNS_ON.indexOf("fromJSON(vars.CI_RUNS_ON");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(fromJsonIndex).toBeGreaterThan(guardIndex);
  });

  it("nenhum job de ci.yml escapa da expressão guardada — nenhum literal e nenhuma variação", () => {
    for (const [name, job] of Object.entries(ci.jobs)) {
      expect(job["runs-on"], name).toBe(CANONICAL_RUNS_ON);
    }
  });
});

describe("M2 (revisão L2 da PR #376) — instalação do Playwright pula no runner próprio", () => {
  // `--with-deps`/`install-deps` pedem apt/sudo, que o job do runner próprio
  // não tem — e não precisa, com Chromium/WebKit já na imagem
  // (scripts/runner/Dockerfile). `runner.environment` é `github-hosted` ou
  // `self-hosted`, contexto do próprio GitHub Actions.
  const stepsThatInstallBrowsers = Object.values(ci.jobs)
    .flatMap((job) => job.steps)
    .filter((step) => /playwright (install|install-deps)\b.*(--with-deps|chromium|webkit)/.test(step.run ?? ""));

  it("existe ao menos um passo de instalação de navegador para proteger", () => {
    expect(stepsThatInstallBrowsers.length).toBeGreaterThan(0);
  });

  it("todo passo que instala navegador/dependência do Playwright exige runner hospedado", () => {
    for (const step of stepsThatInstallBrowsers) {
      expect(step.if, step.name ?? step.run).toContain("runner.environment != 'self-hosted'");
    }
  });
});
