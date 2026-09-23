import { readFileSync } from "node:fs";
import YAML from "yaml";

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
