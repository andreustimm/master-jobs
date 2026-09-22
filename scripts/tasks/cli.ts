import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { createGitHubGateway } from "./github.ts";
import { commandBody, commandHash, parseCommand, parseControl, parseReceipt } from "./protocol.ts";
import { collectProjection, writeProjection } from "./projection.ts";
import { loadOrCreateExecutionKey } from "./signing.ts";
import { STATUSES } from "./types.ts";
import type { Command, ControlState, ProjectConfig, ProjectField, Receipt, RemoteComment, TaskGateway, TaskSnapshot, WorkspaceContext } from "./types.ts";

const execute = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXECUTION_ACTIONS = new Set(["claim", "heartbeat", "transition", "block", "resume", "release", "transfer"]);
const WRITES = new Set(["create", "adopt", "reconcile", ...EXECUTION_ACTIONS, "pause", "unpause"]);

export interface WriterReadiness {
  defaultBranch: string;
  workflowState: string;
  writerEnabled: string | null;
  enforcement: string | null;
  activationRun: { conclusion: string | null; sha: string; branch: string; sameWorkflow: boolean } | null;
}

export interface CliRuntime {
  config: ProjectConfig;
  gateway: TaskGateway;
  cwd: string;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  workspace(executionId: string): Promise<WorkspaceContext>;
  sign(command: Command): Promise<Command>;
  readiness(control: ControlState): Promise<WriterReadiness>;
  output(message: string): void;
  error(message: string): void;
}

export interface Submission {
  state: "confirmed" | "rejected" | "pending";
  operationId: string;
  message: string;
  requestUrl?: string;
  receipt?: Receipt;
}

function requireUuid(value: string | undefined, option: string): string {
  if (!value || !UUID.test(value)) throw new Error(`${option} exige um UUID válido.`);
  return value;
}

function issueNumber(value: string | undefined, label = "issue"): number {
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${label} exige um número de issue positivo.`);
  return Number(value);
}

function sameLogin(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }

export async function inspectWorkspace(executionId: string, cwd: string): Promise<WorkspaceContext> {
  requireUuid(executionId, "--execution");
  const git = async (...args: string[]) => (await execute("git", args, { cwd, encoding: "utf8" })).stdout.trim();
  const gitDirectory = await realpath(await git("rev-parse", "--absolute-git-dir"));
  const commonDirectory = await realpath(await git("rev-parse", "--path-format=absolute", "--git-common-dir"));
  const worktreePath = relative(commonDirectory, gitDirectory).replaceAll("\\", "/");
  if (!/^worktrees\/[^/]+$/.test(worktreePath)) throw new Error("Execute a tarefa em uma worktree vinculada, criada a partir de dev.");
  let branch: string;
  try { branch = await git("symbolic-ref", "--quiet", "--short", "HEAD"); }
  catch { throw new Error("Uma execução precisa de uma branch de tarefa; HEAD destacado não pode adquirir ou usar claim."); }
  if (["dev", "staging", "main"].includes(branch)) throw new Error("Branch permanente não pode adquirir ou usar claim de tarefa.");
  if (!/^(?:(?:feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert)\/[a-z0-9]+(?:[-.][a-z0-9]+)*|codex\/.+)$/.test(branch)) {
    throw new Error("A branch deve seguir <tipo>/<slug> conforme as regras do repositório.");
  }
  const binding = { executionId, branch, worktreeId: basename(gitDirectory) };
  const key = await loadOrCreateExecutionKey(gitDirectory, binding);
  return { ...binding, publicKey: key.publicKey };
}

export async function signExecutionCommand(command: Command, cwd: string): Promise<Command> {
  if (!command.execution) throw new Error("Assinatura de execução exige o vínculo da worktree.");
  const workspace = await inspectWorkspace(command.execution.executionId, cwd);
  if (workspace.branch !== command.execution.branch || workspace.worktreeId !== command.execution.worktreeId
    || workspace.publicKey !== command.execution.publicKey) throw new Error("A worktree mudou antes da assinatura do pedido.");
  const gitDirectory = await realpath((await execute("git", ["rev-parse", "--absolute-git-dir"], { cwd, encoding: "utf8" })).stdout.trim());
  const key = loadOrCreateExecutionKey(gitDirectory, { executionId: workspace.executionId, branch: workspace.branch, worktreeId: workspace.worktreeId });
  return key.sign(command);
}

function findTrustedControl(comments: RemoteComment[], writerLogin: string): ControlState | null {
  const controls = comments.filter((comment) => sameLogin(comment.author, writerLogin))
    .map((comment) => parseControl(comment.body)).filter((control): control is ControlState => control !== null);
  if (controls.length > 1) throw new Error(`Esperado um único controle do escritor confiável; encontrados ${controls.length}. Reconcilie o controle.`);
  return controls[0] ?? null;
}

export function trustedControl(comments: RemoteComment[], writerLogin: string): ControlState {
  const control = findTrustedControl(comments, writerLogin);
  if (!control) throw new Error("Controle do escritor confiável ainda não existe. Execute o bootstrap antes de enviar operações.");
  return control;
}

function matchingRequests(comments: RemoteComment[], operationId: string): { comment: RemoteComment; command: Command }[] {
  const requests: { comment: RemoteComment; command: Command }[] = [];
  for (const comment of comments) {
    let command: Command | null;
    try { command = parseCommand(comment.body); } catch { continue; }
    if (command?.operationId === operationId) requests.push({ comment, command });
  }
  return requests.sort((left, right) => left.comment.id - right.comment.id);
}

function assertRequestIdentity(requests: ReturnType<typeof matchingRequests>, command: Command, actor: string): void {
  const hash = commandHash(command);
  if (requests.some((request) => !sameLogin(request.comment.author, actor) || commandHash(request.command) !== hash)) {
    throw new Error("O operationId já pertence a outro ator ou payload. Reutilize o pedido original ou use um novo UUID.");
  }
}

/** A persisted intent is not a successful write: only the trusted writer's matching receipt can confirm it. */
export async function submitIntent(
  command: Command,
  runtime: Pick<CliRuntime, "config" | "gateway" | "now" | "sleep">,
  actor: string,
  timeoutMs = 60_000,
  initialComments?: RemoteComment[],
): Promise<Submission> {
  const { gateway, config } = runtime;
  let comments = initialComments ?? await gateway.comments(config.controlIssue);
  let requests = matchingRequests(comments, command.operationId);
  assertRequestIdentity(requests, command, actor);
  const pending = (message: string): Submission => ({ state: "pending", operationId: command.operationId, message,
    ...(requests[0] ? { requestUrl: requests[0].comment.url } : {}) });
  if (requests.length === 0) {
    try {
      const comment = await gateway.comment(config.controlIssue, commandBody(command));
      requests = [{ comment, command }];
      comments = [...comments, comment];
    } catch {
      return pending("A confirmação do envio se perdeu. Refaça o mesmo comando com o mesmo --operation; nenhuma conclusão foi presumida.");
    }
  }
  const deadline = runtime.now() + timeoutMs;
  const expectedHash = commandHash(command);
  for (;;) {
    const discovered = matchingRequests(comments, command.operationId);
    assertRequestIdentity(discovered, command, actor);
    if (discovered.length) requests = discovered;
    const receipts = comments.filter((comment) => sameLogin(comment.author, config.writerLogin))
      .map((comment) => ({ comment, receipt: parseReceipt(comment.body) }))
      .filter((entry): entry is { comment: RemoteComment; receipt: Receipt } => entry.receipt?.operationId === command.operationId);
    for (const { receipt } of receipts) {
      if (receipt.commandHash !== expectedHash || !sameLogin(receipt.actor, actor)
        || !requests.some((request) => request.comment.id === receipt.requestId)
        || (command.action !== "create" && receipt.issue !== command.issue)) {
        throw new Error("Recibo conflitante para o operationId; a operação precisa de reconciliação.");
      }
    }
    // The writer edits one receipt through prepared -> confirmed/uncertain.
    if (receipts.length > 1) throw new Error("Mais de um recibo para a mesma operação; reconcilie antes de continuar.");
    const receipt = receipts[0]?.receipt;
    if (receipt?.phase === "confirmed" || receipt?.phase === "rejected") {
      return { state: receipt.phase, operationId: command.operationId, message: receipt.message, receipt, requestUrl: requests[0]!.comment.url };
    }
    if (receipt?.phase === "uncertain") return { ...pending(receipt.message), receipt };
    if (runtime.now() >= deadline) return pending("Pedido persistido, mas ainda sem recibo confirmado. Aguarde ou repita com o mesmo --operation.");
    await runtime.sleep(Math.min(2_000, deadline - runtime.now()));
    try { comments = await gateway.comments(config.controlIssue); }
    catch { return pending("Não foi possível reler o recibo remoto. Repita com o mesmo --operation; o estado local não autoriza continuar."); }
  }
}

export function verifyOwnership(task: TaskSnapshot, workspace: WorkspaceContext, actor: string, now: number): void {
  const execution = task.coordination?.execution;
  if (!task.itemId || !execution || !sameLogin(execution.actor, actor)
    || execution.executionId !== workspace.executionId || execution.branch !== workspace.branch
    || execution.worktreeId !== workspace.worktreeId || execution.publicKey !== workspace.publicKey || execution.generation !== task.coordination?.generation
    || (workspace.generation !== undefined && workspace.generation !== execution.generation)) {
    throw new Error("O claim remoto não pertence a esta execução, branch e worktree. Nenhum recibo local concede posse.");
  }
  if (!Number.isFinite(Date.parse(execution.expiresAt)) || Date.parse(execution.expiresAt) <= now) {
    throw new Error("Lease remoto vencido; suspenda o trabalho e reconcilie a posse antes de retomar.");
  }
  if (task.issue.state !== "OPEN" || task.status === "Concluído" || task.status === "Cancelado") {
    throw new Error("A issue não está disponível para execução.");
  }
}

export function fieldProblems(fields: ProjectField[]): string[] {
  const problems: string[] = [];
  const field = (name: string) => {
    const matches = fields.filter((entry) => entry.name === name);
    if (matches.length !== 1) problems.push(`Campo ${name}: esperado um, encontrados ${matches.length}.`);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const status = field("Status");
  if (status && (status.dataType !== "SINGLE_SELECT" || JSON.stringify(status.options?.map((option) => option.name)) !== JSON.stringify(STATUSES))) {
    problems.push("As dez opções de Status precisam corresponder à ordem canônica.");
  }
  if (status && JSON.stringify(status.options?.map((option) => option.color)) !== JSON.stringify(["PURPLE", "GRAY", "RED", "BLUE", "ORANGE", "YELLOW", "PINK", "PURPLE", "GREEN", "GRAY"])) {
    problems.push("As cores de Status precisam corresponder à configuração canônica.");
  }
  const priority = field("Prioridade");
  if (priority && (priority.dataType !== "SINGLE_SELECT" || JSON.stringify(priority.options?.map((option) => option.name)) !== JSON.stringify(["Crítica", "Alta", "Média", "Baixa"]))) {
    problems.push("Prioridade precisa conter Crítica, Alta, Média e Baixa.");
  }
  const type = field("Tipo");
  if (type && (type.dataType !== "SINGLE_SELECT" || JSON.stringify(type.options?.map((option) => option.name)) !== JSON.stringify(["feat", "fix", "docs", "chore", "refactor", "test", "perf", "ci", "build", "style", "revert"]))) {
    problems.push("Tipo precisa conter os tipos canônicos de Conventional Commits, na ordem configurada.");
  }
  for (const name of ["Iniciado em", "Concluído em"]) {
    const date = field(name);
    if (date && date.dataType !== "DATE") problems.push(`${name} precisa ser um campo de data.`);
  }
  return problems;
}

export function activationProblems(control: ControlState, readiness: WriterReadiness, requireEnforcement: boolean): string[] {
  const problems: string[] = [];
  if (control.paused) problems.push("O escritor está pausado para alteração manual coordenada.");
  if (!control.activation || control.activation.status !== "ready") problems.push("O bootstrap do escritor ainda não foi confirmado remotamente.");
  if (readiness.defaultBranch !== "main") problems.push("A branch padrão confiável deve ser main.");
  if (readiness.workflowState !== "active") problems.push("O workflow do escritor não está ativo na branch padrão.");
  if (readiness.writerEnabled !== "true") problems.push("TASKS_WRITER_ENABLED ainda não está habilitado.");
  if (requireEnforcement && readiness.enforcement !== "true") problems.push("TASKS_ENFORCEMENT ainda não está habilitado.");
  const run = readiness.activationRun;
  if (!run || run.conclusion !== "success" || run.branch !== readiness.defaultBranch
    || run.sha !== control.activation?.sha || !run.sameWorkflow) {
    problems.push("A ativação não possui execução bem-sucedida do workflow confiável no SHA registrado de main.");
  }
  return problems;
}

const HELP = `Uso: pnpm tasks <comando> [opções]\n\n`
  + `show <issue> [--json]\ncreate --title <texto> --body-file <arquivo> --priority <prioridade> --type <tipo> --delivery <dev|production|artifact|operation> [--parent <issue>] [--depends-on <issues>]\n`
  + `adopt <issue> --priority <prioridade> --type <tipo> --delivery <entrega>\nclaim <issue> --execution <uuid>\n`
  + `heartbeat <issue> --execution <uuid> --revision <revisão>\ntransition <issue> --execution <uuid> --revision <revisão> --status <status> --evidence <url>\n`
  + `block <issue> --execution <uuid> --revision <revisão> --reason <motivo>\nresume <issue> --execution <uuid> --revision <revisão> --evidence <url>\n`
  + `release <issue> --execution <uuid> --revision <revisão> --reason <motivo>\ntransfer <issue> --execution <uuid> --revision <revisão> --to-execution <uuid> --to-branch <branch> --to-worktree <id> --to-public-key <SPKI-base64> --reason <motivo>\n`
  + `reconcile <issue> --revision <revisão> --reason <motivo> --evidence <url>\npause --reason <motivo>\nunpause --reason <motivo>\n`
  + `key --execution <uuid>\nrefresh <issue> --out <diretório exclusivo>\nverify <issue> --execution <uuid>\npreflight [--json]\n\n`
  + `Escritas aceitam --operation <uuid>, --timeout-ms <0..300000> e --json. Sem recibo confirmado: saída 2 (pendente).\n`;

const OPTIONS = {
  json: { type: "boolean" as const }, help: { type: "boolean" as const }, evidence: { type: "string" as const, multiple: true },
  ...Object.fromEntries(["title", "body-file", "priority", "type", "delivery", "parent", "depends-on", "execution", "revision", "status", "reason", "to-execution", "to-branch", "to-worktree", "to-public-key", "out", "operation", "timeout-ms"].map((name) => [name, { type: "string" as const }])),
};

const ALLOWED: Record<string, string[]> = {
  show: [], preflight: [], key: ["execution"], verify: ["execution"], refresh: ["out"],
  create: ["title", "body-file", "priority", "type", "delivery", "parent", "depends-on"],
  adopt: ["priority", "type", "delivery"], claim: ["execution"], heartbeat: ["execution", "revision"],
  transition: ["execution", "revision", "status", "evidence", "reason"], block: ["execution", "revision", "reason"],
  resume: ["execution", "revision", "evidence"], release: ["execution", "revision", "reason"],
  transfer: ["execution", "revision", "to-execution", "to-branch", "to-worktree", "to-public-key", "reason"],
  reconcile: ["revision", "reason", "evidence"], pause: ["reason"], unpause: ["reason"],
};

/** Exit 0 means verified success, 1 a rejection/error, and 2 an unconfirmed remote operation. */
export async function runCli(argv: string[], runtime: CliRuntime): Promise<number> {
  try {
    const parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    const values = parsed.values as Record<string, string | string[] | boolean | undefined>;
    const action = parsed.positionals[0];
    if (values.help || !action || action === "help") { runtime.output(HELP); return 0; }
    if (!(action in ALLOWED)) throw new Error(`Comando desconhecido: ${action}. Use --help.`);
    const allowed = new Set(["json", "help", ...ALLOWED[action]!, ...(WRITES.has(action) ? ["operation", "timeout-ms"] : [])]);
    for (const option of Object.keys(values)) if (!allowed.has(option)) throw new Error(`--${option} não é uma opção de ${action}.`);
    const text = (name: string, required = false): string | undefined => {
      const value = values[name];
      if (typeof value === "string" && value.trim()) return value;
      if (required) throw new Error(`--${name} é obrigatório.`);
      return undefined;
    };
    const noIssue = ["preflight", "key", "create", "pause", "unpause"].includes(action);
    if (parsed.positionals.length !== (noIssue ? 1 : 2)) throw new Error(`Argumentos inesperados para ${action}. Use --help.`);
    const issue = noIssue ? runtime.config.controlIssue : issueNumber(parsed.positionals[1]);
    const emit = (value: unknown) => runtime.output(typeof value === "string" && !values.json ? value : JSON.stringify(value, null, 2));
    if (action === "key") {
      emit(await runtime.workspace(requireUuid(text("execution", true), "--execution")));
      return 0;
    }
    const actor = await runtime.gateway.identity();
    const comments = await runtime.gateway.comments(runtime.config.controlIssue);
    const remoteControl = findTrustedControl(comments, runtime.config.writerLogin);
    if (!remoteControl && !["show", "refresh", "preflight"].includes(action)) throw new Error("Controle do escritor confiável ainda não existe. Execute o bootstrap antes de enviar operações.");
    // Epoch zero is only a read-time bootstrap label; it never authorizes an operation.
    const control: ControlState = remoteControl ?? { protocolVersion: 1, paused: true, manualEpoch: 0, lastOperation: "00000000-0000-4000-8000-000000000000" };
    const bootstrap = remoteControl === null;
    if (action === "preflight") {
      const [permission, fields, readiness] = await Promise.all([
        runtime.gateway.permission(actor), runtime.gateway.fields(), runtime.readiness(control),
      ]);
      const problems = [...fieldProblems(fields), ...activationProblems(control, readiness, true)];
      if (bootstrap) problems.unshift("O controle confiável ainda não foi inicializado; somente consultas estão disponíveis.");
      if (!["admin", "maintain", "write"].includes(permission)) problems.push("A identidade atual não tem permissão de escrita no repositório.");
      emit({ ready: problems.length === 0, actor, repository: runtime.config.repository, project: runtime.config.number, problems });
      return problems.length ? 1 : 0;
    }
    if (action === "refresh") {
      const output = text("out", true)!;
      if (output.split(/[\\/]/).includes("..")) throw new Error("--out não pode conter '..'.");
      const tasks = await collectProjection(runtime.gateway, issue, control.manualEpoch);
      const directory = await writeProjection(resolve(runtime.cwd, output), runtime.config, issue, tasks);
      emit({ directory, issues: tasks.map((task) => task.issue.number), authority: "GitHub", bootstrap });
      return 0;
    }
    const snapshot = noIssue ? undefined : await runtime.gateway.readTask(issue, control.manualEpoch);
    if (action === "show") { emit({ ...snapshot, bootstrap }); return 0; }
    if (action === "verify") {
      const problems = activationProblems(control, await runtime.readiness(control), false);
      if (problems.length) throw new Error(problems.join(" "));
      const workspace = await runtime.workspace(requireUuid(text("execution", true), "--execution"));
      verifyOwnership(snapshot!, workspace, actor, runtime.now());
      emit({ verified: true, issue, revision: snapshot!.revision, execution: snapshot!.coordination!.execution });
      return 0;
    }
    const operationId = text("operation") ? requireUuid(text("operation"), "--operation") : randomUUID();
    const existingRequests = matchingRequests(comments, operationId);
    const original = existingRequests[0]?.command;
    if (existingRequests.some((request) => !sameLogin(request.comment.author, actor))) throw new Error("Este operationId pertence a outro ator.");
    let command: Command = { protocolVersion: 1, operationId, action: action as Command["action"], issue };
    if (EXECUTION_ACTIONS.has(action)) {
      const workspace = await runtime.workspace(requireUuid(text("execution", true), "--execution"));
      command.execution = workspace;
      if (action !== "claim") {
        command.expectedRevision = text("revision", true)!;
        // A retry keeps the original fencing generation even after a successful transfer/release.
        const execution = original?.execution ?? snapshot!.coordination?.execution;
        if (execution?.generation !== undefined) command.execution.generation = execution.generation;
      } else command.expectedRevision = original?.expectedRevision ?? snapshot!.revision;
    }
    if (action === "adopt") {
      command.expectedRevision = original?.expectedRevision ?? snapshot!.revision;
      command.adopt = { delivery: text("delivery", true) as NonNullable<Command["adopt"]>["delivery"], priority: text("priority", true) as NonNullable<Command["adopt"]>["priority"], type: text("type", true)! };
    }
    if (action === "create") {
      command.create = {
        title: text("title", true)!, body: await readFile(resolve(runtime.cwd, text("body-file", true)!), "utf8"),
        priority: text("priority", true) as NonNullable<Command["create"]>["priority"], type: text("type", true)!,
        delivery: text("delivery", true) as NonNullable<Command["create"]>["delivery"],
        dependsOn: text("depends-on")?.split(",").map((value) => issueNumber(value.trim(), "--depends-on")) ?? [],
        ...(text("parent") ? { parent: issueNumber(text("parent"), "--parent") } : {}),
      };
    }
    if (action === "reconcile") command.expectedRevision = text("revision", true)!;
    if (action === "transition") command.status = text("status", true) as Command["status"];
    if (["block", "release", "transfer", "pause", "unpause", "reconcile"].includes(action)) command.reason = text("reason", true)!;
    else if (text("reason")) command.reason = text("reason");
    if (values.evidence) command.evidence = values.evidence as string[];
    if (["transition", "resume", "reconcile"].includes(action) && !command.evidence?.length) throw new Error("--evidence é obrigatório para esta operação.");
    if (action === "transfer") command.transferTo = {
      executionId: requireUuid(text("to-execution", true), "--to-execution"), branch: text("to-branch", true)!, worktreeId: text("to-worktree", true)!, publicKey: text("to-public-key", true)!,
    };
    if (EXECUTION_ACTIONS.has(action)) command = await runtime.sign(command);
    // Use the same strict wire parser as the coordinator before persisting an intent.
    if (!parseCommand(commandBody(command))) throw new Error("Pedido inválido para o protocolo do coordenador.");
    assertRequestIdentity(existingRequests, command, actor);
    if (!original && EXECUTION_ACTIONS.has(action) && action !== "claim") {
      if (snapshot!.revision !== command.expectedRevision) throw new Error("Revisão remota mudou; releia a issue antes de enviar uma nova intenção.");
      verifyOwnership(snapshot!, command.execution!, actor, runtime.now());
    }
    const timeout = text("timeout-ms") ?? "60000";
    if (!/^\d+$/.test(timeout) || Number(timeout) > 300_000) throw new Error("--timeout-ms deve estar entre 0 e 300000.");
    if (!values.json) runtime.output(`Operação ${operationId}`);
    const result = await submitIntent(command, runtime, actor, Number(timeout), comments);
    emit(result);
    return result.state === "confirmed" ? 0 : result.state === "pending" ? 2 : 1;
  } catch (error) {
    runtime.error(error instanceof Error ? error.message : "Falha ao executar o comando de tarefas.");
    return 1;
  }
}

async function githubJson<T>(path: string, allowMissing = false): Promise<T | null> {
  try {
    const result = await execute("gh", ["api", path], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    if (allowMissing && String((error as { stderr?: string }).stderr).includes("HTTP 404")) return null;
    // CLI diagnostics never echo response bodies or authentication material.
    throw new Error("Não foi possível verificar a configuração remota do escritor com gh.");
  }
}

export async function inspectWriterReadiness(config: ProjectConfig, control: ControlState): Promise<WriterReadiness> {
  const [repository, workflow, writerEnabled, enforcement] = await Promise.all([
    githubJson<{ default_branch: string }>(`repos/${config.repository}`),
    githubJson<{ id: number; state: string }>(`repos/${config.repository}/actions/workflows/${encodeURIComponent(basename(config.workflow))}`, true),
    githubJson<{ value: string }>(`repos/${config.repository}/actions/variables/TASKS_WRITER_ENABLED`, true),
    githubJson<{ value: string }>(`repos/${config.repository}/actions/variables/TASKS_ENFORCEMENT`, true),
  ]);
  const run = control.activation ? await githubJson<{ conclusion: string | null; head_sha: string; head_branch: string; workflow_id: number }>(`repos/${config.repository}/actions/runs/${control.activation.workflowRun}`, true) : null;
  return {
    defaultBranch: repository!.default_branch, workflowState: workflow?.state ?? "missing",
    writerEnabled: writerEnabled?.value ?? null, enforcement: enforcement?.value ?? null,
    activationRun: run ? { conclusion: run.conclusion, sha: run.head_sha, branch: run.head_branch, sameWorkflow: run.workflow_id === workflow?.id } : null,
  };
}

export async function loadProjectConfig(cwd: string): Promise<ProjectConfig> {
  const config = JSON.parse(await readFile(resolve(cwd, "config/tasks-project.json"), "utf8")) as ProjectConfig;
  if (config.protocolVersion !== 1 || !/^[\w.-]+\/[\w.-]+$/.test(config.repository)
    || !config.owner || !Number.isSafeInteger(config.number) || config.number < 1 || !config.projectId
    || !Number.isSafeInteger(config.controlIssue) || config.controlIssue < 1 || !config.writerLogin || !config.workflow) {
    throw new Error("config/tasks-project.json está incompleto ou inválido.");
  }
  return config;
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--help") || process.argv[2] === "help" || process.argv.length === 2) {
    console.log(HELP); return;
  }
  const cwd = process.cwd();
  const config = await loadProjectConfig(cwd);
  process.exitCode = await runCli(process.argv.slice(2), {
    config, gateway: createGitHubGateway(config), cwd, now: Date.now,
    sleep: async (milliseconds) => { await new Promise((done) => setTimeout(done, milliseconds)); },
    workspace: (executionId) => inspectWorkspace(executionId, cwd), sign: (command) => signExecutionCommand(command, cwd),
    readiness: (control) => inspectWriterReadiness(config, control),
    output: console.log, error: console.error,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Falha na CLI de tarefas."); process.exitCode = 1; });
}
