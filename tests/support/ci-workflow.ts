import { readFileSync } from "node:fs";
import YAML from "yaml";
import { NON_BLOCKING_CI_JOBS } from "../../scripts/release/promotion-ci.ts";

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
  steps: CiStep[];
};
export type CiWorkflow = { concurrency: { group: string }; jobs: Record<string, CiJob> };

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
