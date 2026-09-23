import { expect, it, vi } from "vitest";
import { validateEvidence } from "../scripts/tasks/evidence.ts";
import type { Command, Delivery, DeploymentEvidence, ProjectConfig, PullRequestEvidence, RemoteComment, TaskGateway, TaskSnapshot } from "../scripts/tasks/types.ts";

const repository = "owner/repo";
const web = `https://github.com/${repository}`;
const config: ProjectConfig = { protocolVersion: 1, repository, owner: "owner", number: 3, projectId: "PVT_3", controlIssue: 1, writerLogin: "writer", workflow: "tasks.yml" };
const mergeSha = "a".repeat(40), productionSha = "b".repeat(40), headSha = "c".repeat(40);

function task(delivery: Delivery, number = 10): TaskSnapshot {
  return {
    issue: { id: `I_${number}`, number, url: `${web}/issues/${number}`, title: `Task ${number}`, body: `Scope\n<!-- task-delivery:${delivery} -->`, state: "OPEN", updatedAt: "2026-09-22T12:00:00.000Z", assignees: ["owner"] },
    projectId: config.projectId, itemId: `ITEM_${number}`, status: "Implantando", priority: "Alta", type: "feat", startedAt: "2026-09-22", finishedAt: null,
    parent: null, dependencies: [], subIssues: [], linkedPullRequests: [20], coordinationCommentId: 50, manualEpoch: 0,
    coordination: { protocolVersion: 1, revision: 1, generation: 1, lastOperation: "22222222-2222-4222-8222-222222222222", execution: {
      executionId: "11111111-1111-4111-8111-111111111111", publicKey: "public-key", actor: "owner", branch: "feat/task", worktreeId: "task", generation: 1,
      acquiredAt: "2026-09-22T10:00:00.000Z", heartbeatAt: "2026-09-22T11:59:00.000Z", expiresAt: "2026-09-22T13:00:00.000Z",
    } },
    revision: "d".repeat(64), fetchedAt: "2026-09-22T12:00:00.000Z",
  };
}

function fixture(delivery: Delivery) {
  const issue = task(delivery);
  const pr: PullRequestEvidence = { number: 20, url: `${web}/pull/20`, state: "MERGED", base: "dev", head: "feat/task", headSha, mergeSha, mergedAt: "2026-09-22T11:00:00.000Z", linkedIssues: [10], checksSuccessful: true };
  const deployment: DeploymentEvidence = { id: 30, sha: productionSha, ref: productionSha, environment: "Production", state: "success", url: "https://production.example.test" };
  const run = { id: 40, sha: productionSha, branch: "main", conclusion: "success", url: `${web}/actions/runs/40`, name: "Fumaça em produção",
    path: ".github/workflows/fumaca-producao.yml", attempt: 1, createdAt: "2026-09-22T11:30:00.000Z" };
  const comments: RemoteComment[] = [];
  const children = new Map<number, TaskSnapshot>();
  const gateway = {
    pullRequest: vi.fn(async (number: number) => { if (number !== pr.number) throw new Error("Unexpected PR read"); return pr; }),
    deployment: vi.fn(async (id: number) => { if (id !== deployment.id) throw new Error("Unexpected deployment read"); return deployment; }),
    workflowRun: vi.fn(async (id: number) => { if (id !== run.id) throw new Error("Unexpected workflow read"); return run; }),
    latestWorkflowRun: vi.fn(async () => run),
    containsCommit: vi.fn(async () => true),
    readTask: vi.fn(async (number: number) => { const child = children.get(number); if (!child) throw new Error("Unexpected child read"); return child; }),
    comments: vi.fn(async () => comments),
  } as unknown as TaskGateway;
  const command: Command = { protocolVersion: 1, operationId: "33333333-3333-4333-8333-333333333333", action: "transition", issue: 10,
    expectedRevision: issue.revision, execution: issue.coordination!.execution!, status: "Concluído", evidence: [pr.url], reason: "Entrega observável validada" };
  return { issue, pr, deployment, run, comments, children, gateway, command };
}

it("does not complete a production task merely because its PR merged into dev", async () => {
  const f = fixture("production");
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
  expect(f.gateway.containsCommit).not.toHaveBeenCalled();
});

it("accepts dev delivery only from the claimed branch's native linked, merged PR", async () => {
  const f = fixture("dev");
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).resolves.toBeUndefined();
  f.pr.linkedIssues = [11];
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("native linked PR");
  f.pr.linkedIssues = [10]; f.pr.head = "feat/another-execution";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("native linked PR");
  f.pr.head = "feat/task"; f.pr.base = "main";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("native linked PR");
});

it("rejects a previously green PR when the current head no longer has successful checks", async () => {
  const f = fixture("dev"); f.pr.headSha = "e".repeat(40); f.pr.checksSuccessful = false;
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("current PR head");
});

it("requires proof of the merge, including merge SHA and merged timestamp", async () => {
  const f = fixture("dev"); f.pr.state = "OPEN"; f.pr.mergeSha = null; f.pr.mergedAt = null;
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("merged, linked PR");
});

it("does not reuse a merge delivered before this task was first claimed", async () => {
  const f = fixture("dev"); f.pr.mergedAt = "2026-09-21T11:00:00.000Z";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("after this task's first claim");
});

it("keeps the task's own merge valid after the lease was reclaimed while waiting for promotion", async () => {
  const f = fixture("dev"); f.issue.coordination!.execution!.acquiredAt = "2026-09-22T11:45:00.000Z";
  f.issue.coordination!.firstClaimedAt = "2026-09-22T10:00:00.000Z";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).resolves.toBeUndefined();
  delete f.issue.coordination!.firstClaimedAt;
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("after this task's first claim");
});

it("does not widen the window to midnight because \"Iniciado em\" only stores the date", async () => {
  // Merge at 09:00 UTC, claim at 10:00 UTC on the same day: the DATE field reads as
  // 00:00 and used to admit a merge that predates the claim.
  const f = fixture("dev"); f.pr.mergedAt = "2026-09-22T09:00:00.000Z";
  expect(f.issue.startedAt).toBe("2026-09-22");
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("after this task's first claim");
  f.issue.coordination!.firstClaimedAt = "2026-09-22T10:00:00.000Z";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("after this task's first claim");
  f.issue.coordination!.firstClaimedAt = "2026-09-22T08:30:00.000Z";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).resolves.toBeUndefined();
});

it("does not count a canceled, closed child as an accepted deliverable", async () => {
  const f = fixture("dev"); f.issue.subIssues = [11];
  const child = task("dev", 11); child.status = "Cancelado"; child.issue.state = "CLOSED"; child.issue.stateReason = "NOT_PLANNED";
  f.children.set(11, child);
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("#11 is not Concluído");
  child.status = "Concluído"; child.issue.stateReason = "COMPLETED";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).resolves.toBeUndefined();
  expect(f.gateway.readTask).toHaveBeenCalledWith(11, f.issue.manualEpoch);
});

it("rereads dependency delivery instead of trusting the parent's cached dependency state", async () => {
  const f = fixture("dev"); f.issue.dependencies = [{ number: 11, state: "CLOSED", status: "Concluído" }];
  const dependency = task("dev", 11); dependency.status = "Bloqueado";
  f.children.set(11, dependency);
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("#11 is not Concluído");
});

it("accepts the real Vercel shape with SHA ref and Production only after same-SHA main smoke and ancestry", async () => {
  const f = fixture("production"); f.command.evidence!.push(`${web}/deployments/30`, f.run.url);
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).resolves.toBeUndefined();
  expect(f.gateway.containsCommit).toHaveBeenCalledWith(mergeSha, productionSha);
});

it("rejects a successful smoke from another SHA or branch", async () => {
  const f = fixture("production"); f.command.evidence!.push(`${web}/deployments/30`, f.run.url);
  f.run.sha = "f".repeat(40);
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("exactly that SHA");
  f.run.sha = productionSha; f.run.branch = "staging";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("exactly that SHA");
  expect(f.gateway.containsCommit).not.toHaveBeenCalled();
});

it("requires the trusted production smoke workflow instead of a similarly named workflow", async () => {
  const f = fixture("production"); f.command.evidence!.push(`${web}/deployments/30`, f.run.url);
  f.run.name = "Fumaça de uma tarefa qualquer";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
  f.run.name = "Fumaça em produção"; f.run.path = ".github/workflows/untrusted-smoke.yml";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
});

it("rejects smoke results that predate the delivered merge or lack a valid run attempt", async () => {
  const f = fixture("production"); f.command.evidence!.push(`${web}/deployments/30`, f.run.url);
  f.run.createdAt = "2026-09-22T10:30:00.000Z";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
  f.run.createdAt = "2026-09-22T11:30:00.000Z"; f.run.attempt = 0;
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
  f.run.attempt = 1; f.run.conclusion = "failure";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
});

it("rejects a production deployment that does not contain the delivered PR", async () => {
  const f = fixture("production"); f.command.evidence!.push(`${web}/deployments/30`, f.run.url);
  vi.mocked(f.gateway.containsCommit).mockResolvedValue(false);
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("does not contain");
});
it("rejects an old green smoke when the latest run for that SHA failed", async () => {
  const f = fixture("production"); f.command.evidence!.push(`${web}/deployments/30`, f.run.url);
  vi.mocked(f.gateway.latestWorkflowRun!).mockResolvedValue({ ...f.run, id: 41, conclusion: "failure", createdAt: "2026-09-22T11:45:00.000Z" });
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
});

it("does not combine a current merge with production evidence that only contains a previous execution's merge", async () => {
  const f = fixture("production");
  const previousMerge = "e".repeat(40);
  const previousPr: PullRequestEvidence = { ...f.pr, number: 21, url: `${web}/pull/21`, mergeSha: previousMerge, mergedAt: "2026-09-21T11:00:00.000Z" };
  vi.mocked(f.gateway.pullRequest).mockImplementation(async (number) => number === 20 ? f.pr : previousPr);
  vi.mocked(f.gateway.containsCommit).mockImplementation(async (ancestor) => ancestor === previousMerge);
  f.run.createdAt = "2026-09-22T10:30:00.000Z";
  f.command.evidence!.push(previousPr.url, `${web}/deployments/30`, f.run.url);
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow();
});

it("refuses preview, failed, and non-main branch deployments", async () => {
  const f = fixture("production"); f.command.evidence!.push(`${web}/deployments/30`, f.run.url);
  f.deployment.environment = "Preview";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
  f.deployment.environment = "Production"; f.deployment.state = "failure";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
  f.deployment.state = "success"; f.deployment.ref = "feat/task";
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Production needs");
});

it("requires acceptance on this issue by an assignee for artifacts and operational tasks", async () => {
  for (const delivery of ["artifact", "operation"] as const) {
    const f = fixture(delivery); f.command.evidence = [`${web}/issues/10#issuecomment-60`];
    f.comments.push({ id: 60, body: "Entrega aceita: relatório conferido e resultado observável registrado.", author: "someone-else", createdAt: "2026-09-22T11:30:00.000Z", updatedAt: "2026-09-22T11:30:00.000Z", url: f.command.evidence[0]! });
    await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("assignee");
    f.comments[0]!.author = "owner";
    await expect(validateEvidence(f.gateway, config, f.issue, f.command)).resolves.toBeUndefined();
    f.command.evidence = [`${web}/issues/11#issuecomment-60`];
    await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("on this issue");
  }
});

it("does not treat an arbitrary assignee comment or an external URL as acceptance", async () => {
  const f = fixture("artifact"); f.command.evidence = [`${web}/issues/10#issuecomment-60`];
  f.comments.push({ id: 60, body: "Ainda falta validar o resultado.", author: "owner", createdAt: "2026-09-22T11:30:00.000Z", updatedAt: "2026-09-22T11:30:00.000Z", url: f.command.evidence[0]! });
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("Entrega aceita:");
  f.command.evidence = ["https://github.com/other/repo/issues/10#issuecomment-60"];
  await expect(validateEvidence(f.gateway, config, f.issue, f.command)).rejects.toThrow("canonical repository");
});
