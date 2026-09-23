import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Coordinator } from "../scripts/tasks/coordinator.ts";
import { controlBody, coordinationBody, parseCoordination, parseReceipt, snapshotRevision } from "../scripts/tasks/protocol.ts";
import { signCommand } from "../scripts/tasks/signing.ts";
import type { Command, ProjectConfig, RemoteComment, TaskGateway, TaskPatch, TaskSnapshot } from "../scripts/tasks/types.ts";

const actor = "andreustimm";
const time = new Date("2026-09-22T15:00:00.000Z");
const config: ProjectConfig = { protocolVersion: 1, repository: "andreustimm/master-jobs", owner: actor, number: 3, projectId: "P3", controlIssue: 207, writerLogin: actor, workflow: "tasks-project.yml" };
const key = generateKeyPairSync("ed25519");
const privateKey = key.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = key.publicKey.export({ type: "spki", format: "der" }).toString("base64");
function snapshot(): TaskSnapshot {
  const s: TaskSnapshot = { issue: { id: "I1", number: 1, url: "https://github.com/andreustimm/master-jobs/issues/1", title: "Task", body: "Contract\n<!-- task-delivery:dev -->", state: "OPEN", updatedAt: time.toISOString(), assignees: [actor] }, projectId: "P3", itemId: "PI1", status: "Backlog", priority: "Alta", type: "feat", startedAt: null, finishedAt: null, parent: null, dependencies: [], subIssues: [], linkedPullRequests: [], coordination: null, coordinationCommentId: null, manualEpoch: 0, revision: "", fetchedAt: time.toISOString() };
  s.revision = snapshotRevision(s); return s;
}
function fixture() {
  let state = snapshot();
  const comments: RemoteComment[] = [{ id: 1, body: controlBody({ protocolVersion: 1, paused: false, manualEpoch: 0, lastOperation: randomUUID() }), author: actor, createdAt: time.toISOString(), updatedAt: time.toISOString(), url: "https://github.com/control#1" }];
  let writes = 0;
  let failAfterWrite = false;
  const gateway = {
    identity: async () => actor, permission: async () => "admin", fields: async () => [],
    readTask: async (_issue: number, epoch = 0) => { const s = structuredClone(state); s.manualEpoch = epoch; s.revision = snapshotRevision(s); return s; },
    listProjectTasks: async () => [structuredClone(state)],
    comments: async () => structuredClone(comments),
    comment: async (_issue: number, body: string) => { const c = { id: Math.max(...comments.map(c=>c.id)) + 1, body, author: actor, createdAt: time.toISOString(), updatedAt: time.toISOString(), url: "https://github.com/comment" }; comments.push(c); return structuredClone(c); },
    updateComment: async (id: number, body: string) => { comments.find(c => c.id === id)!.body = body; },
    patchTask: async (_before: TaskSnapshot, patch: TaskPatch) => { writes++; Object.assign(state, patch.fields); if (patch.coordination) state.coordination = structuredClone(patch.coordination); if (patch.body) state.issue.body = patch.body; if (patch.close) { state.issue.state = "CLOSED"; state.issue.stateReason = patch.close; } if (failAfterWrite) { failAfterWrite = false; throw new Error("response lost"); } },
    createIssue: async () => state.issue, findCreatedIssue: async () => null, addToProject: async () => "PI1", addSubIssue: async () => {}, addDependency: async () => {},
    pullRequest: async () => { throw new Error("no evidence fixture"); }, deployment: async () => { throw new Error("no evidence fixture"); }, containsCommit: async () => false,
    workflowRun: async () => { throw new Error("no evidence fixture"); },
  } satisfies TaskGateway;
  const coordinator = new Coordinator(gateway, config, { now: () => time, validate: async () => {} });
  const claim = async (executionId = randomUUID()): Promise<Command> => signCommand({ protocolVersion: 1, operationId: randomUUID(), action: "claim", issue: 1, expectedRevision: (await gateway.readTask(1)).revision, execution: { executionId, publicKey, branch: "feat/task", worktreeId: "task" } }, privateKey);
  const submit = async (command: Command) => {
    const { commandBody } = await import("../scripts/tasks/protocol.ts");
    const request = await gateway.comment(207, commandBody(command));
    return coordinator.process(command, request);
  };
  const owned = async (action: Command["action"], extras: Partial<Command> = {}): Promise<Command> => { const s = await gateway.readTask(1); const e = s.coordination!.execution!; return signCommand({ protocolVersion: 1, operationId: randomUUID(), action, issue: 1, expectedRevision: s.revision, execution: { executionId: e.executionId, publicKey: e.publicKey, branch: e.branch, worktreeId: e.worktreeId, generation: e.generation }, ...extras }, privateKey); };
  return { gateway, coordinator, comments, claim, submit, owned, state: () => state, mutate: (fn: (s: TaskSnapshot) => void) => { fn(state); }, writes: () => writes, loseResponse: () => { failAfterWrite = true; } };
}

describe("canonical task writer", () => {
  it("serializes simultaneous claims with the same human into one authorized execution (CAN-02)", async () => {
    const f = fixture(); const a = await f.claim(); const b = await f.claim();
    expect((await f.submit(a)).phase).toBe("confirmed");
    expect((await f.submit(b)).message).toContain("STALE_REVISION");
    expect(f.state().coordination!.execution!.executionId).toBe(a.execution!.executionId);
    expect(f.writes()).toBe(1);
  });
  it("preserves manual priority changes without invalidating a valid claim (CAN-05)", async () => {
    const f = fixture(); const command = await f.claim(); f.mutate(s => { s.priority = "Crítica"; });
    expect((await f.submit(command)).phase).toBe("confirmed"); expect(f.state().priority).toBe("Crítica");
  });
  it("rejects stale branch/owner and generations even with the same human (CAN-03/10)", async () => {
    const f = fixture(); await f.submit(await f.claim()); const old = await f.owned("heartbeat");
    const transfer = await f.owned("transfer", { reason: "WIP handed off", transferTo: { executionId: randomUUID(), publicKey, branch: "feat/new", worktreeId: "new" } });
    expect((await f.submit(transfer)).phase).toBe("confirmed");
    expect((await f.submit(old)).phase).toBe("rejected");
    const forged = signCommand({ ...old, operationId: randomUUID(), expectedRevision: (await f.gateway.readTask(1)).revision }, privateKey);
    expect((await f.submit(forged)).message).toContain("NOT_OWNER");
  });
  it("records the exact first-claim instant and keeps it across transfer, release and reclaim", async () => {
    const f = fixture(); await f.submit(await f.claim());
    expect(f.state().coordination!.firstClaimedAt).toBe(time.toISOString());
    expect(f.state().startedAt).toBe("2026-09-22");
    const earlier = "2026-09-22T09:15:00.000Z";
    f.mutate(s => { s.coordination!.firstClaimedAt = earlier; });
    await f.submit(await f.owned("transfer", { reason: "WIP handed off", transferTo: { executionId: randomUUID(), publicKey, branch: "feat/new", worktreeId: "new" } }));
    expect(f.state().coordination!.firstClaimedAt).toBe(earlier);
    expect((await f.submit(await f.owned("release", { reason: "WIP preserved in the issue" }))).phase).toBe("confirmed");
    expect((await f.submit(await f.claim())).phase).toBe("confirmed");
    expect(f.state().coordination!.firstClaimedAt).toBe(earlier);
    expect(parseCoordination(coordinationBody(f.state().coordination!))?.firstClaimedAt).toBe(earlier);
  });
  it("coalesces duplicate operations but rejects a UUID with a different payload (CAN-08)", async () => {
    const f = fixture(); const command = await f.claim(); const first = await f.submit(command);
    expect(await f.submit(command)).toEqual(first); expect(f.writes()).toBe(1);
    await expect(f.submit({ ...command, reason: "changed" })).rejects.toThrow("OPERATION_CONFLICT");
  });
  it("recovers a lost response after mutation without applying twice (CAN-09/12)", async () => {
    const f = fixture(); const command = await f.claim(); f.loseResponse();
    expect((await f.submit(command)).phase).toBe("uncertain");
    expect((await f.submit(command)).phase).toBe("confirmed"); expect(f.writes()).toBe(1);
  });
  it("invalidates old commands when manual status editing ends (CAN-06)", async () => {
    const f = fixture(); const command = await f.claim();
    expect((await f.submit({ protocolVersion: 1, operationId: randomUUID(), action: "pause", issue: 207, reason: "Manual status change" })).phase).toBe("confirmed");
    f.mutate(s => { s.status = "Analisar"; });
    await f.submit({ protocolVersion: 1, operationId: randomUUID(), action: "unpause", issue: 207, reason: "Change audited" });
    expect((await f.submit(command)).message).toContain("STALE_REVISION");
  });
  it("refuses expired ownership instead of silently discarding another worktree", async () => {
    const f = fixture(); await f.submit(await f.claim()); f.mutate(s => { s.coordination!.execution!.expiresAt = "2026-09-22T14:59:00.000Z"; });
    expect((await f.submit(await f.owned("heartbeat"))).message).toContain("LEASE_EXPIRED");
    expect((await f.submit(await f.claim())).message).toContain("ALREADY_CLAIMED");
  });
  it("does not treat closed or canceled dependencies as completed (CAN-13)", async () => {
    const f = fixture(); f.mutate(s => { s.dependencies = [{ number: 2, state: "CLOSED", status: "Cancelado" }]; });
    expect((await f.submit(await f.claim())).message).toContain("DEPENDENCY_BLOCKED"); expect(f.writes()).toBe(0);
  });
  it("requires a real execution signature before it alters status", async () => {
    const f = fixture(); const command = await f.claim(); delete command.signature;
    expect((await f.submit(command)).phase).toBe("rejected"); expect(f.writes()).toBe(0);
  });
  it("demonstrates the unprotected UI race rather than claiming API CAS (CAN-07)", async () => {
    const f = fixture(); const original = f.gateway.patchTask;
    f.gateway.patchTask = async (before, patch) => { f.mutate(s => { s.status = "Bloqueado"; }); await original(before, patch); };
    await f.submit(await f.claim());
    // Deliberately forbidden outside pause: no Projects API CAS can detect this
    // same read/write window. The operational runbook requires quiescence.
    expect(f.state().status).toBe("Em execução");
  });
  it("keeps a durable pending intent even when no workflow runs (CAN-12)", async () => {
    const f = fixture(); const command = await f.claim(); const { commandBody } = await import("../scripts/tasks/protocol.ts");
    await f.gateway.comment(207, commandBody(command)); expect(f.state().status).toBe("Backlog");
    expect((await f.coordinator.drain()).at(-1)?.phase).toBe("confirmed");
    expect(f.comments.filter(c => parseReceipt(c.body)).length).toBe(1);
  });
  it("never accepts forged coordination envelope syntax", () => {
    expect(() => parseCoordination("<!-- tasks-coordination:v1 -->\n{}" )).toThrow();
  });
  it("does not let a conflicting UUID poison unrelated durable intents", async () => {
    const f = fixture(); const first = await f.claim(); await f.submit(first);
    const { commandBody } = await import("../scripts/tasks/protocol.ts");
    await f.gateway.comment(207, commandBody({ ...first, reason: "conflicting payload" }));
    const heartbeat = await f.owned("heartbeat"); await f.gateway.comment(207, commandBody(heartbeat));
    const drained = await f.coordinator.drain();
    expect(drained.some(r => r.operationId === heartbeat.operationId && r.phase === "confirmed")).toBe(true);
    expect(f.coordinator.failures).toBe(1);
  });
  it("settles already-answered commands from one inbox read instead of re-reading per command", async () => {
    const f = fixture(); await f.submit(await f.claim());
    for (let i = 0; i < 4; i++) await f.submit(await f.owned("heartbeat"));
    const original = f.gateway.comments; let reads = 0;
    f.gateway.comments = async () => { reads++; return original(); };
    const drained = await f.coordinator.drain();
    expect(drained).toHaveLength(5);
    expect(drained.every(r => r.phase === "confirmed")).toBe(true);
    expect(reads).toBe(1);
    expect(f.writes()).toBe(5);
  });
  it("revalidates delivery evidence before retrying an unapplied prepared conclusion", async () => {
    const f = fixture(); await f.submit(await f.claim()); f.mutate(s => { s.status = "QA"; });
    const command = await f.owned("transition", { status: "Concluído", evidence: ["https://github.com/andreustimm/master-jobs/pull/20"] });
    const original = f.gateway.patchTask; f.gateway.patchTask = async () => { throw new Error("network failed before mutation"); };
    expect((await f.submit(command)).phase).toBe("uncertain");
    f.gateway.patchTask = original; f.coordinator.validate = async () => { throw new Error("Current CI is red"); };
    expect((await f.submit(command)).message).toContain("Current CI is red"); expect(f.state().status).toBe("QA");
  });
  it("rechecks the original owner's lease before recovering a terminal patch", async () => {
    const f = fixture(); await f.submit(await f.claim()); f.mutate(s => { s.status = "QA"; });
    const command = await f.owned("transition", { status: "Concluído", evidence: ["https://github.com/andreustimm/master-jobs/pull/20"] });
    const original = f.gateway.patchTask; f.gateway.patchTask = async () => { throw new Error("not applied"); };
    await f.submit(command); f.gateway.patchTask = original;
    f.coordinator.now = () => new Date(time.getTime() + 91 * 60 * 1000);
    expect((await f.submit(command)).message).toContain("LEASE_EXPIRED"); expect(f.state().status).toBe("QA");
  });
  it("reconciles above pending journal revisions without stealing a live owner", async () => {
    const f = fixture(); await f.submit(await f.claim()); const owner = f.state().coordination!.execution;
    const command = await f.owned("block", { reason: "Wait for external system" });
    const original = f.gateway.patchTask; f.gateway.patchTask = async () => { throw new Error("not applied"); };
    await f.submit(command); f.gateway.patchTask = original;
    const receipt = await f.submit({ protocolVersion: 1, operationId: randomUUID(), action: "reconcile", issue: 1, expectedRevision: (await f.gateway.readTask(1)).revision, reason: "WIP and remote state inspected", evidence: ["https://github.com/andreustimm/master-jobs/issues/1#issuecomment-10"] });
    expect(receipt.phase).toBe("confirmed"); expect(f.state().coordination!.revision).toBe(3);
    expect(f.state().coordination!.execution).toEqual(owner);
  });
  it.each(["pause", "unpause"] as const)("recovers %s when its prepared control write did not apply", async (action) => {
    const f = fixture();
    if (action === "unpause") await f.submit({ protocolVersion: 1, operationId: randomUUID(), action: "pause", issue: 207, reason: "Manual edit" });
    const command: Command = { protocolVersion: 1, operationId: randomUUID(), action, issue: 207, reason: "Confirmed manual window" };
    const original = f.gateway.updateComment; let fail = true;
    f.gateway.updateComment = async (id, body) => { if (id === 1 && fail) { fail = false; throw new Error("control write failed before apply"); } await original(id, body); };
    expect((await f.submit(command)).phase).toBe("uncertain");
    expect((await f.submit(command)).phase).toBe("confirmed");
    expect((await f.coordinator.control()).state.paused).toBe(action === "pause");
  });
  it("recovers a lost prepared-receipt POST response without a contradictory second receipt", async () => {
    const f = fixture(); const original = f.gateway.comment; let fail = true;
    f.gateway.comment = async (issue, body) => { const result = await original(issue, body); if (parseReceipt(body)?.phase === "prepared" && fail) { fail = false; throw new Error("receipt response lost"); } return result; };
    expect((await f.submit(await f.claim())).phase).toBe("confirmed");
    expect(f.comments.filter(c => parseReceipt(c.body))).toHaveLength(1); expect(f.writes()).toBe(1);
  });
  it("renews initialization evidence after a failed run without resetting epoch or pause", async () => {
    const f = fixture(); await f.submit({ protocolVersion: 1, operationId: randomUUID(), action: "pause", issue: 207, reason: "Manual edit" });
    await f.coordinator.initialize({ status: "ready", checkedAt: time.toISOString(), workflowRun: 200, sha: "a".repeat(40) }, randomUUID());
    const control = (await f.coordinator.control()).state;
    expect(control.paused).toBe(true); expect(control.manualEpoch).toBe(0); expect(control.activation!.workflowRun).toBe(200);
    expect(f.comments.filter(c => c.body.startsWith("<!-- tasks-control:v1 -->"))).toHaveLength(1);
  });
});
