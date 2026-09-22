import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubApiError, GitHubGateway, parseGitHubHttpResponse, readRetryDelayMs, requestGitHub } from "../scripts/tasks/github.ts";
import { controlBody, coordinationBody, receiptBody } from "../scripts/tasks/protocol.ts";
import { signWriterEnvelope, stripWriterAttestation, verifyWriterEnvelope } from "../scripts/tasks/attestation.ts";
import { runCli } from "../scripts/tasks/cli.ts";
import type { CliRuntime } from "../scripts/tasks/cli.ts";
import type { Coordination, ProjectConfig, Receipt, TaskSnapshot } from "../scripts/tasks/types.ts";

type Json = Record<string, unknown>;
type Request = (method: string, path: string, body?: unknown) => Promise<unknown>;
const CONFIG: ProjectConfig = {
  repository: "owner/repo", owner: "owner", number: 3, projectId: "PROJECT_3", controlIssue: 99,
  writerLogin: "writer", workflow: "tasks-project-writer.yml", protocolVersion: 1,
};
const NOW = "2026-09-22T12:00:00.000Z";
const OPERATION = "6f2f35db-f43c-4451-a98b-a8b459773af8";
const SHA = "a".repeat(40);
const COORDINATION: Coordination = { protocolVersion: 1, revision: 2, generation: 1, execution: null, lastOperation: OPERATION };
const connection = (nodes: unknown[], cursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage: cursor !== null, endCursor: cursor } });
const repository = { nameWithOwner: CONFIG.repository };
const project = (extra: Json) => ({ __typename: "ProjectV2", id: CONFIG.projectId, number: 3, owner: { login: "owner" }, ...extra });
const reference = (number: number, state = "OPEN") => ({ id: `ISSUE_${number}`, number, state, repository });
const item = (number: number, projectId = CONFIG.projectId) => ({ id: `ITEM_${number}`, project: { id: projectId } });
const comment = (id: number, body: string, author = "writer") => ({ id, body, user: { login: author }, created_at: NOW, updated_at: NOW, html_url: `https://github.com/owner/repo/issues/1#issuecomment-${id}` });
const control = comment(900, controlBody({ protocolVersion: 1, paused: false, manualEpoch: 7, lastOperation: OPERATION }));
const single = (name: string, names: string[]) => ({ id: `FIELD_${name}`, name, dataType: "SINGLE_SELECT", options: names.map((name) => ({ id: `OPTION_${name}`, name, color: "BLUE", description: "" })) });
const fields = [single("Status", ["Backlog", "Em execução", "Concluído", "Cancelado"]), single("Prioridade", ["Alta", "Baixa"]), single("Tipo", ["Feature"]), { id: "FIELD_START", name: "Iniciado em", dataType: "DATE" }];
const writerKeys = generateKeyPairSync("ed25519");
const writerPrivateKey = writerKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const writerPublicKey = writerKeys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const attestedConfig = { ...CONFIG, writerPublicKey };
const attest = (body: string, issue: number) => signWriterEnvelope(body, writerPrivateKey, writerPublicKey, `${CONFIG.repository}#${issue}`);
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function graphRequest(body: unknown): { query: string; variables: Json } {
  const request = body as { query: string; variables: Json };
  expect(typeof request.query).toBe("string");
  return request;
}

function rawIssue(number: number, body = "Task body") {
  return {
    id: number + 1000, node_id: `ISSUE_${number}`, number, html_url: `https://github.com/owner/repo/issues/${number}`,
    repository_url: "https://api.github.com/repos/owner/repo", title: `Task ${number}`, body,
    state: "open", state_reason: null, updated_at: NOW, assignees: [{ login: "owner" }], user: { login: "writer" },
  };
}

function snapshot(): TaskSnapshot {
  return {
    issue: { id: "ISSUE_1", number: 1, url: "https://github.com/owner/repo/issues/1", title: "Task", body: "Human scope", state: "OPEN", stateReason: null, assignees: ["owner"], updatedAt: NOW },
    projectId: CONFIG.projectId, itemId: "ITEM_1", status: "Backlog", priority: "Alta", type: "Feature", startedAt: null, finishedAt: null,
    parent: null, dependencies: [], subIssues: [], linkedPullRequests: [], coordination: COORDINATION,
    coordinationCommentId: 1, manualEpoch: 7, revision: "b".repeat(64), fetchedAt: NOW,
  };
}

function snapshotHarness(options: { paginated?: boolean; comments?: ReturnType<typeof comment>[]; controls?: ReturnType<typeof comment>[]; missingItem?: boolean; parent?: Json | null; duplicateItem?: boolean } = {}) {
  const state = { priority: "Alta", body: "Human scope", updatedAt: NOW, comments: options.comments ?? [comment(1, coordinationBody(COORDINATION))] };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const request: Request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.startsWith("repos/owner/repo/issues/1/comments?")) return state.comments;
    if (path.startsWith("repos/owner/repo/issues/99/comments?")) return options.controls ?? [control];
    if (path !== "graphql") throw new Error(`Unexpected ${method} ${path}`);
    const { query, variables } = graphRequest(body);
    if (query.includes("TaskSnapshot(")) return { data: { repository: { ...repository, issue: {
      id: "ISSUE_1", number: 1, url: "https://github.com/owner/repo/issues/1", title: "Task", body: state.body,
      state: "OPEN", stateReason: null, updatedAt: state.updatedAt, parent: options.parent === undefined ? reference(10) : options.parent,
      assignees: connection([{ login: "owner" }], options.paginated ? "assignees-next" : null),
      subIssues: connection([reference(11)], options.paginated ? "subIssues-next" : null),
      blockedBy: connection(options.paginated ? [reference(2, "CLOSED")] : [], options.paginated ? "blockedBy-next" : null),
      projectItems: options.missingItem ? connection([]) : options.duplicateItem ? connection([item(1), item(9)]) : options.paginated ? connection([item(8, "OTHER_PROJECT")], "projectItems-next") : connection([item(1)]),
      closedByPullRequestsReferences: connection([reference(20)], options.paginated ? "closedByPullRequestsReferences-next" : null),
    } } } };
    if (query.includes("TaskIssueConnection(")) {
      const field = ["assignees", "subIssues", "blockedBy", "projectItems", "closedByPullRequestsReferences"].find((name) => query.includes(`${name}(`));
      if (!field) throw new Error("Missing requested connection");
      const extra: Record<string, unknown[]> = { assignees: [{ login: "collaborator" }], subIssues: [reference(12)], blockedBy: [reference(3, "CLOSED")], projectItems: [item(Number(variables.issue))], closedByPullRequestsReferences: [reference(21)] };
      return { data: { repository: { ...repository, issue: { [field]: connection(extra[field]!) } } } };
    }
    if (query.includes("TaskItemFields(")) {
      const taskStatus = variables.id === "ITEM_2" ? "Concluído" : variables.id === "ITEM_3" ? "Cancelado" : "Backlog";
      return { data: { node: {
        id: variables.id, project: { id: CONFIG.projectId }, fieldValues: connection([
          { id: "VALUE_STATUS", name: taskStatus, field: { id: "STATUS", name: "Status" } },
          { id: "VALUE_PRIORITY", name: state.priority, field: { id: "PRIORITY", name: "Prioridade" } },
        ]),
      } } };
    }
    throw new Error(`Unexpected GraphQL ${query}`);
  };
  return { gateway: new GitHubGateway(CONFIG, { request, now: () => new Date(NOW) }), request, calls, state };
}

describe("GitHub task gateway", () => {
  it("reads every native relationship page and keeps canceled dependencies distinct from completed ones", async () => {
    const { gateway, calls } = snapshotHarness({ paginated: true });
    const task = await gateway.readTask(1);
    expect(task).toMatchObject({ itemId: "ITEM_1", status: "Backlog", parent: 10, subIssues: [11, 12], linkedPullRequests: [20, 21], manualEpoch: 7 });
    expect(task.issue.assignees).toEqual(["owner", "collaborator"]);
    expect(task.dependencies).toEqual([{ number: 2, state: "CLOSED", status: "Concluído" }, { number: 3, state: "CLOSED", status: "Cancelado" }]);
    expect(task.coordination).toEqual(COORDINATION);
    expect(task.revision).toMatch(/^[a-f0-9]{64}$/u);
    expect(calls.filter((call) => call.path === "graphql" && graphRequest(call.body).variables.cursor).length).toBe(5);
  });

  it("does not stale a claim for human priority edits or comments, but does for edited scope", async () => {
    const { gateway, state } = snapshotHarness();
    const first = await gateway.readTask(1);
    state.priority = "Baixa";
    state.updatedAt = "2026-09-22T13:00:00.000Z";
    state.comments.push(comment(2, "New discussion", "collaborator"));
    const second = await gateway.readTask(1);
    expect(second.priority).toBe("Baixa");
    expect(second.revision).toBe(first.revision);
    state.body = "Different acceptance criteria";
    expect((await gateway.readTask(1)).revision).not.toBe(first.revision);
  });

  it("allows adoption of an existing issue without inventing Project status", async () => {
    const task = await snapshotHarness({ missingItem: true }).gateway.readTask(1, 7);
    expect(task.itemId).toBe("");
    expect(task.status).toBeNull();
    expect(task.priority).toBeNull();
  });

  it("never trusts a coordination envelope from another author and does not let it halt the read", async () => {
    const task = await snapshotHarness({ comments: [comment(1, coordinationBody(COORDINATION), "attacker")] }).gateway.readTask(1);
    expect(task.coordination).toBeNull();
    expect(task.coordinationCommentId).toBeNull();
  });

  it.each([
    { comments: [comment(1, coordinationBody(COORDINATION)), comment(2, coordinationBody(COORDINATION))], error: /Multiple coordination/u },
    { comments: [comment(1, "<!-- tasks-coordination:v1 -->\nnot-json")], error: /Malformed/u },
  ])("refuses ambiguous or untrusted coordination ($error)", async ({ comments, error }) => {
    await expect(snapshotHarness({ comments }).gateway.readTask(1)).rejects.toThrow(error);
  });

  it("requires exactly one trusted control and rejects duplicate Project membership", async () => {
    await expect(snapshotHarness({ controls: [] }).gateway.readTask(1)).rejects.toThrow(/not activated/u);
    await expect(snapshotHarness({ controls: [control, { ...control, id: 901 }] }).gateway.readTask(1)).rejects.toThrow(/Multiple control/u);
    await expect(snapshotHarness({ duplicateItem: true }).gateway.readTask(1)).rejects.toThrow(/multiple items/u);
    await expect(snapshotHarness({ parent: { ...reference(10), repository: { nameWithOwner: "another/repo" } } }).gateway.readTask(1)).rejects.toThrow(/different repository/u);
  });

  it("does not convert authorization errors or GraphQL partial data into an empty task", async () => {
    const unavailable = new GitHubGateway(CONFIG, { request: async () => { throw new GitHubApiError("POST", "graphql", 403); } });
    await expect(unavailable.readTask(1)).rejects.toThrow(/403/u);
    const partial = new GitHubGateway(CONFIG, { request: async () => ({ data: { repository: null }, errors: [{ message: "FORBIDDEN" }] }) });
    await expect(partial.readTask(1)).rejects.toThrow(/partial data/u);
  });

  it("reads comments beyond the first hundred", async () => {
    const request = vi.fn<Request>().mockResolvedValueOnce(Array.from({ length: 100 }, (_, n) => comment(n + 1, "discussion"))).mockResolvedValueOnce([comment(101, coordinationBody(COORDINATION))]);
    const comments = await new GitHubGateway(CONFIG, { request }).comments(1);
    expect(comments).toHaveLength(101);
    expect(comments[100]?.body).toBe(coordinationBody(COORDINATION));
    expect(request.mock.calls[1]?.[1]).toContain("page=2");
  });

  it("rejects repeated cursors instead of silently truncating fields", async () => {
    const request: Request = async () => ({ data: { node: project({ fields: connection([], "same") }) } });
    await expect(new GitHubGateway(CONFIG, { request }).fields()).rejects.toThrow(/did not advance/u);
  });

  it("preserves option IDs and only changes fields named in the patch", async () => {
    const writes: { method: string; path: string; body?: unknown }[] = [];
    const request: Request = async (method, path, body) => {
      if (path === "graphql") {
        const { query, variables } = graphRequest(body);
        if (query.includes("TaskProjectFields(")) return { data: { node: project({ fields: variables.cursor ? connection(fields.slice(1)) : connection(fields.slice(0, 1), "next") }) } };
        if (query.includes("mutation TaskSetField(")) {
          writes.push({ method, path, body });
          return { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "ITEM_1" } } } };
        }
      }
      writes.push({ method, path, body });
      return null;
    };
    const gateway = new GitHubGateway(CONFIG, { request });
    await gateway.patchTask(snapshot(), { fields: { status: "Em execução" }, coordination: { ...COORDINATION, revision: 3 } });
    expect(writes).toHaveLength(2);
    expect(graphRequest(writes[0]?.body).variables).toEqual({ input: { projectId: CONFIG.projectId, itemId: "ITEM_1", fieldId: "FIELD_Status", value: { singleSelectOptionId: "OPTION_Em execução" } } });
    expect(writes[1]).toMatchObject({ method: "PATCH", path: "repos/owner/repo/issues/comments/1" });
    expect(JSON.stringify(writes)).not.toContain("FIELD_Prioridade");
    expect(JSON.stringify(writes)).not.toContain("Human scope");
    writes.length = 0;
    await gateway.patchTask(snapshot(), { fields: {}, body: "Human scope\n<!-- task-delivery:dev -->" });
    expect(writes).toEqual([{ method: "PATCH", path: "repos/owner/repo/issues/1", body: { body: "Human scope\n<!-- task-delivery:dev -->" } }]);
  });

  it("validates every requested option before making any mutation", async () => {
    const request = vi.fn<Request>().mockResolvedValue({ data: { node: project({ fields: connection(fields) }) } });
    await expect(new GitHubGateway(CONFIG, { request }).patchTask(snapshot(), { fields: { status: "Em execução", type: "Missing" } })).rejects.toThrow(/missing or ambiguous/u);
    expect(request).toHaveBeenCalledTimes(1);
    expect(graphRequest(request.mock.calls[0]?.[2]).query).toContain("query TaskProjectFields");
  });

  it("retries transient read failures but never blindly repeats a mutation", async () => {
    const reads = vi.fn<Request>().mockRejectedValueOnce(new GitHubApiError("GET", "user", 503)).mockResolvedValue({ login: "writer" });
    expect(await new GitHubGateway(CONFIG, { request: reads }).identity()).toBe("writer");
    expect(reads).toHaveBeenCalledTimes(2);
    const writes = vi.fn<Request>().mockRejectedValue(new GitHubApiError("POST", "issues/1/comments", 503));
    await expect(new GitHubGateway(CONFIG, { request: writes }).comment(1, "intent")).rejects.toThrow(/503/u);
    expect(writes).toHaveBeenCalledTimes(1);
    const unauthorized = vi.fn<Request>().mockRejectedValue(new GitHubApiError("GET", "user", 403));
    await expect(new GitHubGateway(CONFIG, { request: unauthorized }).identity()).rejects.toThrow(/403/u);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it("finds a creation receipt after page one without treating a PR as an issue", async () => {
    const request = vi.fn<Request>().mockResolvedValueOnce(Array.from({ length: 100 }, (_, n) => rawIssue(n + 1))).mockResolvedValueOnce([
      { ...rawIssue(101, `<!-- task-created:${OPERATION} -->`), pull_request: {} }, rawIssue(102, `scope\n<!-- task-created:${OPERATION} -->`),
    ]);
    expect((await new GitHubGateway(CONFIG, { request }).findCreatedIssue(OPERATION))?.number).toBe(102);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("refuses duplicate or foreign creation markers", async () => {
    const body = `<!-- task-created:${OPERATION} -->`;
    await expect(new GitHubGateway(CONFIG, { request: async () => [rawIssue(1, body), rawIssue(2, body)] }).findCreatedIssue(OPERATION)).rejects.toThrow(/Multiple issues/u);
    await expect(new GitHubGateway(CONFIG, { request: async () => [{ ...rawIssue(1, body), user: { login: "attacker" } }] }).findCreatedIssue(OPERATION)).rejects.toThrow(/Untrusted/u);
  });

  it("rejects arbitrary network targets before invoking gh", async () => {
    await expect(requestGitHub("GET", "https://attacker.example/data")).rejects.toThrow(/Invalid GitHub API request target/u);
    await expect(requestGitHub("GET", "repos/owner/../secret")).rejects.toThrow(/Invalid GitHub API request target/u);
  });
});

describe("GitHub retry headers", () => {
  it("parses the final HTTP response and discards unrelated headers", () => {
    const response = 'HTTP/1.1 100 Continue\r\n\r\nHTTP/2.0 200 OK\r\nContent-Type: application/json\r\nX-Unknown-Secret: should-not-survive\r\n\r\n{"login":"writer"}';
    expect(parseGitHubHttpResponse("GET", "user", response)).toEqual({ login: "writer" });
  });

  it("extracts safe error metadata without retaining response bodies or credentials", () => {
    const now = Date.parse(NOW);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const response = `HTTP/2.0 403 Forbidden\r\nDate: ${new Date(now).toUTCString()}\r\nRetry-After: 2\r\nX-RateLimit-Remaining: 0\r\nX-RateLimit-Reset: ${now / 1000 + 3}\r\nAuthorization: secret-header\r\n\r\n{"message":"secret-body"}`;
    let captured: unknown;
    try { parseGitHubHttpResponse("GET", "user", response); } catch (error) { captured = error; }
    expect(captured).toBeInstanceOf(GitHubApiError);
    expect(captured).toMatchObject({ status: 403, retryAfterAt: now + 2000, rateLimitRemaining: 0, rateLimitResetAt: now + 3000 });
    expect(String(captured)).not.toContain("secret");
    expect(JSON.stringify(captured)).not.toContain("secret");
  });

  it("keeps jitter after the server deadline and honors reset despite local clock skew", () => {
    const now = Date.parse(NOW);
    const retryAfter = new GitHubApiError("GET", "user", 429, { "retry-after": "2" }, now);
    expect(readRetryDelayMs(retryAfter, 0, now, 0)).toBe(2000);
    expect(readRetryDelayMs(retryAfter, 0, now, 0.999)).toBe(2249);
    const skewedClock = now + 3_600_000;
    const primaryLimit = new GitHubApiError("GET", "user", 403, { date: new Date(now).toUTCString(), "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 3) }, skewedClock);
    expect(readRetryDelayMs(primaryLimit, 0, skewedClock, 0)).toBe(3000);
    const dateLimit = new GitHubApiError("GET", "user", 403, { date: new Date(now).toUTCString(), "retry-after": new Date(now + 4000).toUTCString() }, skewedClock);
    expect(readRetryDelayMs(dateLimit, 0, skewedClock, 0)).toBe(4000);
  });

  it("uses exponential backoff for transient failures and does not retry ordinary permission errors", () => {
    const now = Date.parse(NOW);
    const transient = new GitHubApiError("GET", "user", 503, { "x-ratelimit-remaining": "25", "x-ratelimit-reset": String(now / 1000 + 3600) }, now);
    expect(readRetryDelayMs(transient, 0, now, 0)).toBe(500);
    expect(readRetryDelayMs(transient, 1, now, 1)).toBe(1250);
    expect(readRetryDelayMs(new GitHubApiError("GET", "user", 403), 0, now)).toBeNull();
    expect(readRetryDelayMs(new GitHubApiError("GET", "user", 429), 0, now, 0)).toBe(60_000);
  });

  it("does not anticipate a long instructed wait or retry with malformed metadata", async () => {
    const request = vi.fn<Request>().mockRejectedValue(new GitHubApiError("GET", "user", 429, { "retry-after": "120" }));
    await expect(new GitHubGateway(CONFIG, { request }).identity()).rejects.toThrow(/deferred to the scheduler/u);
    expect(request).toHaveBeenCalledTimes(1);
    expect(() => readRetryDelayMs(new GitHubApiError("GET", "user", 429, { "retry-after": "-1" }), 0)).toThrow(/metadata is invalid/u);
    expect(() => parseGitHubHttpResponse("GET", "user", "HTTP/2.0 429 Too Many Requests\nRetry-After: 1\nRetry-After: 2\n\n{}")).toThrow(/conflicting retry headers/u);
  });

  it("retries a short rate-limited read, with at most two retries for a persistent failure", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const rateLimited = vi.fn<Request>().mockRejectedValueOnce(new GitHubApiError("GET", "user", 403, { "retry-after": "0" })).mockResolvedValue({ login: "writer" });
    expect(await new GitHubGateway(CONFIG, { request: rateLimited }).identity()).toBe("writer");
    expect(rateLimited).toHaveBeenCalledTimes(2);
    const unavailable = vi.fn<Request>().mockRejectedValue(new GitHubApiError("GET", "user", 503));
    await expect(new GitHubGateway(CONFIG, { request: unavailable }).identity()).rejects.toThrow(/503/u);
    expect(unavailable).toHaveBeenCalledTimes(3);
  });

  it("never retries a mutation even when the server provides a short Retry-After", async () => {
    const request = vi.fn<Request>().mockRejectedValue(new GitHubApiError("POST", "issues/1/comments", 429, { "retry-after": "0" }));
    await expect(new GitHubGateway(CONFIG, { request }).comment(1, "intent")).rejects.toThrow(/429/u);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

function pullRequestHarness(options: { checks?: Json[]; statuses?: Json[]; headChanged?: boolean; graphIssuePages?: boolean; merged?: boolean } = {}) {
  let reads = 0;
  const check = { id: 1, name: "CI", app: { id: 99 }, head_sha: SHA, status: "completed", conclusion: "success" };
  const request: Request = async (_method, path, body) => {
    if (path === "repos/owner/repo/pulls/7") {
      reads++;
      return { number: 7, html_url: "https://github.com/owner/repo/pull/7", state: options.merged ? "closed" : "open", merged: options.merged ?? false, merged_at: options.merged ? NOW : null, base: { ref: "dev", repo: { full_name: CONFIG.repository } }, head: { ref: "feat/task", sha: options.headChanged && reads > 1 ? "b".repeat(40) : SHA } };
    }
    if (path === "graphql") {
      const { variables } = graphRequest(body);
      return { data: { repository: { ...repository, pullRequest: { number: 7, state: options.merged ? "MERGED" : "OPEN", merged: options.merged ?? false, headRefOid: SHA, baseRefName: "dev", mergeCommit: options.merged ? { oid: "c".repeat(40) } : null, closingIssuesReferences: connection([reference(variables.cursor ? 2 : 1)], options.graphIssuePages && !variables.cursor ? "next" : null) } } } };
    }
    const url = new URL(`https://api.github.com/${path}`);
    const page = Number(url.searchParams.get("page"));
    if (path.includes("/check-runs?")) {
      const checks = options.checks ?? [check];
      return { total_count: checks.length, check_runs: checks.slice((page - 1) * 100, page * 100) };
    }
    if (path.includes("/status?")) {
      const statuses = options.statuses ?? [];
      return { total_count: statuses.length, statuses: statuses.slice((page - 1) * 100, page * 100) };
    }
    throw new Error(`Unexpected PR request ${path}`);
  };
  return { gateway: new GitHubGateway(CONFIG, { request }), check };
}

describe("current delivery evidence", () => {
  it("checks the head and all native issue references", async () => {
    const evidence = await pullRequestHarness({ graphIssuePages: true }).gateway.pullRequest(7);
    expect(evidence).toMatchObject({ base: "dev", headSha: SHA, linkedIssues: [1, 2], checksSuccessful: true, mergeSha: null });
  });

  it("reads the native merge commit when REST 2026 omits merge_commit_sha", async () => {
    expect(await pullRequestHarness({ merged: true }).gateway.pullRequest(7)).toMatchObject({ state: "MERGED", mergeSha: "c".repeat(40), mergedAt: NOW });
  });

  it("does not accept the first hundred passing checks when the next page is pending", async () => {
    const checks = Array.from({ length: 101 }, (_, n) => ({ id: n + 1, name: `CI-${n}`, app: { id: 99 }, head_sha: SHA, status: n === 100 ? "in_progress" : "completed", conclusion: n === 100 ? null : "success" }));
    expect((await pullRequestHarness({ checks }).gateway.pullRequest(7)).checksSuccessful).toBe(false);
  });

  it("uses the newest check attempt without accepting another SHA or an empty check set", async () => {
    const { check } = pullRequestHarness();
    expect((await pullRequestHarness({ checks: [{ ...check, conclusion: "failure" }, { ...check, id: 2 }] }).gateway.pullRequest(7)).checksSuccessful).toBe(true);
    expect((await pullRequestHarness({ checks: [] }).gateway.pullRequest(7)).checksSuccessful).toBe(false);
    expect((await pullRequestHarness({ checks: [{ ...check, conclusion: "skipped" }] }).gateway.pullRequest(7)).checksSuccessful).toBe(false);
    await expect(pullRequestHarness({ checks: [{ ...check, head_sha: "b".repeat(40) }] }).gateway.pullRequest(7)).rejects.toThrow(/different PR head/u);
    await expect(pullRequestHarness({ headChanged: true }).gateway.pullRequest(7)).rejects.toThrow(/changed while its evidence/u);
  });

  it("includes failed commit status contexts after page one", async () => {
    const statuses = Array.from({ length: 101 }, (_, n) => ({ id: n + 1, context: `service-${n}`, state: n === 100 ? "failure" : "success" }));
    expect((await pullRequestHarness({ statuses }).gateway.pullRequest(7)).checksSuccessful).toBe(false);
  });

  it("returns the latest deployment state even if older events reported success", async () => {
    const request: Request = async (_method, path) => path.endsWith("/deployments/42")
      ? { id: 42, sha: SHA, ref: "main", environment: "production" }
      : [{ id: 10, state: "success", environment: "production", environment_url: "https://old.example" }, { id: 11, state: "failure", environment: "production", environment_url: "https://current.example" }];
    expect(await new GitHubGateway(CONFIG, { request }).deployment(42)).toEqual({ id: 42, sha: SHA, ref: "main", environment: "production", state: "failure", url: "https://current.example" });
  });

  it.each([{ status: "ahead", expected: true }, { status: "identical", expected: true }, { status: "behind", expected: false }, { status: "diverged", expected: false }])("verifies Git ancestry: $status", async ({ status, expected }) => {
    const request = vi.fn<Request>().mockResolvedValue({ status });
    expect(await new GitHubGateway(CONFIG, { request }).containsCommit(SHA, "b".repeat(40))).toBe(expected);
    expect(request.mock.calls[0]?.[1]).toBe(`repos/owner/repo/compare/${SHA}...${"b".repeat(40)}`);
  });

  it("does not guess ancestry for invalid SHAs or unknown GitHub responses", async () => {
    const gateway = new GitHubGateway(CONFIG, { request: async () => ({ status: "unknown" }) });
    await expect(gateway.containsCommit("dev", SHA)).rejects.toThrow(/full SHA-1/u);
    await expect(gateway.containsCommit(SHA, "b".repeat(40))).rejects.toThrow(/did not establish/u);
  });

  it("treats a workflow rerun still in progress as pending", async () => {
    const request: Request = async () => ({ id: 42, repository: { full_name: CONFIG.repository }, head_repository: { full_name: CONFIG.repository }, head_sha: SHA, head_branch: "dev", status: "in_progress", conclusion: "success", html_url: "https://github.com/owner/repo/actions/runs/42", name: "CI", path: ".github/workflows/ci.yml", run_attempt: 2, created_at: NOW });
    expect(await new GitHubGateway(CONFIG, { request }).workflowRun(42)).toMatchObject({ conclusion: null, path: ".github/workflows/ci.yml", attempt: 2, createdAt: NOW });
  });
});

const SMOKE_PATH = ".github/workflows/fumaca-producao.yml";
function workflowRun(id: number, overrides: Json = {}): Json {
  return { id, repository: { full_name: CONFIG.repository }, head_repository: { full_name: CONFIG.repository }, head_sha: SHA, head_branch: "main", status: "completed", conclusion: "success", html_url: `https://github.com/owner/repo/actions/runs/${id}`, name: "Fumaça em produção", path: SMOKE_PATH, run_attempt: 1, created_at: NOW, workflow_id: 70, ...overrides };
}

describe("latest workflow evidence", () => {
  it("finds a newer failed run after page one and rereads its current attempt", async () => {
    const runs = [...Array.from({ length: 100 }, (_, n) => workflowRun(n + 1)), workflowRun(101, { created_at: "2026-09-22T13:00:00Z" })];
    const request = vi.fn<Request>().mockImplementation(async (_method, path) => {
      if (path.endsWith("/workflows/fumaca-producao.yml")) return { id: 70, path: SMOKE_PATH };
      if (path === "repos/owner/repo/actions/runs/101") return workflowRun(101, { created_at: "2026-09-22T13:00:00Z", run_attempt: 3, conclusion: "failure" });
      const url = new URL(`https://api.github.com/${path}`);
      expect(url.pathname).toBe("/repos/owner/repo/actions/workflows/70/runs");
      expect(url.searchParams.get("head_sha")).toBe(SHA);
      const page = Number(url.searchParams.get("page"));
      return { total_count: runs.length, workflow_runs: runs.slice((page - 1) * 100, page * 100) };
    });
    const evidence = await new GitHubGateway(CONFIG, { request }).latestWorkflowRun(SMOKE_PATH, SHA);
    expect(evidence).toMatchObject({ id: 101, attempt: 3, conclusion: "failure", path: SMOKE_PATH, sha: SHA });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("uses the greater run ID when creation timestamps match", async () => {
    const request: Request = async (_method, path) => {
      if (path.endsWith("/workflows/fumaca-producao.yml")) return { id: 70, path: SMOKE_PATH };
      if (path === "repos/owner/repo/actions/runs/2") return workflowRun(2, { conclusion: "failure" });
      return { total_count: 2, workflow_runs: [workflowRun(1), workflowRun(2)] };
    };
    expect((await new GitHubGateway(CONFIG, { request }).latestWorkflowRun(SMOKE_PATH, SHA))?.conclusion).toBe("failure");
  });

  it("returns null when this exact workflow has no run for the SHA", async () => {
    const request: Request = async (_method, path) => path.endsWith("/workflows/fumaca-producao.yml") ? { id: 70, path: SMOKE_PATH } : { total_count: 0, workflow_runs: [] };
    expect(await new GitHubGateway(CONFIG, { request }).latestWorkflowRun(SMOKE_PATH, SHA)).toBeNull();
  });

  it("rejects a stale successful attempt if the run listing already reports a newer attempt", async () => {
    const request: Request = async (_method, path) => {
      if (path.endsWith("/workflows/fumaca-producao.yml")) return { id: 70, path: SMOKE_PATH };
      if (path === "repos/owner/repo/actions/runs/1") return workflowRun(1);
      return { total_count: 1, workflow_runs: [workflowRun(1, { run_attempt: 2, conclusion: "failure" })] };
    };
    await expect(new GitHubGateway(CONFIG, { request }).latestWorkflowRun(SMOKE_PATH, SHA)).rejects.toThrow(/older workflow attempt/u);
  });

  it("does not fall back to an old success if a later history page cannot be read", async () => {
    const request: Request = async (_method, path) => {
      if (path.endsWith("/workflows/fumaca-producao.yml")) return { id: 70, path: SMOKE_PATH };
      if (path.includes("page=2")) throw new GitHubApiError("GET", path, 403);
      return { total_count: 101, workflow_runs: Array.from({ length: 100 }, (_, n) => workflowRun(n + 1)) };
    };
    await expect(new GitHubGateway(CONFIG, { request }).latestWorkflowRun(SMOKE_PATH, SHA)).rejects.toThrow(/403/u);
  });

  it("refuses a filtered history at GitHub's thousand-result limit", async () => {
    const request: Request = async (_method, path) => {
      if (path.endsWith("/workflows/fumaca-producao.yml")) return { id: 70, path: SMOKE_PATH };
      const page = Number(new URL(`https://api.github.com/${path}`).searchParams.get("page"));
      return { total_count: 1000, workflow_runs: page <= 10 ? Array.from({ length: 100 }, (_, n) => workflowRun((page - 1) * 100 + n + 1)) : [] };
    };
    await expect(new GitHubGateway(CONFIG, { request }).latestWorkflowRun(SMOKE_PATH, SHA)).rejects.toThrow(/caps filtered workflow/u);
  });

  it("rejects foreign heads, malformed branches and mismatched workflow refs", async () => {
    for (const overrides of [{ head_repository: { full_name: "attacker/repo" } }, { head_branch: "main\n" }, { path: `${SMOKE_PATH}@attacker-branch` }]) {
      const gateway = new GitHubGateway(CONFIG, { request: async () => workflowRun(1, overrides) });
      await expect(gateway.workflowRun(1)).rejects.toThrow(/identity mismatch|invalid workflow head|untrusted workflow path/u);
    }
    const gateway = new GitHubGateway(CONFIG, { request: async () => workflowRun(1, { path: `${SMOKE_PATH}@main` }) });
    expect((await gateway.workflowRun(1)).path).toBe(SMOKE_PATH);
  });

  it("rejects a different workflow definition or runs outside the requested SHA", async () => {
    const wrongDefinition = new GitHubGateway(CONFIG, { request: async () => ({ id: 70, path: ".github/workflows/ci.yml" }) });
    await expect(wrongDefinition.latestWorkflowRun(SMOKE_PATH, SHA)).rejects.toThrow(/definition does not match/u);
    const wrongSha = new GitHubGateway(CONFIG, { request: async (_method, path) => path.endsWith("/workflows/fumaca-producao.yml") ? { id: 70, path: SMOKE_PATH } : { total_count: 1, workflow_runs: [workflowRun(1, { head_sha: "b".repeat(40) })] } });
    await expect(wrongSha.latestWorkflowRun(SMOKE_PATH, SHA)).rejects.toThrow(/outside the requested/u);
  });
});

describe("authenticated writer comments", () => {
  it("allows explicit read-only bootstrap only before any coordination or receipts exist", async () => {
    const empty = snapshotHarness({ comments: [], controls: [] });
    const gateway = new GitHubGateway(attestedConfig, { request: empty.request });
    expect(await gateway.readTask(1, 0)).toMatchObject({ manualEpoch: 0, coordination: null, status: "Backlog" });
    await expect(gateway.readTask(1)).rejects.toThrow(/not activated/u);
    const coordinated = snapshotHarness({ comments: [comment(1, attest(coordinationBody(COORDINATION), 1))], controls: [] });
    await expect(new GitHubGateway(attestedConfig, { request: coordinated.request }).readTask(1, 0)).rejects.toThrow(/not activated/u);
    const history = snapshotHarness({ comments: [], controls: [comment(2, attest(journalReceipt(COORDINATION, "confirmed"), 99))] });
    await expect(new GitHubGateway(attestedConfig, { request: history.request }).readTask(1, 0)).rejects.toThrow(/not activated/u);
  });

  it("supports CLI show and refresh through the real gateway during read-only bootstrap", async () => {
    const fixture = snapshotHarness({ comments: [], controls: [], parent: null });
    const request: Request = async (method, path, body) => {
      if (path === "user") return { login: "owner" };
      const result = await fixture.request(method, path, body);
      if (path === "graphql" && graphRequest(body).query.includes("TaskSnapshot(")) {
        const value = result as { data: { repository: { issue: Json } } };
        value.data.repository.issue.subIssues = connection([]);
      }
      return result;
    };
    const directory = await mkdtemp(join(await realpath(tmpdir()), "tasks-bootstrap-"));
    const output: string[] = [], errors: string[] = [];
    const runtime: CliRuntime = {
      config: attestedConfig, gateway: new GitHubGateway(attestedConfig, { request }), cwd: directory, now: () => Date.parse(NOW),
      sleep: async () => {}, workspace: async () => { throw new Error("Read-only bootstrap must not acquire a workspace"); },
      sign: async () => { throw new Error("Read-only bootstrap must not sign commands"); },
      readiness: async () => { throw new Error("show and refresh do not establish readiness"); },
      output: (message) => output.push(message), error: (message) => errors.push(message),
    };
    try {
      expect(await runCli(["show", "1", "--json"], runtime)).toBe(0);
      expect(JSON.parse(output[0]!)).toMatchObject({ bootstrap: true, manualEpoch: 0, coordination: null });
      const refreshed = await runCli(["refresh", "1", "--out", "projection", "--json"], runtime);
      expect({ refreshed, errors }).toEqual({ refreshed: 0, errors: [] });
      expect(JSON.parse(output[1]!)).toMatchObject({ bootstrap: true, authority: "GitHub", issues: [1] });
      expect(errors).toEqual([]);
      expect(await readFile(join(directory, "projection", "_tasks.md"), "utf8")).toContain("github-task-projection");
      expect(fixture.calls.every((call) => call.method === "GET" || call.path === "graphql" && graphRequest(call.body).query.startsWith("query "))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("signs control, coordination and receipts for their issue while leaving commands untouched", async () => {
    vi.stubEnv("TASKS_WRITER_PRIVATE_KEY", writerPrivateKey);
    const written: string[] = [];
    const request: Request = async (_method, _path, body) => {
      const value = (body as { body: string }).body;
      written.push(value);
      return comment(written.length, value);
    };
    const gateway = new GitHubGateway(attestedConfig, { request });
    for (const body of [control.body, coordinationBody(COORDINATION), journalReceipt(COORDINATION, "confirmed")]) {
      const saved = await gateway.comment(1, body);
      expect(stripWriterAttestation(saved.body)).toBe(body);
      expect(() => verifyWriterEnvelope(saved.body, writerPublicKey, "owner/repo#1")).not.toThrow();
      expect(() => verifyWriterEnvelope(saved.body, writerPublicKey, "owner/repo#2")).toThrow(/invalid/u);
    }
    const command = "<!-- tasks-command:v1 -->\n```json\n{}\n```";
    await gateway.comment(1, command);
    expect(written.at(-1)).toBe(command);
  });

  it("rejects an unsigned or altered receipt posted using the writer login", async () => {
    const signed = attest(journalReceipt(COORDINATION, "confirmed"), 99);
    const variants = [journalReceipt(COORDINATION, "confirmed"), signed.replace('"confirmed"', '"uncertain"'), attest(journalReceipt(COORDINATION, "confirmed"), 1)];
    for (const body of variants) {
      const gateway = new GitHubGateway(attestedConfig, { request: async () => [comment(1, body)] });
      await expect(gateway.comments(99)).rejects.toThrow(/attestation/u);
    }
    // A copied envelope under another login is dropped, not trusted, and does
    // not poison the writer's own comments on the same issue.
    const gateway = new GitHubGateway(attestedConfig, { request: async () => [comment(1, signed, "another-user"), comment(2, signed)] });
    expect((await gateway.comments(99)).map((c) => c.id)).toEqual([2]);
  });

  it("does not mutate anything when the signing key is absent, including a combined Project patch", async () => {
    vi.stubEnv("TASKS_WRITER_PRIVATE_KEY", undefined);
    const request = vi.fn<Request>();
    const gateway = new GitHubGateway(attestedConfig, { request });
    await expect(gateway.comment(1, coordinationBody(COORDINATION))).rejects.toThrow(/unavailable/u);
    await expect(gateway.updateComment(1, coordinationBody(COORDINATION))).rejects.toThrow(/unavailable/u);
    await expect(gateway.patchTask(snapshot(), { fields: { status: "Em execução" }, coordination: COORDINATION })).rejects.toThrow(/unavailable/u);
    expect(request).not.toHaveBeenCalled();
  });

  it("gets the native comment issue before signing an update and refuses a different repository", async () => {
    vi.stubEnv("TASKS_WRITER_PRIVATE_KEY", writerPrivateKey);
    const updates: unknown[] = [];
    let issueUrl = "https://api.github.com/repos/owner/repo/issues/1";
    const request: Request = async (method, _path, body) => {
      if (method === "GET") return { ...comment(1, attest(coordinationBody(COORDINATION), 1)), issue_url: issueUrl };
      updates.push(body);
      return null;
    };
    const gateway = new GitHubGateway(attestedConfig, { request });
    await gateway.updateComment(1, coordinationBody({ ...COORDINATION, revision: 3 }));
    const saved = (updates[0] as { body: string }).body;
    expect(() => verifyWriterEnvelope(saved, writerPublicKey, "owner/repo#1")).not.toThrow();
    expect(stripWriterAttestation(saved)).toBe(coordinationBody({ ...COORDINATION, revision: 3 }));
    issueUrl = "https://api.github.com/repos/another/repo/issues/1";
    await expect(gateway.updateComment(1, coordinationBody(COORDINATION))).rejects.toThrow(/another repository/u);
    expect(updates).toHaveLength(1);
  });

  it("rejects signed coordination replay after a newer confirmed operation", async () => {
    const next = { ...COORDINATION, revision: 3 };
    const fixture = snapshotHarness({
      comments: [comment(1, attest(coordinationBody(COORDINATION), 1))],
      controls: [comment(900, attest(control.body, 99)), comment(901, attest(journalReceipt(next, "confirmed"), 99))],
    });
    await expect(new GitHubGateway(attestedConfig, { request: fixture.request }).readTask(1)).rejects.toThrow(/replay/u);
  });

  it.each(["prepared", "uncertain"] as const)("preserves the before state for a %s operation awaiting reconciliation", async (phase) => {
    const next = { ...COORDINATION, revision: 3 };
    const fixture = snapshotHarness({
      comments: [comment(1, attest(coordinationBody(COORDINATION), 1))],
      controls: [comment(900, attest(control.body, 99)), comment(901, attest(journalReceipt(next, phase), 99))],
    });
    expect((await new GitHubGateway(attestedConfig, { request: fixture.request }).readTask(1)).coordination).toEqual(COORDINATION);
  });

  it("accepts the coordination recorded by the latest confirmed operation", async () => {
    const fixture = snapshotHarness({
      comments: [comment(1, attest(coordinationBody(COORDINATION), 1))],
      controls: [comment(900, attest(control.body, 99)), comment(901, attest(journalReceipt(COORDINATION, "confirmed"), 99))],
    });
    expect((await new GitHubGateway(attestedConfig, { request: fixture.request }).readTask(1)).coordination).toEqual(COORDINATION);
  });
});

function journalReceipt(coordination: Coordination, phase: Receipt["phase"]): string {
  return receiptBody({
    protocolVersion: 1, operationId: OPERATION, commandHash: "c".repeat(64), requestId: 1, issue: 1,
    phase, actor: "owner", message: "Task update", at: NOW, before: snapshot(), patch: { fields: {}, coordination },
  });
}
