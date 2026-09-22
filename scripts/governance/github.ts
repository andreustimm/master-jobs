import { deliverySchema, POLICY, type Delivery } from "./model.ts";

const REPO = "andreustimm/master-jobs";
const DAY = 86_400_000;
type Deployment = { id: number; sha: string; created_at: string; creator: { login: string }; environment: string; task: string };
type Status = { state: string; created_at: string };
type Commit = { sha: string; commit: { committer: { date: string } } };

export function confirmFirstMonitorRun(currentRunId: string | undefined, gh: <T>(path: string) => T): void {
  const runs = gh<{ workflow_runs: { id: number; head_branch: string; run_attempt: number }[] }>(
    `repos/${REPO}/actions/workflows/governanca.yml/runs?branch=main&per_page=2`,
  ).workflow_runs;
  if (!currentRunId || runs.length !== 1 || String(runs[0]!.id) !== currentRunId || runs[0]!.head_branch !== "main" || runs[0]!.run_attempt !== 1)
    throw new Error("Monitor já executado ou primeira execução não confirmada; recuperar o histórico antes de retomar.");
}

export function collectDelivery(now: Date, gh: <T>(path: string) => T): Delivery {
  const since = now.getTime() - POLICY.windowDays * DAY;
  const deployments: Delivery["deployments"] = [];
  const seen = new Set<number>();
  let complete = false;
  // Ambiente "production" também é usado pela varredura do Actions. Somente a
  // integração Vercel publica os deployments de código que medimos aqui.
  for (let page = 1; page <= 20; page++) {
    const rows = gh<Deployment[]>(`repos/${REPO}/deployments?environment=Production&per_page=100&page=${page}`);
    for (const d of rows) {
      if (d.creator.login !== "vercel[bot]" || d.environment.toLowerCase() !== "production" || d.task !== "deploy") continue;
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const statuses: Status[] = [];
      let statusesComplete = false;
      for (let statusPage = 1; statusPage <= 20; statusPage++) {
        const batch = gh<Status[]>(`repos/${REPO}/deployments/${d.id}/statuses?per_page=100&page=${statusPage}`);
        statuses.push(...batch);
        if (batch.length < 100) { statusesComplete = true; break; }
      }
      if (!statusesComplete) throw new Error("Paginação de status incompleta; métricas não publicadas.");
      const successful = statuses.filter(s => s.state === "success").sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
      if (successful) deployments.push({ id: d.id, sha: d.sha, at: successful.created_at, commits: null });
    }
    // Guardar ao menos um deployment anterior à janela para calcular o delta
    // do primeiro incluído. Uma página truncada nunca vira uma contagem válida.
    if (rows.length < 100 || deployments.some(d => Date.parse(d.at) <= since)) { complete = true; break; }
  }
  if (!complete) throw new Error("Paginação de deployments incompleta; métricas não publicadas.");
  deployments.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (let i = 1; i < deployments.length; i++) {
    const current = deployments[i]!;
    if (Date.parse(current.at) <= since) continue;
    const previous = deployments[i - 1]!;
    const commits: NonNullable<typeof current.commits> = [];
    let comparisonComplete = false;
    for (let page = 1; page <= 20; page++) {
      const diff = gh<{ status: string; total_commits: number; commits: Commit[] }>(
        `repos/${REPO}/compare/${previous.sha}...${current.sha}?per_page=100&page=${page}`,
      );
      // Rollback/divergência precisa de análise; não registrar latência zero.
      if (!["ahead", "identical"].includes(diff.status)) break;
      commits.push(...diff.commits.map(c => ({ sha: c.sha, at: c.commit.committer.date })));
      if (commits.length === diff.total_commits) { comparisonComplete = true; break; }
      if (!diff.commits.length) break;
    }
    current.commits = comparisonComplete ? commits : null;
  }
  return deliverySchema.parse({ collectedAt: now.toISOString(), deployments: deployments.filter(d => Date.parse(d.at) > since) });
}
