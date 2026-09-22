import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { coordinationBody, hash, parseControl, parseCoordination, parseReceipt, snapshotRevision } from "./protocol.ts";
import { isWriterEnvelope, signWriterEnvelope, verifyWriterEnvelope } from "./attestation.ts";
import { STATUSES } from "./types.ts";
import type {
  Coordination, DeploymentEvidence, IssueData, ProjectConfig, ProjectField,
  PullRequestEvidence, RemoteComment, TaskGateway, TaskPatch, TaskSnapshot, TaskStatus, WorkflowRunEvidence,
} from "./types.ts";

type JsonObject = Record<string, unknown>;
type Request = (method: string, path: string, body?: unknown) => Promise<unknown>;
type VerifiedWorkflowRun = WorkflowRunEvidence & { path: string; attempt: number; createdAt: string };

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`GitHub returned an invalid ${label}`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`GitHub returned an incomplete ${label}`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`GitHub returned an invalid ${label}`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`GitHub returned an invalid ${label}`);
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`GitHub returned an invalid ${label}`);
  return value;
}

function issueState(value: unknown): "OPEN" | "CLOSED" {
  if (value === "open" || value === "OPEN") return "OPEN";
  if (value === "closed" || value === "CLOSED") return "CLOSED";
  throw new Error("GitHub returned an invalid issue state");
}

function status(value: unknown): TaskStatus | null {
  if (value === null) return null;
  if (!STATUSES.includes(value as TaskStatus)) throw new Error(`Unrecognized Project Status: ${String(value)}`);
  return value as TaskStatus;
}

function httpDate(value: string | undefined): number | undefined {
  if (!value || !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export class GitHubApiError extends Error {
  readonly status: number | undefined;
  readonly retryAfterAt: number | undefined;
  readonly rateLimitRemaining: number | undefined;
  readonly rateLimitResetAt: number | undefined;
  readonly invalidRetryHeaders: boolean;

  constructor(method: string, path: string, status?: number, headers: Record<string, string> = {}, receivedAt = Date.now()) {
    super(`GitHub ${method} ${path} failed${status ? ` (HTTP ${status})` : ""}`);
    this.name = "GitHubApiError";
    this.status = status;
    const values = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()]));
    const clock = httpDate(values.date) ?? receivedAt;
    const remaining = values["x-ratelimit-remaining"];
    const reset = values["x-ratelimit-reset"];
    const retryAfter = values["retry-after"];
    this.rateLimitRemaining = remaining !== undefined && /^\d+$/u.test(remaining) ? Number(remaining) : undefined;
    this.rateLimitResetAt = reset !== undefined && /^\d+$/u.test(reset) ? receivedAt + Math.max(0, Number(reset) * 1000 - clock) : undefined;
    this.retryAfterAt = retryAfter === undefined ? undefined : /^\d+(?:\.\d+)?$/u.test(retryAfter)
      ? receivedAt + Number(retryAfter) * 1000
      : httpDate(retryAfter) !== undefined ? receivedAt + Math.max(0, httpDate(retryAfter)! - clock) : undefined;
    this.invalidRetryHeaders = retryAfter !== undefined && !Number.isFinite(this.retryAfterAt) ||
      remaining !== undefined && !Number.isSafeInteger(this.rateLimitRemaining) ||
      reset !== undefined && !Number.isFinite(this.rateLimitResetAt);
  }
}

/** Only allowlisted numeric retry metadata survives an HTTP error. */
export function parseGitHubHttpResponse(method: string, path: string, output: string): unknown {
  let body = output;
  let status: number | undefined;
  let headers: Record<string, string> = {};
  while (body.startsWith("HTTP/")) {
    const separator = /\r?\n\r?\n/u.exec(body);
    if (!separator || separator.index === undefined) throw new Error("GitHub returned incomplete HTTP headers");
    const lines = body.slice(0, separator.index).split(/\r?\n/u);
    const statusLine = /^HTTP\/\d+(?:\.\d+)? (\d{3})(?: |$)/u.exec(lines.shift() ?? "");
    if (!statusLine?.[1]) throw new Error("GitHub returned an invalid HTTP status");
    status = Number(statusLine[1]);
    headers = {};
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon < 1) throw new Error("GitHub returned invalid HTTP headers");
      const name = line.slice(0, colon).toLowerCase();
      if (!["date", "retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"].includes(name)) continue;
      const value = line.slice(colon + 1).trim();
      if (headers[name] !== undefined && headers[name] !== value) throw new Error("GitHub returned conflicting retry headers");
      headers[name] = value;
    }
    body = body.slice(separator.index + separator[0].length);
  }
  if (status === undefined) throw new Error("GitHub omitted HTTP response headers");
  if (status < 200 || status >= 300) throw new GitHubApiError(method, path, status, headers);
  if (!body.trim()) return null;
  try { return JSON.parse(body) as unknown; }
  catch { throw new Error(`GitHub ${method} ${path} returned invalid JSON`); }
}

export function readRetryDelayMs(error: unknown, attempt: number, now = Date.now(), jitter = Math.random()): number | null {
  const code = error && typeof error === "object" && "status" in error ? error.status : undefined;
  const metadata = error instanceof GitHubApiError ? error : null;
  const limited = code === 429 || code === 403 && (metadata?.retryAfterAt !== undefined || metadata?.rateLimitRemaining === 0);
  if (!limited && !(typeof code === "number" && code >= 500 && code <= 599)) return null;
  if (metadata?.invalidRetryHeaders) throw new Error("GitHub retry metadata is invalid; retry deferred to the scheduler");
  const reset = metadata?.rateLimitRemaining === 0 ? metadata.rateLimitResetAt : undefined;
  const hints = [metadata?.retryAfterAt, reset].filter((value): value is number => value !== undefined);
  // A rate limit without a usable deadline needs at least one minute, outside this local retry budget.
  const minimum = limited && hints.length === 0 ? 60_000 : Math.max(0, ...hints.map((at) => at - now));
  return Math.max(minimum, 500 * 2 ** attempt) + Math.floor(Math.max(0, Math.min(jitter, 1)) * 250);
}

// Arguments and JSON travel separately; neither issue text nor credentials become shell code.
async function ghRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method) || !/^(?:graphql|[A-Za-z0-9][A-Za-z0-9_./?=&%+,:~-]*)$/u.test(path) || path.includes("://") || /(?:^|\/)\.\.?(?:\/|$)/u.test(path)) {
    throw new Error("Invalid GitHub API request target");
  }
  const args = ["api", "--include", "--hostname", "github.com", "--method", method,
    "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", path];
  if (body !== undefined) args.push("--input", "-");
  const env: NodeJS.ProcessEnv = { ...process.env, GH_PROMPT_DISABLED: "1" };
  delete env.TASKS_WRITER_PRIVATE_KEY;
  let output: string;
  try {
    output = execFileSync("gh", args, {
      encoding: "utf8", input: body === undefined ? undefined : JSON.stringify(body),
      timeout: 45_000, maxBuffer: 16 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
      env,
    });
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
    if (stdout.startsWith("HTTP/")) return parseGitHubHttpResponse(method, path, stdout);
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    const code = /\(HTTP (\d{3})\)/u.exec(stderr)?.[1];
    // Do not forward gh stderr, request bodies or environment values to logs.
    throw new GitHubApiError(method, path, code ? Number(code) : undefined);
  }
  return parseGitHubHttpResponse(method, path, output);
}

async function withReadRetry(request: Request, method: string, path: string, body?: unknown, read = method === "GET"): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try { return await request(method, path, body); }
    catch (error) {
      if (!read || attempt >= 2) throw error;
      const wait = readRetryDelayMs(error, attempt);
      if (wait === null) throw error;
      if (wait > 5000) throw new Error("GitHub requires a longer retry delay; retry deferred to the scheduler");
      await delay(wait);
    }
  }
}

export function requestGitHub(method: string, path: string, body?: unknown): Promise<unknown> {
  const query = body && typeof body === "object" && "query" in body ? body.query : undefined;
  return withReadRetry(ghRequest, method, path, body, method === "GET" || path === "graphql" && typeof query === "string" && query.trimStart().startsWith("query "));
}

const PAGE_INFO = "pageInfo { hasNextPage endCursor }";
const ISSUE_REFERENCE = "id number state repository { nameWithOwner }";
const PROJECT_REFERENCE = "id project { id }";
const ISSUE_CONNECTIONS = {
  assignees: "nodes { login }",
  subIssues: `nodes { ${ISSUE_REFERENCE} }`,
  blockedBy: `nodes { ${ISSUE_REFERENCE} }`,
  projectItems: `nodes { ${PROJECT_REFERENCE} }`,
  closedByPullRequestsReferences: "nodes { id number repository { nameWithOwner } }",
} as const;
type IssueConnection = keyof typeof ISSUE_CONNECTIONS;

export class GitHubGateway implements TaskGateway {
  private readonly config: ProjectConfig;
  private readonly request: Request;
  private readonly now: () => Date;
  private readonly owner: string;
  private readonly repo: string;
  private readonly base: string;

  constructor(config: ProjectConfig, options: { request?: Request; now?: () => Date } = {}) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(config.repository)) throw new Error("Invalid repository configuration");
    const [owner, repo] = config.repository.split("/");
    if (!owner || !repo) throw new Error("Invalid repository configuration");
    this.config = config;
    this.request = options.request ?? ghRequest;
    this.now = options.now ?? (() => new Date());
    this.owner = owner;
    this.repo = repo;
    this.base = `repos/${config.repository}`;
  }

  private async call(method: string, path: string, body?: unknown, read = method === "GET"): Promise<unknown> {
    return withReadRetry(this.request, method, path, body, read);
  }

  private async graphql(query: string, variables: JsonObject): Promise<JsonObject> {
    const result = object(await this.call("POST", "graphql", { query, variables }, query.trimStart().startsWith("query ")), "GraphQL response");
    if (result.errors !== undefined && array(result.errors, "GraphQL errors").length > 0) {
      throw new Error("GitHub GraphQL operation failed; partial data cannot establish task state");
    }
    return object(result.data, "GraphQL data");
  }

  private repository(value: unknown): JsonObject {
    const repo = object(value, "repository");
    if (string(repo.nameWithOwner, "repository name").toLowerCase() !== this.config.repository.toLowerCase()) throw new Error("GitHub returned a different repository");
    return repo;
  }

  private project(value: unknown): JsonObject {
    const project = object(value, "Project");
    const owner = object(project.owner, "Project owner");
    if (project.__typename !== "ProjectV2" || project.id !== this.config.projectId || project.number !== this.config.number ||
      string(owner.login, "Project owner login").toLowerCase() !== this.config.owner.toLowerCase()) {
      throw new Error("Configured Project identity does not match GitHub");
    }
    return project;
  }

  private async connection(initial: unknown, next: (cursor: string) => Promise<unknown>, label: string): Promise<JsonObject[]> {
    const nodes: JsonObject[] = [];
    const cursors = new Set<string>();
    const ids = new Set<string>();
    let page = initial;
    for (;;) {
      const data = object(page, `${label} connection`);
      for (const raw of array(data.nodes, `${label} nodes`)) {
        const node = object(raw, `${label} node`);
        const id = node.id ?? node.login;
        if (typeof id === "string") {
          if (ids.has(id)) throw new Error(`GitHub ${label} pagination repeated a node; reread the remote state`);
          ids.add(id);
        }
        nodes.push(node);
      }
      const info = object(data.pageInfo, `${label} pagination`);
      if (typeof info.hasNextPage !== "boolean") throw new Error(`GitHub omitted ${label} pagination`);
      if (!info.hasNextPage) return nodes;
      const cursor = string(info.endCursor, `${label} cursor`);
      if (cursors.has(cursor)) throw new Error(`GitHub ${label} pagination did not advance`);
      cursors.add(cursor);
      page = await next(cursor);
    }
  }

  private async restPages(path: string, property?: string): Promise<JsonObject[]> {
    const result: JsonObject[] = [];
    const ids = new Set<number | string>();
    for (let page = 1; ; page++) {
      const value = await this.call("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const envelope = property ? object(value, path) : null;
      const entries = array(envelope ? envelope[property!] : value, path);
      for (const entry of entries) {
        const item = object(entry, path);
        if (typeof item.id === "number" || typeof item.id === "string") {
          if (ids.has(item.id)) throw new Error(`GitHub ${path} pagination repeated a record; reread the remote state`);
          ids.add(item.id);
        }
        result.push(item);
      }
      if (entries.length < 100) {
        if (envelope && typeof envelope.total_count === "number" && result.length < envelope.total_count) throw new Error(`GitHub ${path} returned an incomplete page`);
        return result;
      }
    }
  }

  private connectionArgs(field: IssueConnection): string {
    return field === "projectItems" ? "includeArchived:false," : field === "closedByPullRequestsReferences" ? "includeClosedPrs:true," : "";
  }

  private async issueConnection(issue: number, field: IssueConnection, initial?: unknown): Promise<JsonObject[]> {
    const fetch = async (cursor: string | null): Promise<unknown> => {
      const data = await this.graphql(`query TaskIssueConnection($owner:String!,$repo:String!,$issue:Int!,$cursor:String){
        repository(owner:$owner,name:$repo){nameWithOwner issue(number:$issue){
          ${field}(${this.connectionArgs(field)}first:100,after:$cursor){${ISSUE_CONNECTIONS[field]} ${PAGE_INFO}}
        }}
      }`, { owner: this.owner, repo: this.repo, issue, cursor });
      return object(this.repository(data.repository).issue, "issue")[field];
    };
    return this.connection(initial ?? await fetch(null), fetch, field);
  }

  private relatedNumber(value: JsonObject): number {
    this.repository(value.repository);
    return integer(value.number, "related issue or PR number");
  }

  private async projectItem(issue: number, initial?: unknown): Promise<string> {
    const items = await this.issueConnection(issue, "projectItems", initial);
    const own = items.filter((item) => object(item.project, "item Project").id === this.config.projectId);
    if (own.length > 1) throw new Error(`Issue #${issue} has multiple items in the configured Project`);
    return own.length ? string(own[0]!.id, "Project item ID") : "";
  }

  private async itemValues(itemId: string): Promise<Map<string, string>> {
    if (!itemId) return new Map();
    const fetch = async (cursor: string | null): Promise<unknown> => {
      const data = await this.graphql(`query TaskItemFields($id:ID!,$cursor:String){node(id:$id){... on ProjectV2Item{
        id project{id} fieldValues(first:100,after:$cursor){nodes{
          ... on ProjectV2ItemFieldSingleSelectValue{id name field{... on ProjectV2SingleSelectField{id name}}}
          ... on ProjectV2ItemFieldDateValue{id date field{... on ProjectV2Field{id name}}}
          ... on ProjectV2ItemFieldTextValue{id text field{... on ProjectV2Field{id name}}}
        } ${PAGE_INFO}}
      }}}`, { id: itemId, cursor });
      const item = object(data.node, "Project item");
      if (item.id !== itemId || object(item.project, "item Project").id !== this.config.projectId) throw new Error("Project item identity changed");
      return item.fieldValues;
    };
    const nodes = await this.connection(await fetch(null), fetch, "item fields");
    const values = new Map<string, string>();
    for (const node of nodes) {
      // System fields such as assignees are not part of this typed projection.
      if (node.field === undefined) continue;
      const name = string(object(node.field, "item field").name, "field name");
      if (values.has(name)) throw new Error(`Project contains duplicate values for ${name}`);
      values.set(name, text(node.name ?? node.date ?? node.text, "field value"));
    }
    return values;
  }

  private trusted<T>(comments: RemoteComment[], parse: (body: string) => T | null, label: string): { value: T; commentId: number } | null {
    let found: { value: T; commentId: number } | null = null;
    for (const comment of comments) {
      const value = parse(comment.body);
      if (value === null) continue;
      if (comment.author.toLowerCase() !== this.config.writerLogin.toLowerCase()) throw new Error(`Untrusted author of ${label} comment`);
      if (found) throw new Error(`Multiple ${label} comments; reconciliation is required`);
      found = { value, commentId: comment.id };
    }
    return found;
  }

  private async manualEpoch(comments?: RemoteComment[]): Promise<number> {
    const control = this.trusted(comments ?? await this.comments(this.config.controlIssue), parseControl, "control");
    if (!control) throw new Error("The trusted writer control comment is missing; the workflow is not activated");
    return control.value.manualEpoch;
  }

  private verifyCoordinationJournal(issue: number, coordination: Coordination | null, comments: RemoteComment[]): void {
    const receipts = comments.flatMap((comment) => {
      const receipt = parseReceipt(comment.body);
      return receipt && receipt.issue === issue && receipt.phase !== "rejected" && receipt.patch?.coordination ? [receipt] : [];
    });
    if (receipts.length === 0) {
      if (coordination !== null) throw new Error("Coordination has no authenticated operation in the writer journal");
      return;
    }
    const latestRevision = receipts.reduce((latest, receipt) => Math.max(latest, receipt.patch!.coordination!.revision), -1);
    const latest = receipts.filter((receipt) => receipt.patch!.coordination!.revision === latestRevision);
    if (latest.length !== 1) throw new Error("Ambiguous coordination revision in the writer journal");
    const receipt = latest[0]!;
    if (hash(coordination) === hash(receipt.patch!.coordination)) return;
    if (["prepared", "uncertain"].includes(receipt.phase) && receipt.before && hash(coordination) === hash(receipt.before.coordination)) return;
    throw new Error("Remote coordination does not match the latest authenticated operation; replay or reconciliation required");
  }

  async identity(): Promise<string> {
    return string(object(await this.call("GET", "user"), "authenticated user").login, "authenticated login");
  }

  async permission(login: string): Promise<string> {
    return string(object(await this.call("GET", `${this.base}/collaborators/${encodeURIComponent(login)}/permission`), "permission").permission, "repository permission");
  }

  async fields(): Promise<ProjectField[]> {
    const fetch = async (cursor: string | null): Promise<unknown> => {
      const data = await this.graphql(`query TaskProjectFields($id:ID!,$cursor:String){node(id:$id){__typename ... on ProjectV2{
        id number owner{... on User{login} ... on Organization{login}}
        fields(first:100,after:$cursor){nodes{
          ... on ProjectV2Field{id name dataType}
          ... on ProjectV2SingleSelectField{id name dataType options{id name color description}}
          ... on ProjectV2IterationField{id name dataType}
        } ${PAGE_INFO}}
      }}}`, { id: this.config.projectId, cursor });
      return this.project(data.node).fields;
    };
    const nodes = await this.connection(await fetch(null), fetch, "Project fields");
    const names = new Set<string>();
    return nodes.map((node) => {
      const name = string(node.name, "Project field name");
      if (names.has(name)) throw new Error(`Project contains duplicate field ${name}`);
      names.add(name);
      const field: ProjectField = { id: string(node.id, "Project field ID"), name, dataType: string(node.dataType, "Project field type") };
      if (node.options !== undefined) field.options = array(node.options, "field options").map((value) => {
        const option = object(value, "field option");
        return { id: string(option.id, "option ID"), name: string(option.name, "option name"), color: string(option.color, "option color"), description: option.description === null ? "" : text(option.description, "option description") };
      });
      return field;
    });
  }

  async readTask(number: number, epoch?: number): Promise<TaskSnapshot> {
    integer(number, "issue number");
    const data = await this.graphql(`query TaskSnapshot($owner:String!,$repo:String!,$issue:Int!){repository(owner:$owner,name:$repo){nameWithOwner issue(number:$issue){
      id number url title body state stateReason updatedAt parent{${ISSUE_REFERENCE}}
      ${Object.entries(ISSUE_CONNECTIONS).map(([field, selection]) => `${field}(${this.connectionArgs(field as IssueConnection)}first:100){${selection} ${PAGE_INFO}}`).join("\n")}
    }}}`, { owner: this.owner, repo: this.repo, issue: number });
    const raw = object(this.repository(data.repository).issue, "issue");
    if (raw.number !== number) throw new Error("GitHub returned a different issue");
    const journal = this.comments(this.config.controlIssue);
    const [assignees, subIssues, dependencies, linked, itemId, comments, manualEpoch, journalComments] = await Promise.all([
      this.issueConnection(number, "assignees", raw.assignees),
      this.issueConnection(number, "subIssues", raw.subIssues),
      this.issueConnection(number, "blockedBy", raw.blockedBy),
      this.issueConnection(number, "closedByPullRequestsReferences", raw.closedByPullRequestsReferences),
      this.projectItem(number, raw.projectItems), this.comments(number),
      epoch === undefined ? journal.then((comments) => this.manualEpoch(comments)) : Promise.resolve(epoch),
      journal,
    ]);
    const values = await this.itemValues(itemId);
    const coordination = this.trusted<Coordination>(comments, parseCoordination, "coordination");
    if (journalComments) {
      const control = this.trusted(journalComments, parseControl, "control");
      if (!control) {
        // An explicit epoch zero labels read-only bootstrap queries. Existing signed state cannot be erased into bootstrap.
        if (epoch !== 0 || coordination !== null || journalComments.some((comment) => parseReceipt(comment.body) !== null)) {
          throw new Error("The trusted writer control comment is missing; the workflow is not activated");
        }
      } else {
        if (control.value.manualEpoch !== manualEpoch) throw new Error("Writer control epoch changed; reread the remote task");
        if (this.config.writerPublicKey !== undefined) this.verifyCoordinationJournal(number, coordination?.value ?? null, journalComments);
      }
    }
    const issue: IssueData = {
      id: string(raw.id, "issue ID"), number, url: string(raw.url, "issue URL"), title: string(raw.title, "issue title"), body: text(raw.body, "issue body"),
      state: issueState(raw.state), stateReason: raw.stateReason === null ? null : string(raw.stateReason, "issue state reason"),
      updatedAt: string(raw.updatedAt, "issue updated time"), assignees: assignees.map((person) => string(person.login, "assignee login")),
    };
    const resolvedDependencies = [];
    for (const dependency of dependencies) {
      const dependencyNumber = this.relatedNumber(dependency);
      const dependencyValues = await this.itemValues(await this.projectItem(dependencyNumber));
      resolvedDependencies.push({ number: dependencyNumber, state: issueState(dependency.state), status: status(dependencyValues.get("Status") ?? null) });
    }
    const snapshot: TaskSnapshot = {
      issue, projectId: this.config.projectId, itemId, status: status(values.get("Status") ?? null), priority: values.get("Prioridade") ?? null,
      type: values.get("Tipo") ?? null, startedAt: values.get("Iniciado em") ?? null, finishedAt: values.get("Concluído em") ?? null,
      parent: raw.parent === null ? null : this.relatedNumber(object(raw.parent, "parent issue")), dependencies: resolvedDependencies,
      subIssues: subIssues.map((item) => this.relatedNumber(item)), linkedPullRequests: linked.map((item) => this.relatedNumber(item)),
      coordination: coordination?.value ?? null, coordinationCommentId: coordination?.commentId ?? null,
      manualEpoch, revision: "", fetchedAt: this.now().toISOString(),
    };
    snapshot.revision = snapshotRevision(snapshot);
    return snapshot;
  }

  async listProjectTasks(): Promise<TaskSnapshot[]> {
    const fetch = async (cursor: string | null): Promise<unknown> => {
      const data = await this.graphql(`query TaskProjectItems($id:ID!,$cursor:String){node(id:$id){__typename ... on ProjectV2{
        id number owner{... on User{login} ... on Organization{login}}
        items(first:100,after:$cursor){nodes{id isArchived content{__typename ... on Issue{number repository{nameWithOwner}}}} ${PAGE_INFO}}
      }}}`, { id: this.config.projectId, cursor });
      return this.project(data.node).items;
    };
    const items = await this.connection(await fetch(null), fetch, "Project items");
    const epoch = await this.manualEpoch();
    const tasks: TaskSnapshot[] = [];
    const numbers = new Set<number>();
    for (const item of items) {
      if (item.isArchived === true || item.content === null) continue;
      const content = object(item.content, "Project content");
      if (content.__typename !== "Issue") continue;
      if (object(content.repository, "item repository").nameWithOwner !== this.config.repository) continue;
      const number = integer(content.number, "Project issue number");
      if (numbers.has(number)) throw new Error(`Issue #${number} has duplicate Project items`);
      numbers.add(number);
      tasks.push(await this.readTask(number, epoch));
    }
    return tasks;
  }

  private remoteComment(value: unknown, issue: number): RemoteComment {
    const comment = object(value, "issue comment");
    const result = {
      id: integer(comment.id, "comment ID"), body: text(comment.body, "comment body"), author: string(object(comment.user, "comment author").login, "comment login"),
      createdAt: string(comment.created_at, "comment creation time"), updatedAt: string(comment.updated_at, "comment update time"), url: string(comment.html_url, "comment URL"),
    };
    if (this.config.writerPublicKey !== undefined && isWriterEnvelope(result.body)) {
      if (result.author.toLowerCase() !== this.config.writerLogin.toLowerCase()) throw new Error("Untrusted author of writer envelope");
      verifyWriterEnvelope(result.body, this.config.writerPublicKey, `${this.config.repository}#${issue}`);
    }
    return result;
  }

  private signingKey(): string {
    const key = process.env.TASKS_WRITER_PRIVATE_KEY;
    if (!key) throw new Error("Writer signing key is unavailable");
    return key;
  }

  private writerBody(body: string, issue: number): string {
    return this.config.writerPublicKey !== undefined && isWriterEnvelope(body)
      ? signWriterEnvelope(body, this.signingKey(), this.config.writerPublicKey, `${this.config.repository}#${issue}`)
      : body;
  }

  async comments(issue: number): Promise<RemoteComment[]> {
    integer(issue, "issue number");
    return (await this.restPages(`${this.base}/issues/${issue}/comments`)).map((comment) => this.remoteComment(comment, issue));
  }

  async comment(issue: number, body: string): Promise<RemoteComment> {
    integer(issue, "issue number");
    const attested = this.writerBody(body, issue);
    return this.remoteComment(await this.call("POST", `${this.base}/issues/${issue}/comments`, { body: attested }), issue);
  }

  async updateComment(id: number, body: string): Promise<void> {
    integer(id, "comment ID");
    if (this.config.writerPublicKey !== undefined && isWriterEnvelope(body)) {
      this.signingKey();
      const current = object(await this.call("GET", `${this.base}/issues/comments/${id}`), "current issue comment");
      const prefix = `https://api.github.com/${this.base}/issues/`;
      const issueUrl = string(current.issue_url, "comment issue URL");
      if (!issueUrl.startsWith(prefix) || !/^[1-9][0-9]*$/u.test(issueUrl.slice(prefix.length))) throw new Error("Comment belongs to another repository");
      const issue = integer(Number(issueUrl.slice(prefix.length)), "comment issue number");
      const existing = this.remoteComment(current, issue);
      if (existing.id !== id || existing.author.toLowerCase() !== this.config.writerLogin.toLowerCase()) throw new Error("Comment writer identity mismatch");
      body = this.writerBody(body, issue);
    }
    await this.call("PATCH", `${this.base}/issues/comments/${id}`, { body });
  }

  async patchTask(snapshot: TaskSnapshot, patch: TaskPatch): Promise<void> {
    if (snapshot.projectId !== this.config.projectId || !snapshot.itemId) throw new Error("Task has no item in the configured Project");
    const coordination = patch.coordination ? this.writerBody(coordinationBody(patch.coordination), snapshot.issue.number) : null;
    const fields = Object.keys(patch.fields).length ? await this.fields() : [];
    const changes: { fieldId: string; value: JsonObject }[] = [];
    for (const [key, value] of Object.entries(patch.fields)) {
      const names: Record<string, string> = { status: "Status", priority: "Prioridade", type: "Tipo", startedAt: "Iniciado em", finishedAt: "Concluído em" };
      const name = names[key];
      if (!name) throw new Error(`Unsupported Project field patch: ${key}`);
      if (value === undefined) continue;
      const field = fields.find((candidate) => candidate.name === name);
      if (!field) throw new Error(`Required Project field ${name} is missing`);
      if (key === "startedAt" || key === "finishedAt") {
        if (field.dataType !== "DATE" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error(`Invalid date field ${name}`);
        changes.push({ fieldId: field.id, value: { date: value } });
      } else {
        const options = field.options?.filter((option) => option.name === value) ?? [];
        if (field.dataType !== "SINGLE_SELECT" || options.length !== 1) throw new Error(`Project option ${name}=${value} is missing or ambiguous`);
        changes.push({ fieldId: field.id, value: { singleSelectOptionId: options[0]!.id } });
      }
    }
    // Validate the entire patch before its first mutation. The coordinator journals partial failures.
    for (const change of changes) {
      const result = await this.graphql(`mutation TaskSetField($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}`, {
        input: { projectId: this.config.projectId, itemId: snapshot.itemId, ...change },
      });
      if (object(object(result.updateProjectV2ItemFieldValue, "field update").projectV2Item, "updated Project item").id !== snapshot.itemId) throw new Error("GitHub did not confirm the requested Project item update");
    }
    if (patch.body !== undefined) await this.call("PATCH", `${this.base}/issues/${snapshot.issue.number}`, { body: patch.body });
    if (coordination) {
      if (snapshot.coordinationCommentId === null) await this.comment(snapshot.issue.number, coordination);
      else await this.updateComment(snapshot.coordinationCommentId, coordination);
    }
    if (patch.close) await this.call("PATCH", `${this.base}/issues/${snapshot.issue.number}`, { state: "closed", state_reason: patch.close });
  }

  private restIssue(value: unknown): IssueData {
    const issue = object(value, "issue");
    if (issue.pull_request !== undefined) throw new Error("Expected a native issue, received a pull request");
    if (issue.repository_url !== `https://api.github.com/${this.base}`) throw new Error("Issue belongs to another repository");
    return {
      id: string(issue.node_id, "issue node ID"), number: integer(issue.number, "issue number"), url: string(issue.html_url, "issue URL"),
      title: string(issue.title, "issue title"), body: issue.body === null ? "" : text(issue.body, "issue body"), state: issueState(issue.state),
      stateReason: issue.state_reason === null ? null : string(issue.state_reason, "issue state reason"), updatedAt: string(issue.updated_at, "issue update time"),
      assignees: array(issue.assignees, "issue assignees").map((value) => string(object(value, "assignee").login, "assignee login")),
    };
  }

  async createIssue(title: string, body: string, assignee: string): Promise<IssueData> {
    return this.restIssue(await this.call("POST", `${this.base}/issues`, { title, body, assignees: [assignee] }));
  }

  async findCreatedIssue(operationId: string): Promise<IssueData | null> {
    if (!/^[A-Za-z0-9-]+$/u.test(operationId)) throw new Error("Invalid operation ID");
    const marker = `<!-- task-created:${operationId} -->`;
    const matches = (await this.restPages(`${this.base}/issues?state=all&sort=created&direction=asc`))
      .filter((issue) => !issue.pull_request && typeof issue.body === "string" && issue.body.includes(marker));
    if (matches.length > 1) throw new Error("Multiple issues carry this creation operation; reconciliation is required");
    if (!matches.length) return null;
    const issue = matches[0]!;
    if (string(object(issue.user, "issue author").login, "issue author login").toLowerCase() !== this.config.writerLogin.toLowerCase()) throw new Error("Untrusted issue creation marker");
    return this.restIssue(issue);
  }

  async addToProject(issueId: string): Promise<string> {
    const data = await this.graphql(`mutation TaskAddToProject($input:AddProjectV2ItemByIdInput!){addProjectV2ItemById(input:$input){item{id}}}`, {
      input: { projectId: this.config.projectId, contentId: issueId },
    });
    return string(object(object(data.addProjectV2ItemById, "added item").item, "Project item").id, "Project item ID");
  }

  private async issueNode(number: number): Promise<string> {
    integer(number, "issue number");
    return this.restIssue(await this.call("GET", `${this.base}/issues/${number}`)).id;
  }

  async addSubIssue(parent: number, childId: string): Promise<void> {
    const parentId = await this.issueNode(parent);
    await this.graphql(`mutation TaskAddSubIssue($input:AddSubIssueInput!){addSubIssue(input:$input){__typename}}`, { input: { issueId: parentId, subIssueId: childId } });
  }

  async addDependency(issue: number, blockedBy: number): Promise<void> {
    const [issueId, blockingIssueId] = await Promise.all([this.issueNode(issue), this.issueNode(blockedBy)]);
    await this.graphql(`mutation TaskAddDependency($input:AddBlockedByInput!){addBlockedBy(input:$input){__typename}}`, { input: { issueId, blockingIssueId } });
  }

  async pullRequest(number: number): Promise<PullRequestEvidence> {
    integer(number, "pull request number");
    const raw = object(await this.call("GET", `${this.base}/pulls/${number}`), "pull request");
    if (raw.number !== number) throw new Error("GitHub returned a different pull request");
    const base = object(raw.base, "PR base");
    if (object(base.repo, "PR repository").full_name !== this.config.repository) throw new Error("PR belongs to another repository");
    const head = object(raw.head, "PR head");
    const sha = string(head.sha, "PR head SHA");
    let mergeSha: string | null = null;
    const fetch = async (cursor: string | null): Promise<unknown> => {
      const data = await this.graphql(`query TaskPullRequestIssues($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){nameWithOwner pullRequest(number:$number){
        number state merged headRefOid baseRefName mergeCommit{oid}
        closingIssuesReferences(first:100,after:$cursor){nodes{${ISSUE_REFERENCE}} ${PAGE_INFO}}
      }}}`, { owner: this.owner, repo: this.repo, number, cursor });
      const pr = object(this.repository(data.repository).pullRequest, "pull request");
      if (pr.number !== number || pr.headRefOid !== sha || pr.baseRefName !== base.ref || pr.merged !== raw.merged ||
        pr.state !== (raw.merged === true ? "MERGED" : issueState(raw.state))) throw new Error("Pull request changed while its links were read");
      // REST 2026-03-10 removed merge_commit_sha. GraphQL retains the native merge commit.
      const currentMerge = pr.merged === true ? string(object(pr.mergeCommit, "PR merge commit").oid, "PR merge SHA") : null;
      if (cursor !== null && currentMerge !== mergeSha) throw new Error("Pull request merge changed while its links were read");
      mergeSha = currentMerge;
      return pr.closingIssuesReferences;
    };
    const [linked, checkRuns, statuses] = await Promise.all([
      this.connection(await fetch(null), fetch, "PR linked issues"),
      this.restPages(`${this.base}/commits/${encodeURIComponent(sha)}/check-runs?filter=latest`, "check_runs"),
      this.restPages(`${this.base}/commits/${encodeURIComponent(sha)}/status`, "statuses"),
    ]);
    const latestChecks = new Map<string, JsonObject>();
    for (const run of checkRuns) {
      if (run.head_sha !== sha) throw new Error("GitHub returned checks for a different PR head");
      const appId = integer(object(run.app, "check app").id, "check app ID");
      const key = `${appId}:${string(run.name, "check name")}`;
      if (integer(run.id, "check run ID") > Number(latestChecks.get(key)?.id ?? 0)) latestChecks.set(key, run);
    }
    const checks = [...latestChecks.values()];
    const checksSuccessful = checks.length + statuses.length > 0 &&
      checks.every((run) => run.status === "completed" && ["success", "neutral", "skipped"].includes(String(run.conclusion))) &&
      statuses.every((entry) => entry.state === "success") &&
      (statuses.length > 0 || checks.some((run) => run.conclusion === "success"));
    const fresh = object(await this.call("GET", `${this.base}/pulls/${number}`), "current pull request");
    if (object(fresh.head, "current PR head").sha !== sha || object(fresh.base, "current PR base").ref !== base.ref ||
      fresh.state !== raw.state || fresh.merged !== raw.merged || fresh.merge_commit_sha !== raw.merge_commit_sha) {
      throw new Error("Pull request changed while its evidence was read; reread the current head");
    }
    return {
      number, url: string(raw.html_url, "PR URL"), state: raw.merged === true ? "MERGED" : issueState(raw.state),
      base: string(base.ref, "PR base branch"), head: string(head.ref, "PR head branch"), headSha: sha,
      mergeSha,
      mergedAt: optionalString(raw.merged_at, "PR merged time"), linkedIssues: linked.map((issue) => this.relatedNumber(issue)), checksSuccessful,
    };
  }

  async deployment(id: number): Promise<DeploymentEvidence> {
    integer(id, "deployment ID");
    const raw = object(await this.call("GET", `${this.base}/deployments/${id}`), "deployment");
    if (raw.id !== id) throw new Error("GitHub returned a different deployment");
    const statuses = await this.restPages(`${this.base}/deployments/${id}/statuses`);
    const latest = statuses.reduce<JsonObject | null>((current, next) => !current || integer(next.id, "deployment status ID") > integer(current.id, "deployment status ID") ? next : current, null);
    return {
      id, sha: string(raw.sha, "deployment SHA"), ref: string(raw.ref, "deployment ref"),
      environment: latest && typeof latest.environment === "string" && latest.environment ? latest.environment : string(raw.environment, "deployment environment"),
      state: latest ? string(latest.state, "deployment state") : "pending",
      url: latest && typeof latest.environment_url === "string" && latest.environment_url ? latest.environment_url : null,
    };
  }

  async containsCommit(ancestor: string, descendant: string): Promise<boolean> {
    if (![ancestor, descendant].every((sha) => /^[a-f0-9]{40}$/u.test(sha))) throw new Error("Commit comparisons require full SHA-1 identifiers");
    const comparison = object(await this.call("GET", `${this.base}/compare/${ancestor}...${descendant}`), "commit comparison");
    if (comparison.status === "ahead" || comparison.status === "identical") return true;
    if (comparison.status === "behind" || comparison.status === "diverged") return false;
    throw new Error("GitHub did not establish commit ancestry");
  }

  private workflowEvidence(run: JsonObject, id: number): VerifiedWorkflowRun {
    if (run.id !== id || object(run.repository, "workflow repository").full_name !== this.config.repository ||
      object(run.head_repository, "workflow head repository").full_name !== this.config.repository) throw new Error("Workflow run identity mismatch");
    const sha = string(run.head_sha, "workflow head SHA");
    const branch = string(run.head_branch, "workflow branch");
    if (!/^[a-f0-9]{40}$/u.test(sha) || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith("/")) {
      throw new Error("GitHub returned an invalid workflow head");
    }
    const rawPath = string(run.path, "workflow path");
    const match = /^(\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9_.-]*\.ya?ml)(?:@(.+))?$/u.exec(rawPath);
    if (!match?.[1] || match[2] && ![branch, `refs/heads/${branch}`, sha].includes(match[2])) throw new Error("GitHub returned an untrusted workflow path");
    const createdAt = string(run.created_at, "workflow creation time");
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("GitHub returned an invalid workflow creation time");
    const url = string(run.html_url, "workflow URL");
    if (url !== `https://github.com/${this.config.repository}/actions/runs/${id}`) throw new Error("GitHub returned a different workflow run URL");
    return {
      id, sha, branch,
      conclusion: run.status === "completed" ? optionalString(run.conclusion, "workflow conclusion") : null,
      url, name: string(run.name, "workflow name"),
      path: match[1], attempt: integer(run.run_attempt, "workflow run attempt"), createdAt,
    };
  }

  async workflowRun(id: number): Promise<VerifiedWorkflowRun> {
    integer(id, "workflow run ID");
    return this.workflowEvidence(object(await this.call("GET", `${this.base}/actions/runs/${id}`), "workflow run"), id);
  }

  async latestWorkflowRun(path: string, sha: string): Promise<VerifiedWorkflowRun | null> {
    const match = /^\.github\/workflows\/([A-Za-z0-9][A-Za-z0-9_.-]*\.ya?ml)$/u.exec(path);
    if (!match?.[1] || !/^[a-f0-9]{40}$/u.test(sha)) throw new Error("Latest workflow evidence requires a canonical workflow path and full SHA");
    const workflow = object(await this.call("GET", `${this.base}/actions/workflows/${encodeURIComponent(match[1])}`), "workflow definition");
    if (workflow.path !== path) throw new Error("Workflow definition does not match the requested path");
    const workflowId = integer(workflow.id, "workflow ID");
    const runs = await this.restPages(`${this.base}/actions/workflows/${workflowId}/runs?head_sha=${sha}`, "workflow_runs");
    if (runs.length >= 1000) throw new Error("GitHub caps filtered workflow searches at 1000 results; latest evidence could not be established from complete history");
    let latest: VerifiedWorkflowRun | null = null;
    for (const raw of runs) {
      if (raw.workflow_id !== workflowId) throw new Error("GitHub returned runs for another workflow");
      const run = this.workflowEvidence(raw, integer(raw.id, "workflow run ID"));
      if (run.sha !== sha || run.path !== path) throw new Error("GitHub returned runs outside the requested workflow and SHA");
      if (!latest || Date.parse(run.createdAt) > Date.parse(latest.createdAt) || run.createdAt === latest.createdAt && run.id > latest.id) latest = run;
    }
    if (!latest) return null;
    const current = await this.workflowRun(latest.id);
    if (current.sha !== sha || current.path !== path || current.createdAt !== latest.createdAt || current.branch !== latest.branch) throw new Error("Workflow identity changed while reading its latest attempt");
    if (current.attempt < latest.attempt) throw new Error("GitHub returned an older workflow attempt than its current history");
    return current;
  }
}

export function createGitHubGateway(config: ProjectConfig): GitHubGateway {
  return new GitHubGateway(config);
}
