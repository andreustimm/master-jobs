import { execFileSync } from "node:child_process";

export const REQUIRED_CI_JOBS = ["qualidade", "schema-e-migracao"] as const;

/**
 * Jobs do CI que rodam sem bloquear nada, cada um com o porquê.
 *
 * Mora aqui, e não só no teste, porque a promoção precisa da mesma lista: um
 * job declarado não bloqueante que ainda reprova a promoção é bloqueante por
 * outra porta (#303). `tests/support/ci-workflow.ts` reexporta este objeto, e
 * `tests/ci-pipeline.test.ts` confere que cada nome aqui está fora de
 * `qualidade.needs`. Exceção é decisão com prazo: sair daqui é entrar no
 * agregador.
 */
export const NON_BLOCKING_CI_JOBS: Readonly<Record<string, string>> = {
  "e2e-navegador":
    "suíte de navegador inteira; fica fora do portão até a instabilidade no CI estar medida (issue #202)",
};

type Run = {
  id: number;
  run_attempt: number;
  head_sha: string;
  head_branch: string;
  event: string;
  path: string;
  status: string;
  conclusion: string | null;
  head_repository: { full_name: string };
};
type Job = { name: string; head_sha: string; status: string; conclusion: string | null };

export function ghApi<T>(path: string, args: string[] = []): T {
  return JSON.parse(execFileSync("gh", ["api", path, ...args], { encoding: "utf8" })) as T;
}

export function requireSha(value: string): string {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error("O alvo exige um SHA completo de 40 caracteres.");
  return value;
}

/** The CI answered and refused by job verdict; an API failure is never this. */
export class CIVerdictRefusal extends Error {}

const isNonBlocking = (job: Job) => Object.hasOwn(NON_BLOCKING_CI_JOBS, job.name);
const settled = (job: Job) => job.status === "completed" && job.conclusion === "success";

/**
 * O veredito de uma tentativa de CI, a partir dos jobs dela. Puro.
 *
 * Os obrigatórios precisam existir uma vez e ter passado. Os demais jobs
 * bloqueantes não podem ter reprovado nem estar pendentes (`skipped` passa: é
 * o `validacao`, que só roda na chamada da promoção). Os não bloqueantes são
 * ignorados — mas só eles: uma execução que não terminou verde precisa ter
 * a causa num job não bloqueante, senão o motivo é desconhecido e recusa.
 */
export function ciVerdict(run: Pick<Run, "status" | "conclusion">, jobs: Job[], sha: string): string | null {
  for (const name of REQUIRED_CI_JOBS) {
    const matching = jobs.filter((job) => job.name === name);
    if (matching.length !== 1 || matching[0]!.head_sha !== sha || !settled(matching[0]!)) {
      return `check obrigatório ${name} não aprovado`;
    }
  }
  const blocking = jobs.filter((job) => !isNonBlocking(job));
  const stuck = blocking.filter((job) =>
    job.head_sha !== sha || job.status !== "completed" || !["success", "skipped"].includes(job.conclusion ?? ""));
  if (stuck.length > 0) return `job bloqueante sem sucesso: ${stuck.map((job) => job.name).join(", ")}`;
  if (run.status === "completed" && run.conclusion === "success") return null;
  const explained = jobs.some((job) => isNonBlocking(job) && !settled(job));
  return explained ? null : `execução ${run.status}/${run.conclusion} sem job não bloqueante que a explique`;
}

/**
 * Read-only: no event — CI, timer or dispatch — substitutes for these checks.
 * From the CI event, the newest run must also be the one that fired it.
 */
export function requireSourceCI(repository: string, sha: string, eventRunId?: number): number {
  requireSha(sha);
  const pages = ghApi<Array<{ workflow_runs: Run[] }>>(
    `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=dev&event=push&per_page=100`,
    ["--paginate", "--slurp"],
  );
  const runs = pages.flatMap((page) => page.workflow_runs).sort((a, b) => b.id - a.id);
  const run = runs[0];
  if (!run) throw new Error(`CI de dev ausente para ${sha}.`);
  if (
    run.head_sha !== sha || run.head_branch !== "dev" || run.event !== "push" ||
    run.path.split("@")[0] !== ".github/workflows/ci.yml" ||
    run.head_repository.full_name !== repository ||
    (eventRunId !== undefined && run.id !== eventRunId)
  ) throw new Error(`CI de dev não aprovado para ${sha}: run=${run.id} attempt=${run.run_attempt} status=${run.status} conclusion=${run.conclusion} eventRunId=${eventRunId ?? "nenhum"}.`);

  const jobs = ghApi<Array<{ jobs: Job[] }>>(
    `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
    ["--paginate", "--slurp"],
  ).flatMap((page) => page.jobs);
  const refusal = ciVerdict(run, jobs, sha);
  if (refusal) {
    throw new CIVerdictRefusal(`CI de dev não aprovado para ${sha}: ${refusal} (run=${run.id} attempt=${run.run_attempt} status=${run.status} conclusion=${run.conclusion}).`);
  }
  return run.id;
}
