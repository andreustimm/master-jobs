// Operational state lives in GitHub; these are wire contracts, not a local store.
export const PROTOCOL_VERSION = 1 as const;
export const STATUSES = ["Analisar", "Backlog", "Bloqueado", "Em execução", "QA", "Testando", "Implantar", "Implantando", "Concluído", "Cancelado"] as const;
export type TaskStatus = typeof STATUSES[number];
export type Delivery = "dev" | "production" | "artifact" | "operation";
export type Priority = "Crítica" | "Alta" | "Média" | "Baixa";

export interface ProjectConfig {
  repository: string;
  owner: string;
  number: number;
  projectId: string;
  controlIssue: number;
  writerLogin: string;
  writerPublicKey?: string;
  workflow: string;
  protocolVersion: 1;
}
export interface Execution {
  executionId: string;
  publicKey: string;
  actor: string;
  branch: string;
  worktreeId: string;
  generation: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}
export interface Coordination {
  protocolVersion: 1;
  revision: number;
  generation: number;
  execution: Execution | null;
  previousStatus?: TaskStatus;
  /** Instant of the first confirmed claim. "Iniciado em" is a DATE field and cannot bound a delivery window. */
  firstClaimedAt?: string;
  lastOperation: string;
}
export interface IssueData {
  id: string;
  number: number;
  url: string;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  stateReason?: string | null;
  updatedAt: string;
  assignees: string[];
}
export interface Dependency {
  number: number;
  state: "OPEN" | "CLOSED";
  status: TaskStatus | null;
}
export interface TaskSnapshot {
  issue: IssueData;
  projectId: string;
  itemId: string;
  status: TaskStatus | null;
  priority: string | null;
  type: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  parent: number | null;
  dependencies: Dependency[];
  subIssues: number[];
  linkedPullRequests: number[];
  coordination: Coordination | null;
  coordinationCommentId: number | null;
  manualEpoch: number;
  revision: string;
  fetchedAt: string;
}
export interface WorkspaceContext {
  executionId: string;
  publicKey: string;
  branch: string;
  worktreeId: string;
  generation?: number;
}
export interface Command {
  protocolVersion: 1;
  operationId: string;
  signature?: string;
  action: "create" | "adopt" | "reconcile" | "claim" | "heartbeat" | "transition" | "block" | "resume" | "release" | "transfer" | "pause" | "unpause";
  issue: number;
  expectedRevision?: string;
  execution?: WorkspaceContext;
  status?: TaskStatus;
  reason?: string;
  evidence?: string[];
  transferTo?: { executionId: string; publicKey: string; branch: string; worktreeId: string };
  adopt?: { delivery: Delivery; priority: Priority; type: string };
  create?: {
    title: string;
    body: string;
    priority: Priority;
    type: string;
    delivery: Delivery;
    parent?: number;
    dependsOn: number[];
  };
}
export interface RemoteComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}
export interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string; color: string; description: string }[];
}
export interface FieldPatch {
  status?: TaskStatus;
  priority?: Priority;
  type?: string;
  startedAt?: string;
  finishedAt?: string;
}
export interface TaskPatch {
  fields: FieldPatch;
  body?: string;
  coordination?: Coordination;
  close?: "completed" | "not_planned";
}
export interface ControlState {
  protocolVersion: 1;
  paused: boolean;
  manualEpoch: number;
  lastOperation: string;
  activation?: { status: "ready"; checkedAt: string; workflowRun: number; sha: string };
}
export interface Receipt {
  protocolVersion: 1;
  operationId: string;
  commandHash: string;
  requestId: number;
  issue: number;
  phase: "prepared" | "confirmed" | "rejected" | "uncertain";
  actor: string;
  message: string;
  at: string;
  before?: TaskSnapshot;
  controlBefore?: ControlState;
  controlAfter?: ControlState;
  patch?: TaskPatch;
  result?: { issue: number; revision: string; execution?: Execution | null };
}
export interface PullRequestEvidence {
  number: number;
  url: string;
  state: string;
  base: string;
  head: string;
  headSha: string;
  mergeSha: string | null;
  mergedAt: string | null;
  linkedIssues: number[];
  checksSuccessful: boolean;
}
export interface DeploymentEvidence {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  state: string;
  url: string | null;
}
export interface WorkflowRunEvidence {
  id: number;
  sha: string;
  branch: string;
  conclusion: string | null;
  url: string;
  name: string;
  path?: string;
  attempt?: number;
  createdAt?: string;
}
export interface TaskGateway {
  identity(): Promise<string>;
  permission(login: string): Promise<string>;
  fields(): Promise<ProjectField[]>;
  readTask(issue: number, epoch?: number): Promise<TaskSnapshot>;
  listProjectTasks(): Promise<TaskSnapshot[]>;
  comments(issue: number): Promise<RemoteComment[]>;
  comment(issue: number, body: string): Promise<RemoteComment>;
  updateComment(id: number, body: string): Promise<void>;
  patchTask(snapshot: TaskSnapshot, patch: TaskPatch): Promise<void>;
  createIssue(title: string, body: string, assignee: string): Promise<IssueData>;
  findCreatedIssue(operationId: string): Promise<IssueData | null>;
  addToProject(issueId: string): Promise<string>;
  addSubIssue(parent: number, childId: string): Promise<void>;
  addDependency(issue: number, blockedBy: number): Promise<void>;
  pullRequest(number: number): Promise<PullRequestEvidence>;
  deployment(id: number): Promise<DeploymentEvidence>;
  containsCommit(ancestor: string, descendant: string): Promise<boolean>;
  workflowRun(id: number): Promise<WorkflowRunEvidence>;
  latestWorkflowRun?(path: string, sha: string): Promise<WorkflowRunEvidence | null>;
}
