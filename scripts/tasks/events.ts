import { requestGitHub } from "./github.ts";
import { deliveryWindowStart } from "./evidence.ts";
import { deliveryOf, hash, parseControl } from "./protocol.ts";
import type { ControlState, ProjectConfig, PullRequestEvidence, TaskGateway, TaskSnapshot, TaskStatus } from "./types.ts";

export interface EventEvidence {
  issue: number;
  eventId: string;
  message: string;
  suggestedStatus?: TaskStatus;
  evidence: string[];
}

type ObjectValue = Record<string, unknown>;
type Control = { state: ControlState; updatedAt: string };
type SourceEvent = {
  id: string;
  occurredAt: string | null;
  pullRequests: PullRequestEvidence[];
  evidence: string[];
  invalid?: string;
  kind: "pr" | "ci" | "deployment";
  headSha?: string;
  headBranch?: string;
  deployment?: { id: number; sha: string; ref: string; environment: string; state: string };
};

function object(value: unknown): ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
}

function id(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function sha(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

async function control(gateway: TaskGateway, config: ProjectConfig): Promise<Control | null> {
  const found: Control[] = [];
  for (const comment of await gateway.comments(config.controlIssue)) {
    if (comment.author !== config.writerLogin) continue;
    try {
      const state = parseControl(comment.body);
      if (state) found.push({ state, updatedAt: comment.updatedAt });
    } catch {
      return null;
    }
  }
  return found.length === 1 ? found[0]! : null;
}

async function metadataPages(path: string, field?: string): Promise<ObjectValue[]> {
  const result: ObjectValue[] = [];
  for (let page = 1; page <= 10; page++) {
    const raw = await requestGitHub("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const rows = field ? object(raw)[field] : raw;
    if (!Array.isArray(rows)) throw new Error("Event metadata pagination returned incomplete data");
    result.push(...rows.map(object));
    if (rows.length < 100) return result;
  }
  throw new Error("Event metadata exceeds its bounded scope; explicit reconciliation is required");
}

function prNumbers(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.flatMap(row => {
    const number = id(object(row).number);
    return number === null ? [] : [number];
  }))] : [];
}

async function sourceEvent(gateway: TaskGateway, config: ProjectConfig, eventName: string, payload: ObjectValue): Promise<SourceEvent | null> {
  const base = `repos/${config.repository}`;
  const web = `https://github.com/${config.repository}`;
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const raw = object(payload.pull_request);
    const number = id(raw.number) ?? id(payload.number);
    if (number === null) return null;
    const pr = await gateway.pullRequest(number);
    const sourceHead = sha(object(raw.head).sha);
    const action = typeof payload.action === "string" ? payload.action : "unknown";
    const allowed = ["opened", "reopened", "synchronize", "ready_for_review", "closed"].includes(action);
    const repository = object(object(raw.head).repo).full_name;
    const invalid = !allowed ? "Evento de PR sem transição definida" :
      repository !== config.repository ? "Repositório de origem da PR não corresponde à execução" :
      sourceHead !== pr.headSha ? "HEAD do evento foi substituído" :
      object(raw.head).ref !== pr.head || object(raw.base).ref !== pr.base ? "Branches do evento foram substituídas" : undefined;
    return {
      id: hash({ eventName, number, action, headSha: sourceHead, updatedAt: raw.updated_at }), kind: "pr",
      occurredAt: timestamp(raw.updated_at), pullRequests: [pr], evidence: [`${web}/pull/${number}`], invalid,
      headSha: sourceHead ?? undefined, headBranch: pr.head,
    };
  }
  if (eventName === "workflow_run") {
    const raw = object(payload.workflow_run);
    const runId = id(raw.id);
    if (runId === null) return null;
    const [run, current] = await Promise.all([
      gateway.workflowRun(runId), requestGitHub("GET", `${base}/actions/runs/${runId}`).then(object),
    ]);
    const currentNumbers = prNumbers(current.pull_requests);
    const numbers = prNumbers(raw.pull_requests).filter(number => currentNumbers.includes(number));
    const prs = await Promise.all(numbers.map(number => gateway.pullRequest(number)));
    const sourceSha = sha(raw.head_sha);
    const invalid = object(current.repository).full_name !== config.repository || object(current.head_repository).full_name !== config.repository ? "Repositório do workflow não corresponde à execução" :
      current.id !== runId || id(current.run_attempt) !== id(raw.run_attempt) || id(raw.run_attempt) === null ? "Tentativa do workflow foi substituída ou não foi comprovada" :
      current.head_sha !== run.sha || sourceSha !== run.sha || current.head_branch !== run.branch || raw.head_branch !== run.branch ? "SHA ou branch do workflow foi substituído" :
      current.status !== "completed" || raw.status !== "completed" || run.conclusion !== "success" || current.conclusion !== "success" || raw.conclusion !== "success" ? "Workflow ainda pendente ou sem sucesso confirmado" : undefined;
    return {
      id: hash({ eventName, runId, attempt: raw.run_attempt, action: payload.action, status: raw.status, conclusion: raw.conclusion }),
      kind: "ci", occurredAt: timestamp(raw.run_started_at) ?? timestamp(raw.created_at),
      pullRequests: prs, evidence: [`${web}/actions/runs/${runId}`], invalid,
      headSha: sourceSha ?? undefined, headBranch: run.branch,
    };
  }
  if (eventName === "deployment_status" || eventName === "deployment") {
    const raw = object(payload.deployment);
    const status = object(payload.deployment_status);
    const deploymentId = id(raw.id);
    if (deploymentId === null) return null;
    const deployment = await gateway.deployment(deploymentId);
    if (!sha(deployment.sha)) throw new Error("Deployment metadata has no valid SHA");
    const associated = await metadataPages(`${base}/commits/${deployment.sha}/pulls`);
    const numbers = prNumbers(associated);
    const prs = await Promise.all(numbers.map(number => gateway.pullRequest(number)));
    const invalid = raw.sha !== deployment.sha ? "SHA do deployment foi substituído" :
      deployment.state !== "success" || status.state !== "success" ? "Deployment atual ainda pendente ou sem sucesso confirmado" :
      deployment.environment.toLowerCase() !== "production" || !["main", "refs/heads/main"].includes(deployment.ref) ? "Deployment não comprova publicação de main em production" : undefined;
    return {
      id: hash({ eventName, deploymentId, statusId: id(status.id), state: status.state, sha: raw.sha }),
      kind: "deployment", occurredAt: timestamp(raw.created_at), pullRequests: prs,
      evidence: [`${web}/deployments/${deploymentId}`], invalid, deployment,
    };
  }
  return null;
}

function taskBlocker(task: TaskSnapshot, source: SourceEvent, current: Control | null, config: ProjectConfig, pr: PullRequestEvidence): string | null {
  if (source.invalid) return source.invalid;
  if (!current) return "Controle remoto ausente ou ambíguo";
  if (current.state.paused) return "Escritor pausado para intervenção manual";
  if (current.state.manualEpoch !== task.manualEpoch) return "Época de coordenação alterada";
  if (task.projectId !== config.projectId || !task.itemId || !task.status) return "Issue fora do Project canônico";
  if (task.issue.state !== "OPEN" || ["Concluído", "Cancelado", "Bloqueado"].includes(task.status)) return "Estado terminal ou bloqueado permanece sob decisão explícita";
  const execution = task.coordination?.execution;
  if (!execution || !task.issue.assignees.includes(execution.actor)) return "Sem execução detentora confirmada";
  const fetchedAt = Date.parse(task.fetchedAt);
  const expiresAt = Date.parse(execution.expiresAt);
  const acquiredAt = Date.parse(execution.acquiredAt);
  if (![fetchedAt, expiresAt, acquiredAt].every(Number.isFinite) || expiresAt <= fetchedAt) return "Lease vencido ou inválido exige reconciliação";
  const occurredAt = source.occurredAt ? Date.parse(source.occurredAt) : NaN;
  if (!Number.isFinite(occurredAt) || occurredAt < acquiredAt || occurredAt > fetchedAt) return "Evento anterior à execução atual ou sem instante verificável";
  if (current.state.manualEpoch > 0 && (!timestamp(current.updatedAt) || occurredAt < Date.parse(current.updatedAt))) return "Evento anterior à última intervenção manual";
  if (execution.branch !== pr.head || pr.base !== "dev") return "PR não pertence à branch reclamada com destino dev";
  if (!pr.linkedIssues.includes(task.issue.number) || !task.linkedPullRequests.includes(pr.number)) return "Vínculo nativo entre issue e PR não foi confirmado nas duas leituras";
  if (source.kind === "ci" && (source.headSha !== pr.headSha || source.headBranch !== pr.head)) return "CI pertence a outro HEAD ou branch da PR";
  return null;
}

async function completionBlocker(gateway: TaskGateway, task: TaskSnapshot): Promise<string | null> {
  if (task.dependencies.some(dependency => dependency.status !== "Concluído")) return "Dependência ainda não entregue";
  for (const issue of [...new Set(task.subIssues)]) {
    if ((await gateway.readTask(issue)).status !== "Concluído") return "Subtarefa ainda não entregue";
  }
  return null;
}

async function productionSmoke(gateway: TaskGateway, config: ProjectConfig, deploymentSha: string): Promise<number | null> {
  const runs = await metadataPages(`repos/${config.repository}/actions/workflows/fumaca-producao.yml/runs?head_sha=${deploymentSha}&branch=main`, "workflow_runs");
  const latest = runs.filter(run => id(run.id) !== null).sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!latest) return null;
  // Selecting the latest attempt/run never revives an older green result after a new failure.
  const [run, current] = await Promise.all([
    gateway.workflowRun(Number(latest.id)),
    requestGitHub("GET", `repos/${config.repository}/actions/runs/${latest.id}`).then(object),
  ]);
  if (object(current.repository).full_name !== config.repository || current.path !== ".github/workflows/fumaca-producao.yml" ||
      current.id !== run.id || current.head_sha !== deploymentSha || run.sha !== deploymentSha ||
      current.head_branch !== "main" || run.branch !== "main" || current.status !== "completed" ||
      current.conclusion !== "success" || run.conclusion !== "success" ||
      id(current.run_attempt) === null || current.run_attempt !== latest.run_attempt) return null;
  return run.id;
}

function passingStage(status: TaskStatus | null): TaskStatus | undefined {
  if (status === "Em execução") return "QA";
  if (status === "QA") return "Testando";
  return undefined;
}

/** Events supply evidence only. The current holder must authorize every transition with a signed command. */
export async function collectEventEvidence(gateway: TaskGateway, config: ProjectConfig, eventName: string, payload: unknown): Promise<EventEvidence[]> {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(config.repository)) throw new Error("Invalid event repository configuration");
  const event = object(payload);
  if (object(event.repository).full_name !== config.repository) return [];
  const source = await sourceEvent(gateway, config, eventName, event);
  if (!source || !source.pullRequests.length) return [];
  const initialControl = await control(gateway, config);
  const results = new Map<number, EventEvidence>();
  const tasks = new Map<number, TaskSnapshot>();
  let smoke: Promise<number | null> | undefined;
  for (const pr of source.pullRequests) {
    for (const issue of [...new Set(pr.linkedIssues)]) {
      let task = tasks.get(issue);
      if (!task) { task = await gateway.readTask(issue); tasks.set(issue, task); }
      const note: EventEvidence = {
        issue, eventId: `${eventName}:${source.id}`,
        message: "Evidência registrada; nenhuma transição automática é autorizada.",
        evidence: [...new Set([...source.evidence, `https://github.com/${config.repository}/pull/${pr.number}`])],
      };
      let ignored = taskBlocker(task, source, initialControl, config, pr);
      if (!ignored) {
        let delivery: ReturnType<typeof deliveryOf> | undefined;
        try { delivery = deliveryOf(task.issue.body); } catch { ignored = "Contrato de entrega ausente ou ambíguo"; }
        if (!ignored && !pr.checksSuccessful) ignored = "Verificações do HEAD atual da PR não estão todas verdes";
        if (!ignored && source.kind === "deployment") {
          if (delivery !== "production" || task.status !== "Implantando") ignored = "Conclusão por deployment exige entrega production em Implantando";
          else if (pr.state !== "MERGED" || !pr.mergeSha || !pr.mergedAt) ignored = "PR vinculada ainda não foi integrada em dev";
          else if (Date.parse(pr.mergedAt) < deliveryWindowStart(task)) ignored = "Merge anterior ao início da tarefa";
          else if (await completionBlocker(gateway, task)) ignored = "Filhos ou dependências ainda não foram entregues";
          else if (!await gateway.containsCommit(pr.mergeSha, source.deployment!.sha)) ignored = "SHA publicado não contém o merge da PR vinculada";
          else {
            smoke ??= productionSmoke(gateway, config, source.deployment!.sha);
            const smokeId = await smoke;
            if (smokeId === null) ignored = "Fumaça mais recente não confirma main no mesmo SHA do deployment";
            else { note.suggestedStatus = "Concluído"; note.evidence.push(`https://github.com/${config.repository}/actions/runs/${smokeId}`); }
          }
        } else if (!ignored && pr.state === "MERGED") {
          if (!pr.mergeSha || !pr.mergedAt) ignored = "Merge não comprovado";
          else if (Date.parse(pr.mergedAt) < deliveryWindowStart(task)) ignored = "Merge anterior ao início da tarefa";
          else if (delivery === "dev" && ["QA", "Testando", "Implantar", "Implantando"].includes(task.status!)) {
            ignored = await completionBlocker(gateway, task);
            if (!ignored) note.suggestedStatus = "Concluído";
          } else if (delivery === "production" && task.status === "Testando") note.suggestedStatus = "Implantar";
          else note.message = "Merge em dev comprovado; o contrato de entrega e os gates restantes continuam exigidos.";
        } else if (!ignored && pr.state === "OPEN" && ["dev", "production"].includes(delivery!)) {
          note.suggestedStatus = passingStage(task.status);
        }
      }
      if (ignored) note.message = `Ignorado para transição: ${ignored}. Estado atual preservado.`;
      if (note.suggestedStatus) note.message = `Evidências atuais permitem sugerir ${note.suggestedStatus} sobre a revisão ${task.revision}. O detentor deve confirmar os gates e enviar um comando assinado.`;
      const previous = results.get(issue);
      if (!previous || !previous.suggestedStatus) results.set(issue, note);
    }
  }
  const finalControl = await control(gateway, config);
  for (const note of results.values()) {
    if (!note.suggestedStatus) continue;
    const before = tasks.get(note.issue)!;
    const fresh = await gateway.readTask(note.issue);
    const expiresAt = Date.parse(fresh.coordination?.execution?.expiresAt ?? "");
    const fetchedAt = Date.parse(fresh.fetchedAt);
    if (hash(initialControl) !== hash(finalControl) || fresh.revision !== before.revision ||
        !Number.isFinite(expiresAt) || !Number.isFinite(fetchedAt) || expiresAt <= fetchedAt) {
      delete note.suggestedStatus;
      note.message = "Ignorado para transição: estado, controle ou lease mudou durante a leitura. Releitura e decisão assinada são necessárias.";
    }
  }
  return [...results.values()].sort((a, b) => a.issue - b.issue);
}
