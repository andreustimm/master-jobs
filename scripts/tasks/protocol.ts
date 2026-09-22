import { createHash } from "node:crypto";
import { z } from "zod";
import { STATUSES } from "./types.ts";
import type { Command, ControlState, Coordination, Receipt, TaskSnapshot } from "./types.ts";

const uuid = z.string().uuid();
const timestamp = z.iso.datetime();
const nonempty = z.string().trim().min(1).max(1000);
const branch = z.string().regex(/^(?:feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert|codex)\/[a-z0-9][a-z0-9.-]*(?:\/[a-z0-9][a-z0-9.-]*)?$/);
const workspace = z.strictObject({ executionId: uuid, publicKey: z.string().min(40).max(200), branch, worktreeId: z.string().regex(/^[a-zA-Z0-9._-]+$/), generation: z.number().int().positive().optional() });
const delivery = z.enum(["dev", "production", "artifact", "operation"]);
const priority = z.enum(["Crítica", "Alta", "Média", "Baixa"]);
export const commandSchema = z.strictObject({
  protocolVersion: z.literal(1), operationId: uuid, signature: z.string().min(40).max(200).optional(),
  action: z.enum(["create", "adopt", "reconcile", "claim", "heartbeat", "transition", "block", "resume", "release", "transfer", "pause", "unpause"]),
  issue: z.number().int().positive(), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(), execution: workspace.optional(),
  status: z.enum(STATUSES).optional(), reason: nonempty.optional(), evidence: z.array(z.url().max(2000)).max(20).optional(),
  transferTo: workspace.omit({ generation: true }).optional(),
  adopt: z.strictObject({ delivery, priority, type: nonempty }).optional(),
  create: z.strictObject({ title: z.string().trim().min(1).max(256), body: z.string().min(1).max(30000), priority, type: nonempty, delivery, parent: z.number().int().positive().optional(), dependsOn: z.array(z.number().int().positive()).max(100) }).optional(),
});
const execution = workspace.required().extend({ actor: nonempty, acquiredAt: timestamp, heartbeatAt: timestamp, expiresAt: timestamp });
const coordinationSchema = z.strictObject({ protocolVersion: z.literal(1), revision: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), execution: execution.nullable(), previousStatus: z.enum(STATUSES).optional(), lastOperation: uuid });
const controlSchema = z.strictObject({ protocolVersion: z.literal(1), paused: z.boolean(), manualEpoch: z.number().int().nonnegative(), lastOperation: uuid, activation: z.strictObject({ status: z.literal("ready"), checkedAt: timestamp, workflowRun: z.number().int().positive(), sha: z.string().regex(/^[a-f0-9]{40}$/) }).optional() });
const receiptSchema = z.object({ protocolVersion: z.literal(1), operationId: uuid, commandHash: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.number().int().positive(), issue: z.number().int().positive(), phase: z.enum(["prepared", "confirmed", "rejected", "uncertain"]), actor: nonempty, message: z.string(), at: timestamp }).passthrough();

function encode(kind: string, value: unknown): string {
  return `<!-- tasks-${kind}:v1 -->\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}
function decode<T>(kind: string, body: string, schema: z.ZodType<T>): T | null {
  const marker = `<!-- tasks-${kind}:v1 -->`;
  if (!body.startsWith(marker)) return null;
  // The gateway verifies the attestation against the configured writer key before
  // handing a privileged envelope to readers. Pure parsers only decode its data.
  const unsigned = body.replace(/\n<!-- tasks-attestation:[A-Za-z0-9+/=]+ -->\s*$/, "");
  const match = unsigned.slice(marker.length).match(/^\n```json\n([\s\S]+)\n```\s*$/);
  if (!match?.[1]) throw new Error(`Malformed tasks-${kind} envelope`);
  return schema.parse(JSON.parse(match[1]));
}
export const commandBody = (command: Command): string => encode("command", commandSchema.parse(command));
export const parseCommand = (body: string): Command | null => decode("command", body, commandSchema);
export const coordinationBody = (value: Coordination): string => encode("coordination", coordinationSchema.parse(value));
export const parseCoordination = (body: string): Coordination | null => decode("coordination", body, coordinationSchema);
export const controlBody = (value: ControlState): string => encode("control", controlSchema.parse(value));
export const parseControl = (body: string): ControlState | null => decode("control", body, controlSchema);
export const receiptBody = (value: Receipt): string => encode("receipt", receiptSchema.parse(value));
export const parseReceipt = (body: string): Receipt | null => decode("receipt", body, receiptSchema) as Receipt | null;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
export const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
export const commandHash = (command: Command): string => hash(commandSchema.parse(command));
export function snapshotRevision(snapshot: TaskSnapshot): string {
  // Priority/order remain editable without allowing an automated transition to reset them.
  return hash({ issue: { id: snapshot.issue.id, number: snapshot.issue.number, title: snapshot.issue.title, body: snapshot.issue.body, state: snapshot.issue.state, stateReason: snapshot.issue.stateReason, assignees: [...snapshot.issue.assignees].sort() }, projectId: snapshot.projectId, itemId: snapshot.itemId, status: snapshot.status, type: snapshot.type, parent: snapshot.parent, dependencies: [...snapshot.dependencies].sort((a, b) => a.number - b.number), subIssues: [...snapshot.subIssues].sort((a,b)=>a-b), linkedPullRequests: [...snapshot.linkedPullRequests].sort((a,b)=>a-b), coordination: snapshot.coordination, manualEpoch: snapshot.manualEpoch });
}
export function deliveryOf(body: string): "dev" | "production" | "artifact" | "operation" {
  const matches = [...body.matchAll(/<!-- task-delivery:(dev|production|artifact|operation) -->/g)];
  if (matches.length !== 1) throw new Error("Issue must declare exactly one task-delivery contract; adopt it first");
  return matches[0]![1] as "dev" | "production" | "artifact" | "operation";
}
