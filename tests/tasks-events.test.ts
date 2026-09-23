import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectEventEvidence } from "../scripts/tasks/events.ts";
import { requestGitHub } from "../scripts/tasks/github.ts";
import { controlBody, snapshotRevision } from "../scripts/tasks/protocol.ts";
import type { ControlState, DeploymentEvidence, ProjectConfig, PullRequestEvidence, TaskGateway, TaskSnapshot } from "../scripts/tasks/types.ts";

vi.mock("../scripts/tasks/github.ts", () => ({ requestGitHub: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const repository = "andreustimm/master-jobs";
const web = `https://github.com/${repository}`;
const config: ProjectConfig = { protocolVersion: 1, repository, owner: "andreustimm", number: 3, projectId: "P3", controlIssue: 207, writerLogin: "andreustimm", workflow: "tasks-project.yml" };
const headSha = "b".repeat(40);
const mergeSha = "c".repeat(40);
const deploymentSha = "d".repeat(40);

function fixture() {
  const task: TaskSnapshot = {
    issue: { id: "I1", number: 1, url: `${web}/issues/1`, title: "Delivery", body: "<!-- task-delivery:dev -->", state: "OPEN", updatedAt: "2026-09-22T14:00:00Z", assignees: ["andreustimm"] },
    projectId: "P3", itemId: "PI1", status: "Em execução", priority: "Alta", type: "feat", startedAt: "2026-09-22", finishedAt: null,
    parent: null, dependencies: [], subIssues: [], linkedPullRequests: [31], manualEpoch: 0, coordinationCommentId: 2,
    coordination: { protocolVersion: 1, revision: 1, generation: 1, lastOperation: randomUUID(), execution: {
      executionId: randomUUID(), publicKey: "public-key", actor: "andreustimm", branch: "feat/task", worktreeId: "task", generation: 1,
      acquiredAt: "2026-09-22T13:00:00Z", heartbeatAt: "2026-09-22T14:00:00Z", expiresAt: "2026-09-22T16:00:00Z",
    } }, revision: "", fetchedAt: "2026-09-22T15:00:00Z",
  };
  const pr: PullRequestEvidence = { number: 31, url: `${web}/pull/31`, state: "OPEN", base: "dev", head: "feat/task", headSha, mergeSha: null, mergedAt: null, linkedIssues: [1], checksSuccessful: true };
  const control: ControlState = { protocolVersion: 1, paused: false, manualEpoch: 0, lastOperation: randomUUID() };
  let controlUpdatedAt = "2026-09-22T12:00:00Z";
  const deployment: DeploymentEvidence = { id: 42, sha: deploymentSha, ref: "main", environment: "Production", state: "success", url: null };
  const run = { id: 77, sha: headSha, branch: "feat/task", conclusion: "success" as string | null, url: `${web}/actions/runs/77`, name: "CI" };
  const smoke = { id: 88, sha: deploymentSha, branch: "main", conclusion: "success" as string | null, url: `${web}/actions/runs/88`, name: "Fumaça de produção" };
  const ciMetadata = { id: 77, repository: { full_name: repository }, head_repository: { full_name: repository }, head_sha: headSha, head_branch: "feat/task", run_attempt: 1, status: "completed", conclusion: "success", path: ".github/workflows/ci.yml", pull_requests: [{ number: 31 }], run_started_at: "2026-09-22T14:00:00Z" };
  const smokeMetadata = { ...ciMetadata, id: 88, head_sha: deploymentSha, head_branch: "main", path: ".github/workflows/fumaca-producao.yml" };
  // A main deployment SHA is associated with the human staging → main promotion;
  // the task PR (base dev) only appears inside that promotion's commits.
  const promotion: PullRequestEvidence = { number: 300, url: `${web}/pull/300`, state: "MERGED", base: "main", head: "staging", headSha: deploymentSha, mergeSha: deploymentSha, mergedAt: "2026-09-22T14:15:00Z", linkedIssues: [1], checksSuccessful: true };
  const associated = [{ number: 300 }];
  const promotionCommits: Array<{ commit: { message?: string } }> = [
    { commit: { message: "Merge pull request #31 from andreustimm/feat/task\n\nCloses #1" } },
    { commit: { message: "fix(tasks): unrelated change" } },
  ];
  const smokeRuns: Array<{ id: number; run_attempt: number }> = [{ id: 88, run_attempt: 1 }];
  const mutations = {
    comment: vi.fn(async () => { throw new Error("Events may not mutate issues"); }), updateComment: vi.fn(async () => { throw new Error("Events may not mutate comments"); }),
    patchTask: vi.fn(async () => { throw new Error("Events may not mutate Project fields"); }),
    createIssue: vi.fn(async () => { throw new Error("Events may not create issues"); }), addToProject: vi.fn(async () => { throw new Error("Events may not add items"); }),
    addSubIssue: vi.fn(async () => { throw new Error("Events may not alter relationships"); }), addDependency: vi.fn(async () => { throw new Error("Events may not alter relationships"); }),
  };
  const gateway = {
    ...mutations, identity: async () => config.writerLogin, permission: async () => "admin", fields: async () => [], findCreatedIssue: async () => null,
    comments: vi.fn(async () => [{ id: 1, body: controlBody(control), author: config.writerLogin, createdAt: "2026-09-22T12:00:00Z", updatedAt: controlUpdatedAt, url: `${web}/issues/207#issuecomment-1` }]),
    readTask: vi.fn(async (number: number) => {
      if (number !== 1) return { ...structuredClone(task), issue: { ...task.issue, number }, status: "Concluído" as const };
      const result = structuredClone(task); result.revision = snapshotRevision(result); return result;
    }),
    listProjectTasks: vi.fn(async () => { throw new Error("Events must not scan the Project"); }),
    pullRequest: vi.fn(async (number: number) => structuredClone(number === promotion.number ? promotion : pr)), deployment: vi.fn(async () => structuredClone(deployment)),
    containsCommit: vi.fn(async () => true), workflowRun: vi.fn(async (number: number) => structuredClone(number === 88 ? smoke : run)),
  } satisfies TaskGateway;
  vi.mocked(requestGitHub).mockImplementation(async (method, path) => {
    expect(method).toBe("GET");
    if (path === `repos/${repository}/actions/runs/77`) return structuredClone(ciMetadata);
    if (path === `repos/${repository}/actions/runs/88`) return structuredClone(smokeMetadata);
    if (path === `repos/${repository}/commits/${deploymentSha}/pulls?per_page=100&page=1`) return structuredClone(associated);
    const commitsPage = path.match(new RegExp(`^repos/${repository}/pulls/300/commits\\?per_page=100&page=(\\d+)$`));
    if (path === `repos/${repository}/issues/31`) return { number: 31, pull_request: { url: `${web}/pull/31` } };
    if (path === `repos/${repository}/issues/186`) return { number: 186 };
    if (path === `repos/${repository}/issues/999`) throw Object.assign(new Error("GitHub GET issues/999 failed"), { status: 404 });
    if (path === `repos/${repository}/issues/500`) throw Object.assign(new Error("GitHub GET issues/500 failed"), { status: 502 });
    if (commitsPage) { const page = Number(commitsPage[1]); return structuredClone(promotionCommits.slice((page - 1) * 100, page * 100)); }
    if (path === `repos/${repository}/actions/workflows/fumaca-producao.yml/runs?head_sha=${deploymentSha}&branch=main&per_page=100&page=1`) return { workflow_runs: structuredClone(smokeRuns) };
    throw new Error("Unexpected read-only metadata endpoint");
  });
  const prEvent = () => ({ repository: { full_name: repository }, action: "opened", number: 31, pull_request: { number: 31, updated_at: "2026-09-22T14:00:00Z", head: { sha: headSha, ref: "feat/task", repo: { full_name: repository } }, base: { ref: "dev" } } });
  const ciEvent = () => ({ repository: { full_name: repository }, action: "completed", workflow_run: structuredClone(ciMetadata) });
  const deployEvent = () => ({ repository: { full_name: repository }, deployment: { id: 42, sha: deploymentSha, created_at: "2026-09-22T14:20:00Z" }, deployment_status: { id: 900, state: "success" } });
  const production = () => { task.status = "Implantando"; task.issue.body = "<!-- task-delivery:production -->"; pr.state = "MERGED"; pr.mergeSha = mergeSha; pr.mergedAt = "2026-09-22T14:10:00Z"; };
  return { gateway, task, pr, promotion, promotionCommits, control, ciMetadata, smokeMetadata, smokeRuns, associated, deployment, run, smoke, mutations, prEvent, ciEvent, deployEvent, production, changeControlTime: (value: string) => { controlUpdatedAt = value; } };
}

describe("native events remain read-only evidence", () => {
  it("suggests the current valid stage for a linked PR and produces a stable event identity", async () => {
    const f = fixture();
    const first = await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent());
    expect(first).toHaveLength(1);
    expect(first[0]?.suggestedStatus).toBe("QA");
    expect(first[0]?.message).toContain("comando assinado");
    expect(first[0]?.evidence).toEqual([`${web}/pull/31`]);
    expect(await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent())).toEqual(first);
    for (const mutation of Object.values(f.mutations)) expect(mutation).not.toHaveBeenCalled();
    expect(f.gateway.listProjectTasks).not.toHaveBeenCalled();
  });

  it.each([
    ["HEAD antigo", (f: ReturnType<typeof fixture>) => { f.pr.headSha = "a".repeat(40); }],
    ["branch incompatível", (f: ReturnType<typeof fixture>) => { f.task.coordination!.execution!.branch = "feat/other"; }],
    ["sem detentor", (f: ReturnType<typeof fixture>) => { f.task.coordination!.execution = null; }],
    ["lease vencido", (f: ReturnType<typeof fixture>) => { f.task.coordination!.execution!.expiresAt = "2026-09-22T14:59:00Z"; }],
    ["época alterada", (f: ReturnType<typeof fixture>) => { f.task.manualEpoch = 1; }],
    ["controle pausado", (f: ReturnType<typeof fixture>) => { f.control.paused = true; }],
    ["evento anterior à posse", (f: ReturnType<typeof fixture>) => { f.task.coordination!.execution!.acquiredAt = "2026-09-22T14:30:00Z"; }],
    ["vínculo nativo ausente", (f: ReturnType<typeof fixture>) => { f.task.linkedPullRequests = []; }],
    ["checks pendentes", (f: ReturnType<typeof fixture>) => { f.pr.checksSuccessful = false; }],
    ["entrega ausente", (f: ReturnType<typeof fixture>) => { f.task.issue.body = "No contract"; }],
    ["terminal", (f: ReturnType<typeof fixture>) => { f.task.status = "Concluído"; }],
    ["bloqueada", (f: ReturnType<typeof fixture>) => { f.task.status = "Bloqueado"; }],
  ] as const)("records %s as ignored without suggesting a transition", async (_name, mutate) => {
    const f = fixture(); mutate(f);
    const [note] = await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent());
    expect(note?.suggestedStatus).toBeUndefined(); expect(note?.message).toContain("Ignorado para transição");
  });

  it("ignores events predating a manual intervention even when current epochs agree", async () => {
    const f = fixture(); f.control.manualEpoch = 1; f.task.manualEpoch = 1; f.changeControlTime("2026-09-22T14:30:00Z");
    const [note] = await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent());
    expect(note?.suggestedStatus).toBeUndefined(); expect(note?.message).toContain("intervenção manual");
  });

  it("does not discover tasks from arbitrary payload issue numbers or another repository", async () => {
    const f = fixture();
    expect(await collectEventEvidence(f.gateway, config, "pull_request", { ...f.prEvent(), repository: { full_name: "other/repo" } })).toEqual([]);
    expect(f.gateway.pullRequest).not.toHaveBeenCalled();
    f.pr.linkedIssues = [];
    expect(await collectEventEvidence(f.gateway, config, "pull_request", { ...f.prEvent(), issues: [1] })).toEqual([]);
    expect(f.gateway.readTask).not.toHaveBeenCalled();
  });

  it("distinguishes integration in dev from production and does not skip required stages", async () => {
    const f = fixture(); f.task.status = "Testando"; f.pr.state = "MERGED"; f.pr.mergeSha = mergeSha; f.pr.mergedAt = "2026-09-22T13:30:00Z";
    expect((await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent()))[0]?.suggestedStatus).toBe("Concluído");
    f.task.issue.body = "<!-- task-delivery:production -->";
    expect((await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent()))[0]?.suggestedStatus).toBe("Implantar");
    f.task.status = "Implantando";
    expect((await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent()))[0]?.suggestedStatus).toBeUndefined();
  });

  it("does not suggest completion with cancelled dependencies or unfinished children", async () => {
    const f = fixture(); f.task.status = "Testando"; f.pr.state = "MERGED"; f.pr.mergeSha = mergeSha; f.pr.mergedAt = "2026-09-22T13:30:00Z";
    f.task.dependencies = [{ number: 2, state: "CLOSED", status: "Cancelado" }];
    expect((await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent()))[0]?.suggestedStatus).toBeUndefined();
    f.task.dependencies = []; f.task.subIssues = [2];
    const original = f.gateway.readTask;
    f.gateway.readTask = vi.fn(async number => number === 2 ? { ...await original(2), status: "QA" } : original(number));
    expect((await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent()))[0]?.suggestedStatus).toBeUndefined();
  });

  it("drops its suggestion when task state changes before its independent read-back", async () => {
    const f = fixture(); const original = f.gateway.readTask; let reads = 0;
    f.gateway.readTask = vi.fn(async number => { if (++reads === 2) f.task.status = "Bloqueado"; return original(number); });
    const [note] = await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent());
    expect(note?.suggestedStatus).toBeUndefined(); expect(note?.message).toContain("mudou durante a leitura");
  });

  it("drops its suggestion when the writer is paused while evidence is being collected", async () => {
    const f = fixture(); const original = f.gateway.comments; let reads = 0;
    f.gateway.comments = vi.fn(async () => { if (++reads === 2) f.control.paused = true; return original(); });
    const [note] = await collectEventEvidence(f.gateway, config, "pull_request", f.prEvent());
    expect(note?.suggestedStatus).toBeUndefined(); expect(note?.message).toContain("mudou durante a leitura");
  });

  it("does not use a fork branch sharing the holder's branch name", async () => {
    const f = fixture(); const event = f.prEvent(); event.pull_request.head.repo.full_name = "fork/repo";
    const [note] = await collectEventEvidence(f.gateway, config, "pull_request", event);
    expect(note?.suggestedStatus).toBeUndefined(); expect(note?.message).toContain("Repositório de origem");
  });
});

describe("workflow run evidence", () => {
  it("rereads the current attempt and PR checks before suggesting the next valid stage", async () => {
    const f = fixture(); f.task.status = "QA";
    const [note] = await collectEventEvidence(f.gateway, config, "workflow_run", f.ciEvent());
    expect(note?.suggestedStatus).toBe("Testando");
    expect(note?.evidence).toEqual([`${web}/actions/runs/77`, `${web}/pull/31`]);
  });

  it.each(["attempt", "sha", "branch", "failure", "head_repository"] as const)("rejects stale or inapplicable workflow %s", async mismatch => {
    const f = fixture(); const event = f.ciEvent();
    if (mismatch === "attempt") f.ciMetadata.run_attempt = 2;
    if (mismatch === "sha") f.pr.headSha = "a".repeat(40);
    if (mismatch === "branch") f.run.branch = "feat/other";
    if (mismatch === "failure") f.ciMetadata.conclusion = "failure";
    if (mismatch === "head_repository") f.ciMetadata.head_repository.full_name = "fork/repo";
    const [note] = await collectEventEvidence(f.gateway, config, "workflow_run", event);
    expect(note?.suggestedStatus).toBeUndefined(); expect(note?.message).toContain("Ignorado para transição");
  });

  it("does not use a PR injected into the payload but absent from the current run", async () => {
    const f = fixture(); const event = f.ciEvent(); f.ciMetadata.pull_requests = [];
    expect(await collectEventEvidence(f.gateway, config, "workflow_run", event)).toEqual([]);
    expect(f.gateway.readTask).not.toHaveBeenCalled();
  });
});

describe("production evidence", () => {
  it("requires a current production deployment, merged claimed PR, ancestry and smoke on exactly one SHA", async () => {
    const f = fixture(); f.production();
    const [note] = await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent());
    expect(note?.suggestedStatus).toBe("Concluído");
    expect(note?.evidence).toEqual([`${web}/deployments/42`, `${web}/pull/31`, `${web}/actions/runs/88`]);
    expect(f.gateway.containsCommit).toHaveBeenCalledWith(mergeSha, deploymentSha);
    for (const mutation of Object.values(f.mutations)) expect(mutation).not.toHaveBeenCalled();
  });

  it.each([
    ["latest deployment failed", (f: ReturnType<typeof fixture>) => { f.deployment.state = "failure"; }],
    ["preview", (f: ReturnType<typeof fixture>) => { f.deployment.environment = "Preview"; }],
    ["unproven main ref", (f: ReturnType<typeof fixture>) => { f.deployment.ref = deploymentSha; }],
    ["earlier stage", (f: ReturnType<typeof fixture>) => { f.task.status = "Testando"; }],
    ["PR not merged", (f: ReturnType<typeof fixture>) => { f.pr.state = "OPEN"; }],
    ["merge before the task started", (f: ReturnType<typeof fixture>) => { f.pr.mergedAt = "2026-09-21T12:30:00Z"; }],
    ["smoke SHA mismatch", (f: ReturnType<typeof fixture>) => { f.smoke.sha = "a".repeat(40); }],
    ["smoke failed", (f: ReturnType<typeof fixture>) => { f.smoke.conclusion = "failure"; }],
    ["smoke rerun", (f: ReturnType<typeof fixture>) => { f.smokeMetadata.run_attempt = 2; }],
    ["wrong smoke workflow", (f: ReturnType<typeof fixture>) => { f.smokeMetadata.path = ".github/workflows/other.yml"; }],
  ] as const)("refuses completion for %s", async (_name, mutate) => {
    // Direct association keeps a note to inspect even when an invalid deployment
    // is not expanded through its promotion.
    const f = fixture(); f.production(); f.associated[0] = { number: 31 }; mutate(f);
    const [note] = await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent());
    expect(note?.suggestedStatus).toBeUndefined(); expect(note?.message).toContain("Ignorado para transição");
  });

  it.each([
    ["failed deployment", (f: ReturnType<typeof fixture>) => { f.deployment.state = "failure"; }],
    ["staging deployment", (f: ReturnType<typeof fixture>) => { f.deployment.environment = "Preview"; f.deployment.ref = "staging"; }],
    ["open promotion", (f: ReturnType<typeof fixture>) => { f.promotion.state = "OPEN"; }],
  ] as const)("does not expand the promotion for a %s", async (_name, mutate) => {
    const f = fixture(); f.production(); mutate(f);
    expect(await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent())).toEqual([]);
    expect(vi.mocked(requestGitHub).mock.calls.some(([, path]) => path.includes("/pulls/300/commits"))).toBe(false);
    expect(f.gateway.readTask).not.toHaveBeenCalled();
  });

  it("drops a subject that names an issue or a missing number without aborting the event", async () => {
    const f = fixture(); f.production();
    f.promotionCommits.push({ commit: { message: "docs: nota (#186)" } }, { commit: { message: "fix: antigo (#999)" } });
    const [note] = await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent());
    expect(note?.suggestedStatus).toBe("Concluído");
    expect(f.gateway.pullRequest).not.toHaveBeenCalledWith(186);
    expect(f.gateway.pullRequest).not.toHaveBeenCalledWith(999);
  });

  it("still fails loudly when a candidate lookup errors for another reason", async () => {
    const f = fixture(); f.production();
    f.promotionCommits.push({ commit: { message: "fix: instável (#500)" } });
    await expect(collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent())).rejects.toThrow("issues/500");
  });

  it("does not claim ancestry when a successful deployment contains another change", async () => {
    const f = fixture(); f.production(); f.gateway.containsCommit.mockResolvedValue(false);
    const [note] = await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent());
    expect(note?.suggestedStatus).toBeUndefined(); expect(note?.message).toContain("não contém");
  });

  it("resolves the task PR through the staging → main promotion, never the promotion itself", async () => {
    const f = fixture(); f.production();
    const notes = await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent());
    expect(notes).toHaveLength(1);
    expect(notes[0]?.evidence).not.toContain(`${web}/pull/300`);
    expect(f.gateway.pullRequest).toHaveBeenCalledWith(300);
    expect(f.gateway.pullRequest).toHaveBeenCalledWith(31);
    expect(f.gateway.listProjectTasks).not.toHaveBeenCalled();
  });

  it("also reads squash subjects and ignores commits without a message", async () => {
    const f = fixture(); f.production();
    f.promotionCommits.splice(0, f.promotionCommits.length, { commit: { message: "feat(tasks): entrega (#31)" } }, { commit: {} });
    const [note] = await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent());
    expect(note?.suggestedStatus).toBe("Concluído");
  });

  it("still accepts a dev PR associated directly with the deployed SHA", async () => {
    const f = fixture(); f.production(); f.associated[0] = { number: 31 };
    const [note] = await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent());
    expect(note?.suggestedStatus).toBe("Concluído");
  });

  it("treats a commit message only as a hint and drops candidates that did not target dev", async () => {
    const f = fixture(); f.production(); f.pr.base = "main";
    expect(await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent())).toEqual([]);
    expect(f.gateway.readTask).not.toHaveBeenCalled();
  });

  it("demands reconciliation when the promotion exceeds the commits GitHub lists", async () => {
    const f = fixture(); f.production();
    f.promotionCommits.push(...Array.from({ length: 248 }, (_, index) => ({ commit: { message: `chore: filler ${index}` } })));
    await expect(collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent())).rejects.toThrow("explicit reconciliation");
  });

  it("returns no task conclusion if promotion metadata does not expose native issue links", async () => {
    const f = fixture(); f.production(); f.associated.length = 0;
    expect(await collectEventEvidence(f.gateway, config, "deployment_status", f.deployEvent())).toEqual([]);
    expect(f.gateway.listProjectTasks).not.toHaveBeenCalled();
    expect(f.gateway.readTask).not.toHaveBeenCalled();
  });
});
