import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig } from "./cli.ts";
import { createGitHubGateway, requestGitHub } from "./github.ts";
import type { PullRequestEvidence, TaskSnapshot } from "./types.ts";

export function checkTaskPullRequest(pr: PullRequestEvidence, tasks: TaskSnapshot[], assignees: string[], now: Date): string[] {
  const errors: string[] = [];
  if (!assignees.length) errors.push("PR needs an assignee");
  if (pr.base === "main" && pr.head === "staging") return errors; // Promotion remains human.
  if (pr.base === "dev" && pr.head === "main") return errors; // Existing post-main return workflow.
  if (pr.base !== "dev") errors.push("Task PRs must target dev");
  if (!pr.linkedIssues.length || tasks.length !== pr.linkedIssues.length || new Set(tasks.map(t => t.issue.number)).size !== tasks.length || tasks.some(t => !pr.linkedIssues.includes(t.issue.number))) errors.push("PR needs native issue links; use closing keywords or Development sidebar");
  for (const task of tasks) {
    const execution = task.coordination?.execution;
    if (!task.itemId || !task.status) errors.push(`#${task.issue.number} is outside the Project`);
    if (!task.linkedPullRequests.includes(pr.number)) errors.push(`#${task.issue.number} does not confirm the native PR link`);
    if (!execution || execution.branch !== pr.head || !task.issue.assignees.includes(execution.actor) || execution.generation !== task.coordination?.generation || !Number.isFinite(Date.parse(execution.expiresAt)) || Date.parse(execution.expiresAt) <= now.getTime()) errors.push(`#${task.issue.number} lacks a valid claim for this branch`);
    if (["Concluído", "Cancelado", "Bloqueado"].includes(task.status ?? "") || task.issue.state !== "OPEN") errors.push(`#${task.issue.number} is not available for integration`);
    if (task.dependencies.some(d => d.status !== "Concluído")) errors.push(`#${task.issue.number} has unfinished dependencies`);
  }
  return errors;
}
async function main(): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("The PR gate runs on trusted CI code");
  const config = await loadProjectConfig(process.cwd());
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, "utf8")) as { pull_request?: { number: number } };
  if (!event.pull_request) throw new Error("PR event required");
  const gateway = createGitHubGateway(config);
  const pr = await gateway.pullRequest(event.pull_request.number);
  const raw = await requestGitHub("GET", `repos/${config.repository}/pulls/${pr.number}`) as { assignees: { login: string }[]; head: { repo: { full_name: string } }; base: { repo: { full_name: string } } };
  if (raw.head.repo.full_name !== config.repository || raw.base.repo.full_name !== config.repository) throw new Error("Fork PRs require explicit issue adoption by a repository maintainer");
  const tasks = await Promise.all(pr.linkedIssues.map(number => gateway.readTask(number)));
  const errors = checkTaskPullRequest(pr, tasks, raw.assignees.map(a => a.login), new Date());
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Native issues, Project membership, dependencies and current branch claims verified.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch(error => { console.error(error instanceof Error ? error.message : "Task gate failed"); process.exitCode = 1; });
