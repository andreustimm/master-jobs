import { readFileSync } from "node:fs";
import YAML from "yaml";
import type { WorkflowEvent } from "../../scripts/github/fork-guard.ts";
import { NON_BLOCKING_CI_JOBS } from "../../scripts/release/promotion-ci.ts";
import { evaluateGithubActionsExpression } from "./expr-eval.ts";

export type CiStep = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
export type CiJob = {
  if?: string;
  needs?: string | string[];
  "continue-on-error"?: unknown;
  strategy?: { matrix?: Record<string, unknown> };
  "runs-on"?: string;
  steps: CiStep[];
};
export type CiWorkflow = { concurrency: { group: string }; jobs: Record<string, CiJob> };

/**
 * O runner hospedado padrão, com a versão do Ubuntu escrita (issue #468:
 * `ubuntu-latest` troca de SO por fora do CI). O Renovate sobe esta etiqueta
 * junto com a de `ci.yml` (`renovate.json`, gerenciador `github-runners`).
 */
export const HOSTED_RUNNER = "ubuntu-26.04";

/**
 * A única expressão aceita em `runs-on:` de qualquer job de `ci.yml` (issue
 * #367, ADR 0030 decisões 1 e 4). `vars.CI_RUNS_ON` ausente ou vazia mantém
 * `HOSTED_RUNNER`; setada, troca o runner de todo job sem editar o arquivo. A
 * primeira metade é a guarda de fork: uma PR cuja `head.repo` difere de
 * `github.repository` sempre resolve para `HOSTED_RUNNER`, mesmo com
 * `CI_RUNS_ON` apontando para o runner próprio — a mesma comparação de
 * `isForkPullRequest` (`scripts/github/fork-guard.ts`).
 */
export const CANONICAL_RUNS_ON =
  "${{ github.event_name == 'pull_request' && " +
  "github.event.pull_request.head.repo.full_name != github.repository && " +
  `'${HOSTED_RUNNER}' || fromJSON(vars.CI_RUNS_ON || '"${HOSTED_RUNNER}"') }}`;

/** Nome de todo job cujo `runs-on:` não é a expressão canônica — vazio quando conforme. */
export function runsOnViolations(workflow: CiWorkflow): string[] {
  return Object.entries(workflow.jobs)
    .filter(([, job]) => job["runs-on"] !== CANONICAL_RUNS_ON)
    .map(([name]) => name);
}

/**
 * Resolve `CANONICAL_RUNS_ON` de verdade — avaliando a STRING (via
 * `evaluateGithubActionsExpression`, `tests/support/expr-eval.ts`), não
 * reimplementando a decisão do lado do teste. Isso é o que prova equivalência
 * comportamental com `isForkPullRequest` sobre os MESMOS eventos de F2-03
 * (3ª revisão L2 da PR #376, minor 1): se `CANONICAL_RUNS_ON` divergir do
 * texto que `isForkPullRequest` implementa, é a expressão avaliada de
 * verdade que vai discordar — chamar `isForkPullRequest` aqui dentro seria
 * tautológico e não pegaria essa divergência.
 */
export function resolveCanonicalRunsOn(event: WorkflowEvent, ciRunsOn: string | undefined): unknown {
  const context = {
    github: {
      event_name: event.eventName,
      repository: event.repository,
      event: {
        pull_request:
          event.pullRequestHeadRepoFullName === undefined
            ? undefined
            : { head: { repo: { full_name: event.pullRequestHeadRepoFullName } } },
      },
    },
    vars: { CI_RUNS_ON: ciRunsOn },
  };
  return evaluateGithubActionsExpression(CANONICAL_RUNS_ON, context);
}

export function ciWorkflowFrom(yaml: string): CiWorkflow {
  return YAML.parse(yaml) as CiWorkflow;
}

/** O CI roda os gates em jobs paralelos; `qualidade` é o agregador exigido. */
export const AGGREGATOR = "qualidade";

/**
 * Jobs que rodam no CI sem bloquear o agregador nem a promoção, cada um com o
 * porquê. A lista é a da promoção (`scripts/release/promotion-ci.ts`): uma
 * cópia aqui deixaria o teste aceitar um job que a promoção ainda exige.
 *
 * Exceção é decisão com prazo, não esquecimento: sair daqui é entrar em
 * `qualidade.needs`, e `tests/ci-e2e-job.test.ts` trava a de hoje.
 */
export const NON_BLOCKING_JOBS = NON_BLOCKING_CI_JOBS;

export function ciWorkflow(): CiWorkflow {
  return YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8")) as CiWorkflow;
}

export function needsOf(job: CiJob): string[] {
  if (job.needs === undefined) return [];
  return typeof job.needs === "string" ? [job.needs] : job.needs;
}

/**
 * O job que contém o passo procurado — e só vale se o agregador depende dele.
 * Passo num job fora de `qualidade.needs` roda, mas não bloqueia nada.
 */
export function gatedJobWithStep(ci: CiWorkflow, matches: (step: CiStep) => boolean): string {
  const owners = Object.entries(ci.jobs)
    .filter(([, job]) => job.steps?.some(matches))
    .map(([name]) => name);
  if (owners.length !== 1) throw new Error(`esperado um job com o passo, achados: ${owners.join(", ") || "nenhum"}`);
  const owner = owners[0]!;
  if (!needsOf(ci.jobs[AGGREGATOR]!).includes(owner)) {
    throw new Error(`o job ${owner} não está em ${AGGREGATOR}.needs`);
  }
  return owner;
}

export function checkoutOf(job: CiJob): CiStep | undefined {
  return job.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));
}
