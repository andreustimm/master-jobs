import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { activationProblems, fieldProblems, inspectWorkspace, runCli, signExecutionCommand, submitIntent, trustedControl, verifyOwnership } from "../scripts/tasks/cli.ts";
import type { CliRuntime, WriterReadiness } from "../scripts/tasks/cli.ts";
import { commandBody, commandHash, controlBody, parseCommand, receiptBody } from "../scripts/tasks/protocol.ts";
import { signCommand, verifyCommandSignature } from "../scripts/tasks/signing.ts";
import { STATUSES } from "../scripts/tasks/types.ts";
import type { Command, ControlState, ProjectConfig, ProjectField, Receipt, RemoteComment, TaskGateway, TaskSnapshot, WorkspaceContext } from "../scripts/tasks/types.ts";

const executionId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const config: ProjectConfig = { protocolVersion: 1, repository: "owner/repo", owner: "owner", number: 3, projectId: "PVT_3", controlIssue: 1, writerLogin: "writer", workflow: "tasks.yml" };
const now = Date.parse("2026-09-22T12:00:00.000Z");
const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const workspace: WorkspaceContext = { executionId, publicKey, branch: "feat/task", worktreeId: "task" };
const control: ControlState = { protocolVersion: 1, paused: false, manualEpoch: 2, lastOperation: operationId,
  activation: { status: "ready", checkedAt: new Date(now).toISOString(), workflowRun: 50, sha: "a".repeat(40) } };
const readiness: WriterReadiness = { defaultBranch: "main", workflowState: "active", writerEnabled: "true", enforcement: "true",
  activationRun: { conclusion: "success", branch: "main", sha: "a".repeat(40), sameWorkflow: true } };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function comment(body: string, author = "owner", id = 10): RemoteComment {
  return { id, body, author, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), url: `https://github.com/owner/repo/issues/1#issuecomment-${id}` };
}

function snapshot(): TaskSnapshot {
  return {
    issue: { id: "I_10", number: 10, url: "https://github.com/owner/repo/issues/10", title: "Task", body: "Scope", state: "OPEN", updatedAt: new Date(now).toISOString(), assignees: ["owner"] },
    projectId: config.projectId, itemId: "ITEM_10", status: "Em execução", priority: "Alta", type: "Feature", startedAt: null, finishedAt: null,
    parent: null, dependencies: [], subIssues: [], linkedPullRequests: [],
    coordination: { protocolVersion: 1, revision: 1, generation: 1, lastOperation: operationId,
      execution: { ...workspace, generation: 1, actor: "owner", acquiredAt: new Date(now - 1_000).toISOString(), heartbeatAt: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString() } },
    coordinationCommentId: 20, manualEpoch: 2, revision: "b".repeat(64), fetchedAt: new Date(now).toISOString(),
  };
}

function fields(): ProjectField[] {
  const options = (names: readonly string[]) => names.map((name, index) => ({ id: `${index}`, name, color: "GRAY", description: "" }));
  return [
    { id: "S", name: "Status", dataType: "SINGLE_SELECT", options: options(STATUSES).map((option, index) => ({ ...option, color: ["PURPLE", "GRAY", "RED", "BLUE", "ORANGE", "YELLOW", "PINK", "PURPLE", "GREEN", "GRAY"][index]! })) },
    { id: "P", name: "Prioridade", dataType: "SINGLE_SELECT", options: options(["Crítica", "Alta", "Média", "Baixa"]) },
    { id: "T", name: "Tipo", dataType: "SINGLE_SELECT", options: options(["feat", "fix", "docs", "chore", "refactor", "test", "perf", "ci", "build", "style", "revert"]) },
    { id: "B", name: "Iniciado em", dataType: "DATE" }, { id: "E", name: "Concluído em", dataType: "DATE" },
  ];
}

function fixture() {
  let clock = now;
  const comments = [comment(controlBody(control), "writer", 1)];
  const task = snapshot();
  const output: string[] = [], errors: string[] = [];
  const gateway = {
    identity: vi.fn(async () => "owner"), permission: vi.fn(async () => "admin"), fields: vi.fn(async () => fields()),
    readTask: vi.fn(async () => task), comments: vi.fn(async () => [...comments]),
    comment: vi.fn(async (_issue: number, body: string) => { const created = comment(body, "owner", 10 + comments.length); comments.push(created); return created; }),
  } as unknown as TaskGateway;
  const runtime: CliRuntime = {
    config, gateway, cwd: process.cwd(), now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; },
    workspace: async (requested) => ({ ...workspace, executionId: requested }), sign: async (command) => signCommand(command, privateKey),
    readiness: async () => readiness, output: (message) => output.push(message), error: (message) => errors.push(message),
  };
  return { runtime, comments, task, output, errors, gateway };
}

function claim(): Command {
  return signCommand({ protocolVersion: 1, operationId, action: "claim", issue: 10, expectedRevision: "b".repeat(64), execution: workspace }, privateKey);
}

function receipt(command: Command, requestId: number, phase: Receipt["phase"] = "confirmed"): Receipt {
  return { protocolVersion: 1, operationId: command.operationId, commandHash: commandHash(command), requestId, issue: command.issue,
    phase, actor: "owner", message: phase, at: new Date(now).toISOString(), result: { issue: command.issue, revision: "c".repeat(64) } };
}

it("persists an intent without claiming success and reuses it after the writer confirms", async () => {
  const f = fixture(); const command = claim();
  const first = await submitIntent(command, f.runtime, "owner", 0);
  expect(first.state).toBe("pending");
  expect(f.gateway.comment).toHaveBeenCalledTimes(1);
  const request = f.comments.find((entry) => parseCommand(entry.body));
  f.comments.push(comment(receiptBody(receipt(command, request!.id)), "writer", 100));
  const second = await submitIntent(command, f.runtime, "owner", 0);
  expect(second.state).toBe("confirmed");
  expect(second.receipt?.result?.issue).toBe(10);
  expect(f.gateway.comment).toHaveBeenCalledTimes(1);
});

it("ignores forged receipts and rejects operation ID reuse with a changed payload", async () => {
  const f = fixture(); const command = claim();
  f.comments.push(comment(commandBody(command), "owner", 10));
  f.comments.push(comment(receiptBody(receipt(command, 10)), "someone-else", 11));
  expect((await submitIntent(command, f.runtime, "owner", 0)).state).toBe("pending");
  const different = signCommand({ ...command, issue: 12 }, privateKey);
  await expect(submitIntent(different, f.runtime, "owner", 0)).rejects.toThrow("outro ator ou payload");
  expect(f.gateway.comment).not.toHaveBeenCalled();
});

it("recovers a lost comment response by discovering the persisted operation on retry", async () => {
  const f = fixture(); const command = claim();
  vi.mocked(f.gateway.comment).mockImplementationOnce(async (_issue, body) => {
    f.comments.push(comment(body, "owner", 10)); throw new Error("response lost after remote persistence");
  });
  expect((await submitIntent(command, f.runtime, "owner", 0)).state).toBe("pending");
  f.comments.push(comment(receiptBody(receipt(command, 10)), "writer", 11));
  expect((await submitIntent(command, f.runtime, "owner", 0)).state).toBe("confirmed");
  expect(f.gateway.comment).toHaveBeenCalledTimes(1);
});

it("will not accept a writer receipt for another request or mismatched command hash", async () => {
  const f = fixture(); const command = claim();
  f.comments.push(comment(commandBody(command), "owner", 10));
  f.comments.push(comment(receiptBody({ ...receipt(command, 10), commandHash: "f".repeat(64) }), "writer", 11));
  await expect(submitIntent(command, f.runtime, "owner", 0)).rejects.toThrow("Recibo conflitante");
});

it("returns exit 2 for an unconfirmed CLI command and retains its revision across claim retries", async () => {
  const f = fixture();
  const args = ["claim", "10", "--execution", executionId, "--operation", operationId, "--timeout-ms", "0", "--json"];
  expect(await runCli(args, f.runtime)).toBe(2);
  const request = f.comments.find((entry) => parseCommand(entry.body));
  const command = parseCommand(request!.body)!;
  verifyCommandSignature(command, publicKey);
  f.task.revision = "d".repeat(64); f.task.coordination = null;
  f.comments.push(comment(receiptBody(receipt(command, request!.id)), "writer", 100));
  expect(await runCli(args, f.runtime)).toBe(0);
  expect(f.gateway.comment).toHaveBeenCalledTimes(1);
  expect(f.errors).toEqual([]);
});

it("refuses stale revisions and a different worktree before posting a transition", async () => {
  const f = fixture();
  const args = ["transition", "10", "--execution", executionId, "--revision", "a".repeat(64), "--status", "QA", "--evidence", "https://github.com/owner/repo/pull/1", "--timeout-ms", "0"];
  expect(await runCli(args, f.runtime)).toBe(1);
  expect(f.errors.at(-1)).toContain("Revisão remota mudou");
  args[5] = f.task.revision;
  f.runtime.workspace = async () => ({ ...workspace, worktreeId: "another-tree" });
  expect(await runCli(args, f.runtime)).toBe(1);
  expect(f.errors.at(-1)).toContain("não pertence");
  expect(f.gateway.comment).not.toHaveBeenCalled();
});

it("checks generation, actor, public key, lease and checkout together", () => {
  const task = snapshot();
  expect(() => verifyOwnership(task, workspace, "owner", now)).not.toThrow();
  for (const changed of [{ worktreeId: "other" }, { branch: "feat/other" }, { generation: 2 }, { publicKey: "other" }]) {
    expect(() => verifyOwnership(task, { ...workspace, ...changed }, "owner", now)).toThrow("não pertence");
  }
  expect(() => verifyOwnership(task, workspace, "another-human", now)).toThrow("não pertence");
  expect(() => verifyOwnership(task, workspace, "owner", now + 60_000)).toThrow("Lease remoto vencido");
});

it("fails closed on duplicate trusted controls while ignoring an untrusted control", () => {
  const valid = comment(controlBody(control), "writer", 1);
  expect(trustedControl([valid, comment(controlBody({ ...control, manualEpoch: 100 }), "imposter", 2)], "writer")).toEqual(control);
  expect(() => trustedControl([valid, { ...valid, id: 3 }], "writer")).toThrow("único controle");
});

it("reports activation gaps even when a workflow exists, and requires the canonical fields", async () => {
  const f = fixture();
  expect(await runCli(["preflight", "--json"], f.runtime)).toBe(0);
  f.runtime.readiness = async () => ({ ...readiness, enforcement: "false", activationRun: { ...readiness.activationRun!, sameWorkflow: false } });
  expect(await runCli(["preflight", "--json"], f.runtime)).toBe(1);
  const result = JSON.parse(f.output.at(-1)!);
  expect(result.ready).toBe(false);
  expect(result.problems.join(" ")).toContain("TASKS_ENFORCEMENT");
  expect(result.problems.join(" ")).toContain("workflow confiável");
  expect(fieldProblems(fields().filter((field) => field.name !== "Iniciado em"))).toContain("Campo Iniciado em: esperado um, encontrados 0.");
  expect(activationProblems(control, { ...readiness, enforcement: "false" }, false)).toEqual([]);
});

it.each([null, "false", "TRUE"])("refuses preflight and execution verification while the writer flag is %s", async (writerEnabled) => {
  const f = fixture();
  f.runtime.readiness = async () => ({ ...readiness, writerEnabled });
  expect(await runCli(["preflight", "--json"], f.runtime)).toBe(1);
  expect(JSON.parse(f.output.at(-1)!).problems).toContain("TASKS_WRITER_ENABLED ainda não está habilitado.");
  expect(await runCli(["verify", "10", "--execution", executionId, "--json"], f.runtime)).toBe(1);
  expect(f.errors.at(-1)).toContain("TASKS_WRITER_ENABLED");
  expect(f.gateway.comment).not.toHaveBeenCalled();
});

it("permits a writer pilot before enforcement while preflight still reports the remaining gate", async () => {
  const f = fixture();
  f.runtime.readiness = async () => ({ ...readiness, enforcement: "false" });
  expect(await runCli(["verify", "10", "--execution", executionId, "--json"], f.runtime)).toBe(0);
  expect(await runCli(["preflight", "--json"], f.runtime)).toBe(1);
  expect(JSON.parse(f.output.at(-1)!).problems).toEqual(["TASKS_ENFORCEMENT ainda não está habilitado."]);
  expect(f.gateway.comment).not.toHaveBeenCalled();
});

it("generates and verifies a key in a real linked worktree and rejects the main checkout", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "tasks-cli-")); directories.push(root);
  const repository = join(root, "repo"); await mkdir(repository);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.test", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.test" };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !["GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"].includes(key)) delete env[key as keyof typeof env];
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "dev"); git("commit", "--allow-empty", "-qm", "base");
  const worktree = join(root, "feature-tree"); git("worktree", "add", "-qb", "feat/task", worktree);
  await expect(inspectWorkspace(executionId, repository)).rejects.toThrow("worktree vinculada");
  const binding = await inspectWorkspace(executionId, worktree);
  expect(binding.branch).toBe("feat/task"); expect(binding.worktreeId).toBe("feature-tree");
  const command = await signExecutionCommand({ ...claim(), execution: binding }, worktree);
  expect(() => verifyCommandSignature(command, binding.publicKey)).not.toThrow();
  expect(await inspectWorkspace(executionId, worktree)).toEqual(binding);
  const permanent = join(root, "staging-tree"); git("worktree", "add", "-qb", "staging", permanent);
  await expect(inspectWorkspace(executionId, permanent)).rejects.toThrow("Branch permanente");
});

it("key is local and does not depend on GitHub connectivity", async () => {
  const f = fixture(); vi.mocked(f.gateway.identity).mockRejectedValue(new Error("offline"));
  expect(await runCli(["key", "--execution", executionId], f.runtime)).toBe(0);
  expect(f.gateway.identity).not.toHaveBeenCalled();
  expect(JSON.parse(f.output[0]!)).toEqual(workspace);
});

it("permits labeled bootstrap reads while refusing mutations without a trusted control", async () => {
  const f = fixture(); f.comments.splice(0);
  expect(await runCli(["show", "10", "--json"], f.runtime)).toBe(0);
  expect(JSON.parse(f.output.at(-1)!).bootstrap).toBe(true);
  expect(f.gateway.readTask).toHaveBeenCalledWith(10, 0);
  expect(await runCli(["preflight", "--json"], f.runtime)).toBe(1);
  expect(JSON.parse(f.output.at(-1)!).problems.join(" ")).toContain("controle confiável ainda não foi inicializado");
  expect(await runCli(["claim", "10", "--execution", executionId], f.runtime)).toBe(1);
  expect(f.gateway.comment).not.toHaveBeenCalled();
});
