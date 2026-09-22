import { execFileSync } from "node:child_process";

export const REQUIRED_CI_JOBS = ["qualidade", "schema-e-migracao"] as const;

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

/** Read-only: neither dispatch nor a successful event substitutes for these checks. */
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
    run.status !== "completed" || run.conclusion !== "success" ||
    (eventRunId !== undefined && run.id !== eventRunId)
  ) throw new Error(`CI de dev não aprovado para ${sha}: run=${run.id} attempt=${run.run_attempt} status=${run.status} conclusion=${run.conclusion} eventRunId=${eventRunId ?? "manual"}.`);

  const jobs = ghApi<Array<{ jobs: Job[] }>>(
    `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
    ["--paginate", "--slurp"],
  ).flatMap((page) => page.jobs);
  for (const name of REQUIRED_CI_JOBS) {
    const matching = jobs.filter((job) => job.name === name);
    if (matching.length !== 1 || matching[0]!.head_sha !== sha ||
      matching[0]!.status !== "completed" || matching[0]!.conclusion !== "success") {
      throw new Error(`Check obrigatório ${name} não aprovado para ${sha}: run=${run.id} attempt=${run.run_attempt}.`);
    }
  }
  return run.id;
}
