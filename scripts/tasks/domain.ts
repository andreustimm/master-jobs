import type { Command, Coordination, TaskPatch, TaskSnapshot, TaskStatus } from "./types.ts";

export const LEASE_MS = 90 * 60 * 1000;
const terminal = new Set<TaskStatus>(["Concluído", "Cancelado"]);
const transitions: Partial<Record<TaskStatus, readonly TaskStatus[]>> = {
  "Analisar": ["Backlog", "Cancelado"], Backlog: ["Analisar", "Cancelado"],
  "Em execução": ["QA", "Cancelado"], QA: ["Em execução", "Testando", "Concluído", "Cancelado"],
  Testando: ["Em execução", "Implantar", "Concluído", "Cancelado"],
  Implantar: ["Em execução", "Implantando", "Concluído", "Cancelado"],
  Implantando: ["Implantar", "Concluído", "Cancelado"],
};
export function assertRevision(snapshot: TaskSnapshot, command: Command): void {
  if (!command.expectedRevision || command.expectedRevision !== snapshot.revision) throw new Error("STALE_REVISION: read the task again; no write was applied");
}
export function assertOwner(snapshot: TaskSnapshot, command: Command, actor: string, now: Date): void {
  const current = snapshot.coordination?.execution;
  const requested = command.execution;
  if (!current || !requested || current.actor !== actor || current.executionId !== requested.executionId || current.publicKey !== requested.publicKey || current.branch !== requested.branch || current.worktreeId !== requested.worktreeId || current.generation !== requested.generation) throw new Error("NOT_OWNER: execution, actor, key, branch, worktree and generation must match");
  if (Date.parse(current.expiresAt) <= now.getTime()) throw new Error("LEASE_EXPIRED: administrative reconciliation is required; local WIP is not discarded");
}
export function planCommand(snapshot: TaskSnapshot, command: Command, actor: string, now: Date): TaskPatch {
  assertRevision(snapshot, command);
  if (!snapshot.itemId || !snapshot.status) throw new Error("Task is not configured in the canonical Project; adopt it first");
  if (terminal.has(snapshot.status) || snapshot.issue.state !== "OPEN") throw new Error("Task is terminal; reopening requires an explicit administrative decision");
  const previous = snapshot.coordination;
  const coordination: Coordination = { protocolVersion: 1, revision: (previous?.revision ?? 0) + 1, generation: previous?.generation ?? 0, execution: previous?.execution ?? null, lastOperation: command.operationId, ...(previous?.previousStatus ? { previousStatus: previous.previousStatus } : {}) };
  const patch: TaskPatch = { fields: {}, coordination };
  const time = now.toISOString();
  const expiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
  if (command.action === "claim") {
    if (!command.execution) throw new Error("Execution context is required");
    if (!snapshot.issue.assignees.includes(actor)) throw new Error("Assign the issue to the actor before claiming it");
    if (previous?.execution) throw new Error("ALREADY_CLAIMED: release or transfer the existing execution, including an expired one");
    if (snapshot.status === "Bloqueado" && !previous?.previousStatus) throw new Error("Manually blocked work requires administrative reconciliation of its previous state");
    if (snapshot.dependencies.some(d => d.status !== "Concluído")) throw new Error("DEPENDENCY_BLOCKED: every native dependency must be Concluído");
    coordination.generation++;
    coordination.execution = { ...command.execution, actor, generation: coordination.generation, acquiredAt: time, heartbeatAt: time, expiresAt };
    if (snapshot.status === "Analisar" || snapshot.status === "Backlog") patch.fields.status = "Em execução";
    if (!snapshot.startedAt) patch.fields.startedAt = time.slice(0, 10);
    return patch;
  }
  assertOwner(snapshot, command, actor, now);
  switch (command.action) {
    case "heartbeat": coordination.execution = { ...coordination.execution!, heartbeatAt: time, expiresAt }; break;
    case "release":
      if (!command.reason) throw new Error("Release requires a reason and a WIP handoff in the issue");
      coordination.execution = null; coordination.generation++; break;
    case "transfer":
      if (!command.reason || !command.transferTo) throw new Error("Transfer requires a destination and reason");
      coordination.generation++;
      coordination.execution = { ...command.transferTo, actor, generation: coordination.generation, acquiredAt: time, heartbeatAt: time, expiresAt };
      break;
    case "block":
      if (snapshot.status === "Bloqueado" || !command.reason) throw new Error("Block requires an active task and reason");
      coordination.previousStatus = snapshot.status;
      patch.fields.status = "Bloqueado"; break;
    case "resume":
      if (snapshot.status !== "Bloqueado" || !previous?.previousStatus || !command.evidence?.length) throw new Error("Resume requires a blocked task, previous state and evidence");
      if (snapshot.dependencies.some(d => d.status !== "Concluído")) throw new Error("DEPENDENCY_BLOCKED");
      patch.fields.status = previous.previousStatus;
      delete coordination.previousStatus; break;
    case "transition": {
      const target = command.status;
      if (!target || !transitions[snapshot.status]?.includes(target)) throw new Error(`Invalid transition from ${snapshot.status} to ${target}`);
      if (target === "Cancelado") { if (!command.reason) throw new Error("Cancellation requires a reason"); patch.close = "not_planned"; }
      else if (!command.evidence?.length) throw new Error("A transition requires verifiable evidence");
      patch.fields.status = target;
      if (terminal.has(target)) {
        patch.fields.finishedAt = time.slice(0, 10); coordination.execution = null; coordination.generation++;
        if (target === "Concluído") patch.close = "completed";
      }
      break;
    }
    default: throw new Error(`Action ${command.action} does not alter an execution`);
  }
  return patch;
}
