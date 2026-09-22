import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig, fieldProblems } from "./cli.ts";
import { Coordinator } from "./coordinator.ts";
import { collectEventEvidence } from "./events.ts";
import { createGitHubGateway, requestGitHub } from "./github.ts";
import { commandBody, deliveryOf, hash, parseCommand } from "./protocol.ts";
import type { Command, ProjectConfig, TaskGateway } from "./types.ts";

export function eventOperationId(value: string): string {
  const digest = hash(value); return `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
}
export async function ensureIssueIncluded(gateway: TaskGateway, config: ProjectConfig, issue: number, coordinator: Coordinator): Promise<void> {
  if (issue === config.controlIssue) return;
  const { state } = await coordinator.control();
  if (state.paused) return;
  const snapshot = await gateway.readTask(issue, state.manualEpoch);
  let delivery: "dev" | "production" | "artifact" | "operation";
  try { delivery = deliveryOf(snapshot.issue.body); }
  catch {
    const selected = snapshot.issue.body.match(/### Entrega exigida\s+\n(dev|production|artifact|operation)\b/)?.[1];
    delivery = (selected as typeof delivery | undefined) ?? "production";
  }
  if (snapshot.itemId && snapshot.status && snapshot.type && snapshot.priority && snapshot.issue.body.includes("<!-- task-delivery:")) return;
  if (!snapshot.issue.assignees.length) {
    await requestGitHub("POST", `repos/${config.repository}/issues/${issue}/assignees`, { assignees: [config.owner] });
  }
  const current = await gateway.readTask(issue, state.manualEpoch);
  const operationId = eventOperationId(`adopt:${config.repository}:${issue}:${current.revision}`);
  const priority = snapshot.issue.body.match(/### Prioridade\s+\n(Crítica|Alta|Média|Baixa)\b/)?.[1] as "Crítica" | "Alta" | "Média" | "Baixa" | undefined;
  const type = snapshot.issue.body.match(/### Tipo\s+\n(feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert)\b/)?.[1];
  const command: Command = { protocolVersion: 1, operationId, action: "adopt", issue, expectedRevision: current.revision, adopt: { delivery, priority: priority ?? "Média", type: type ?? "chore" } };
  const inbox = await gateway.comments(config.controlIssue);
  if (!inbox.some(c => { try { return parseCommand(c.body)?.operationId === operationId; } catch { return false; } })) await gateway.comment(config.controlIssue, commandBody(command));
}
export async function assertTrustedRunner(config: ProjectConfig): Promise<string> {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== config.repository || process.env.PROJECTS_TOKEN_PRESENT !== "true" || !config.writerPublicKey || !process.env.TASKS_WRITER_PRIVATE_KEY) throw new Error("Writer runs only in the trusted repository Action with explicit Projects credential and writer signing key");
  const repo = await requestGitHub("GET", `repos/${config.repository}`) as { default_branch: string };
  if (repo.default_branch !== "main") throw new Error("Unexpected default branch");
  const checkedOut = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const main = await requestGitHub("GET", `repos/${config.repository}/commits/main`) as { sha: string };
  if (!await createGitHubGateway(config).containsCommit(checkedOut, main.sha)) throw new Error("Writer checkout does not belong to trusted main history");
  return checkedOut;
}
async function main(): Promise<void> {
  const config = await loadProjectConfig(process.cwd());
  const sha = await assertTrustedRunner(config);
  const gateway = createGitHubGateway(config);
  const coordinator = new Coordinator(gateway, config);
  const problems = fieldProblems(await gateway.fields());
  if (problems.length) throw new Error(problems.join(" "));
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, "utf8")) as Record<string, unknown>;
  const inputs = event.inputs as { mode?: string } | undefined;
  if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch" && inputs?.mode === "initialize") {
    await coordinator.initialize({ status: "ready", checkedAt: new Date().toISOString(), workflowRun: Number(process.env.GITHUB_RUN_ID), sha }, randomUUID());
    console.log("Writer bootstrap confirmed; enable enforcement only after the recorded pilot."); return;
  }
  // The durable inbox, rather than a workflow's queue position, defines ordering.
  await coordinator.drain();
  const issue = event.issue as { number?: number; pull_request?: unknown } | undefined;
  if (process.env.GITHUB_EVENT_NAME === "issues" && issue?.number && !issue.pull_request) await ensureIssueIncluded(gateway, config, issue.number, coordinator);
  if (["schedule", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME ?? "")) {
    // Recover issue-open events missed during a full/cancelled Actions queue.
    for (let page = 1; ; page++) {
      const issues = await requestGitHub("GET", `repos/${config.repository}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`) as { number: number; pull_request?: unknown }[];
      if (!Array.isArray(issues)) throw new Error("Incomplete issues page");
      for (const item of issues) if (!item.pull_request) await ensureIssueIncluded(gateway, config, item.number, coordinator);
      if (issues.length < 100) break;
    }
  }
  await coordinator.drain();
  const evidence = await collectEventEvidence(gateway, config, process.env.GITHUB_EVENT_NAME ?? "", event);
  for (const entry of evidence) {
    const marker = `<!-- tasks-event:${hash(entry.eventId)} -->`;
    const comments = await gateway.comments(entry.issue);
    if (comments.some(c => c.author === config.writerLogin && c.body.startsWith(marker))) continue;
    await gateway.comment(entry.issue, `${marker}\n${entry.message}\n\n${entry.suggestedStatus ? `Sugestão sujeita à revisão/claim atuais: **${entry.suggestedStatus}**.\n\n` : ""}${entry.evidence.map(url => `- ${url}`).join("\n")}\n\nO evento não substitui o aceite nem uma transição assinada pelo detentor.`);
  }
  console.log(JSON.stringify({ reconciled: coordinator.failures === 0, conflicts: coordinator.failures, evidence: evidence.length }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch(error => { console.error(error instanceof Error ? error.message : "Writer failed"); process.exitCode = 1; });
