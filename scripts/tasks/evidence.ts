import { deliveryOf } from "./protocol.ts";
import type { Command, ProjectConfig, TaskGateway, TaskSnapshot } from "./types.ts";

// A production delivery waits days for the human staging → main promotion, far
// beyond one 90-minute lease, so the holder is replaced by reclaim or transfer
// before the deploy lands. The merge still belongs to this task if it happened
// after the first claim ("Iniciado em"); the current lease start is only the
// fallback for a task that never recorded one.
export function deliveryWindowStart(task: TaskSnapshot): number {
  const acquired = Date.parse(task.coordination!.execution!.acquiredAt);
  const started = task.startedAt ? Date.parse(task.startedAt) : Number.NaN;
  return Number.isFinite(started) ? Math.min(started, acquired) : acquired;
}

export async function validateEvidence(gateway: TaskGateway, config: ProjectConfig, task: TaskSnapshot, command: Command): Promise<void> {
  if (command.action !== "transition" || command.status === "Cancelado") return;
  const urls = command.evidence ?? [];
  const parsed = urls.map(value => new URL(value));
  if (parsed.some(url => url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(`/${config.repository}/`))) throw new Error("Evidence must be a GitHub URL in the canonical repository");
  const prs = await Promise.all(parsed.flatMap(url => { const match = url.pathname.match(/\/pull\/(\d+)$/); return match ? [gateway.pullRequest(Number(match[1]))] : []; }));
  const relevant = prs.filter(pr => pr.linkedIssues.includes(task.issue.number) && pr.head === task.coordination?.execution?.branch && pr.base === "dev");
  if (["QA", "Testando", "Implantar", "Implantando", "Concluído"].includes(command.status ?? "") && ["dev", "production"].includes(deliveryOf(task.issue.body))) {
    if (!relevant.length) throw new Error("Evidence needs a native linked PR from the claimed branch into dev");
    if (["Testando", "Implantar", "Implantando", "Concluído"].includes(command.status ?? "") && !relevant.every(pr => pr.checksSuccessful)) throw new Error("The current PR head does not have successful checks");
  }
  if (command.status !== "Concluído") return;
  // A canceled child is not an accepted deliverable. The issue must explain a scope
  // change and remove that dependency explicitly before the parent can conclude.
  for (const number of [...new Set([...task.subIssues, ...task.dependencies.map(d => d.number)])]) {
    const child = await gateway.readTask(number, task.manualEpoch);
    if (child.status !== "Concluído") throw new Error(`Required child/dependency #${number} is not Concluído`);
  }
  const delivery = deliveryOf(task.issue.body);
  const delivered = relevant.filter(pr => pr.state === "MERGED" && pr.mergedAt && pr.mergeSha && Date.parse(pr.mergedAt) >= deliveryWindowStart(task));
  if (delivery === "dev" || delivery === "production") {
    if (!delivered.length) throw new Error("Dev delivery requires a merged, linked PR with checks on its current head, delivered after this task's first claim");
  }
  if (delivery === "production") {
    const deployments = await Promise.all(parsed.flatMap(url => { const match = url.pathname.match(/\/deployments\/(\d+)$/); return match ? [gateway.deployment(Number(match[1]))] : []; }));
    const runs = await Promise.all(parsed.flatMap(url => { const match = url.pathname.match(/\/actions\/runs\/(\d+)$/); return match ? [gateway.workflowRun(Number(match[1]))] : []; }));
    if (!gateway.latestWorkflowRun) throw new Error("The gateway must verify the latest production smoke run");
    const latest = await Promise.all([...new Set(runs.map(run => run.sha))].map(sha => gateway.latestWorkflowRun!(".github/workflows/fumaca-producao.yml", sha)));
    const production = deployments.filter(d => d.state === "success" && d.environment.toLowerCase() === "production" && (d.ref === "main" || d.ref === "refs/heads/main" || d.ref === d.sha));
    const chains = production.flatMap(deployment => delivered.flatMap(pr => runs.filter(run => latest.some(current => current?.id === run.id && current.attempt === run.attempt && current.conclusion === "success") && run.sha === deployment.sha && run.branch === "main" && run.conclusion === "success" && run.name === "Fumaça em produção" && run.path === ".github/workflows/fumaca-producao.yml" && Number.isInteger(run.attempt) && run.attempt! >= 1 && Date.parse(run.createdAt ?? "") >= Date.parse(pr.mergedAt!)).map(() => ({ deployment, pr }))));
    if (!chains.length) throw new Error("Production needs a successful main deployment and the production smoke run for exactly that SHA");
    const ancestry = await Promise.all(chains.map(({ pr, deployment }) => gateway.containsCommit(pr.mergeSha!, deployment.sha)));
    if (!ancestry.some(Boolean)) throw new Error("Production SHA does not contain the delivered PR");
  }
  if (delivery === "artifact" || delivery === "operation") {
    if (!command.reason) throw new Error("Artifact/operation acceptance needs a reason naming the observable result");
    const accepted = parsed.some(url => url.pathname === `/${config.repository}/issues/${task.issue.number}` && /^#issuecomment-\d+$/.test(url.hash));
    if (!accepted) throw new Error("Artifact/operation acceptance needs an acceptance comment on this issue");
    const ids = parsed.filter(url => url.pathname === `/${config.repository}/issues/${task.issue.number}`).map(url => Number(url.hash.replace("#issuecomment-", "")));
    const comments = await gateway.comments(task.issue.number);
    if (!comments.some(c => ids.includes(c.id) && task.issue.assignees.includes(c.author) && c.body.includes("Entrega aceita:"))) throw new Error("Acceptance must be recorded by an assignee with 'Entrega aceita:' and its evidence");
  }
}
