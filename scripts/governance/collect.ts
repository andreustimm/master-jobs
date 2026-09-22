import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { historySchema, ledgerSchema, renderMarkdown, summarize, type History } from "./model.ts";
import { probe } from "./probe.ts";
import { collectDelivery, confirmFirstMonitorRun } from "./github.ts";

const REPO = "andreustimm/master-jobs";
const ARTIFACT = "governanca-producao";
const DAY = 86_400_000;
function gh<T>(path: string): T {
  try {
    return JSON.parse(execFileSync("gh", ["api", path], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })) as T;
  } catch {
    throw new Error("Não foi possível ler a API do GitHub; nenhuma ausência será convertida em zero.");
  }
}

function restoreHistory(directory: string) {
  const result = gh<{ total_count: number; artifacts: { id: number; expired: boolean; workflow_run: { id: number; head_branch: string; repository_id: number; head_repository_id: number } }[] }>(
    `repos/${REPO}/actions/artifacts?name=${ARTIFACT}&per_page=100`,
  );
  const artifact = result.artifacts.find(a => !a.expired && a.workflow_run.head_branch === "main" && a.workflow_run.repository_id === a.workflow_run.head_repository_id);
  if (!artifact) {
    if (result.total_count) throw new Error("Histórico ausente/expirado; restaurar o último artefato antes de retomar a série.");
    // Artefatos expirados podem desaparecer da listagem. Ausência não prova
    // primeira execução, por isso conferimos também o histórico do workflow.
    confirmFirstMonitorRun(process.env.GITHUB_RUN_ID, gh);
    return;
  }
  const run = gh<{ path: string; event: string }>(`repos/${REPO}/actions/runs/${artifact.workflow_run.id}`);
  if (run.path !== ".github/workflows/governanca.yml" || !["schedule", "workflow_dispatch"].includes(run.event))
    throw new Error("Artefato não pertence ao monitor de produção.");
  const archive = join(directory, "previous.zip");
  try {
    writeFileSync(archive, execFileSync("gh", ["api", `repos/${REPO}/actions/artifacts/${artifact.id}/zip`], {
      timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    }));
    // Ler apenas o membro esperado, sem extrair caminhos do arquivo remoto.
    const text = execFileSync("unzip", ["-p", archive, "history.json"], { encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
    const history = historySchema.parse(JSON.parse(text));
    writeFileSync(join(directory, "history.json"), JSON.stringify(history));
  } finally { rmSync(archive, { force: true }); }
}

const { values } = parseArgs({ options: { out: { type: "string", default: "data/governance" }, restore: { type: "boolean", default: false } } });
const directory = resolve(values.out!);
const now = new Date();
let stage = "preparação do diretório";
try {
  mkdirSync(directory, { recursive: true });
  if (values.restore) {
    stage = "restauração do histórico";
    if (process.env.GITHUB_REPOSITORY !== REPO || process.env.GITHUB_REF !== "refs/heads/main")
      throw new Error("Restauração automática só é permitida no monitor de main.");
    restoreHistory(directory);
  }
  stage = "validação do histórico";
  const historyFile = join(directory, "history.json");
  const history: History = existsSync(historyFile) ? historySchema.parse(JSON.parse(readFileSync(historyFile, "utf8")))
    : { schemaVersion: 1, startedAt: now.toISOString(), probes: [], delivery: null };
  stage = "validação do ledger";
  const ledger = ledgerSchema.parse(JSON.parse(readFileSync(new URL("../../docs/engineering/governance-ledger.json", import.meta.url), "utf8")));
  stage = "sonda pública";
  const current = await probe(now, process.env.GITHUB_EVENT_NAME === "schedule");
  history.probes = [...history.probes.filter(p => Date.parse(p.at) > now.getTime() - 31 * DAY), current];
  let deliveryFailed = false;
  if (!history.delivery || now.getTime() - Date.parse(history.delivery.collectedAt) >= DAY) {
    try { history.delivery = collectDelivery(now, gh); }
    catch { deliveryFailed = true; console.error("Coleta de deployments indisponível; os dados anteriores preservam a data original."); }
  }
  stage = "geração do relatório";
  const report = summarize(history, ledger, now);
  const markdown = renderMarkdown(report);
  stage = "persistência da evidência";
  writeFileSync(historyFile, JSON.stringify(history));
  writeFileSync(join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(directory, "report.md"), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(markdown);
  console.log(JSON.stringify({ currentProbe: current }));
  if (current.checks.some(c => !c.good)) { console.error("Sonda pública fora do contrato esperado; investigar produção."); process.exitCode = 2; }
  else if (deliveryFailed) process.exitCode = 1;
} catch {
  // A saída de um subprocesso ou de um parser pode conter dados externos.
  console.error(`Falha na coleta de governança: ${stage}. Preserve o último artefato; não reinicialize o histórico para obter um resultado verde.`);
  process.exitCode = 1;
}
