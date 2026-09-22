import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { ProjectConfig, TaskGateway, TaskSnapshot } from "./types.ts";

const KIND = "github-task-projection";
const METADATA = "projection.json";
const HEADER = "<!-- github-task-projection:v1 — generated; refresh from GitHub -->";

interface ProjectionMetadata {
  kind: typeof KIND;
  version: 1;
  repository: string;
  projectId: string;
  rootIssue: number;
  generatedAt: string;
  files: Record<string, string>;
  issues: TaskSnapshot[];
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeRelativePath(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !path.includes("\\")
    && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function assertNoSymlink(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Projeção não aceita link simbólico: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function walkFiles(directory: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Projeção contém link simbólico: ${path}`);
    if (entry.isDirectory()) result.push(...await walkFiles(join(directory, entry.name), path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Arquivo não regular na projeção: ${path}`);
  }
  return result.sort();
}

async function assertReplaceable(directory: string, config: ProjectConfig, rootIssue: number): Promise<boolean> {
  let files: string[];
  try {
    files = await walkFiles(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (files.length === 0) return true;
  if (!files.includes(METADATA)) throw new Error("O destino contém documentos autorais; escolha um diretório exclusivo para a projeção.");
  const metadata = JSON.parse(await readFile(join(directory, METADATA), "utf8")) as Partial<ProjectionMetadata>;
  if (metadata.kind !== KIND || metadata.version !== 1 || metadata.repository !== config.repository
    || metadata.projectId !== config.projectId || metadata.rootIssue !== rootIssue
    || !metadata.files || typeof metadata.files !== "object" || Array.isArray(metadata.files)) {
    throw new Error("O destino não é uma projeção reconhecida desta issue e deste Project.");
  }
  const generated = Object.keys(metadata.files);
  if (generated.some((path) => !safeRelativePath(path) || path === METADATA)
    || JSON.stringify(files) !== JSON.stringify([...generated, METADATA].sort())) {
    throw new Error("A projeção contém arquivos autorais ou um manifesto inválido; nada foi sobrescrito.");
  }
  for (const path of generated) {
    if (digest(await readFile(join(directory, path), "utf8")) !== metadata.files[path]) {
      throw new Error(`A projeção foi editada localmente (${path}); preserve a alteração antes do refresh.`);
    }
  }
  return true;
}

function issueLink(config: ProjectConfig, number: number): string {
  return `[#${number}](https://github.com/${config.repository}/issues/${number})`;
}

function renderTask(config: ProjectConfig, task: TaskSnapshot): string {
  const dependencies = task.dependencies.length
    ? task.dependencies.map((dependency) => `${issueLink(config, dependency.number)} (${dependency.status ?? "fora do Project"})`).join(", ")
    : "nenhuma";
  return `${HEADER}\n\n# ${task.issue.title}\n\n`
    + `> Projeção descartável. A issue e o GitHub Project são a autoridade operacional. Não edite este arquivo.\n\n`
    + `Fonte: ${issueLink(config, task.issue.number)}  \n`
    + `Revisão remota: \`${task.revision}\`  \nConsultado em: ${task.fetchedAt}  \n`
    + `Status observado: ${task.status ?? "não definido"}  \nPrioridade observada: ${task.priority ?? "não definida"}  \n`
    + `Responsáveis: ${task.issue.assignees.join(", ") || "nenhum"}  \n`
    + `Depende de: ${dependencies}  \n`
    + `Execução observada: ${task.coordination?.execution?.executionId ?? "nenhuma"}\n\n`
    + `---\n\n${task.issue.body}\n`;
}

/** Read only the root issue's native sub-issue graph, never a branch-owned backlog. */
export async function collectProjection(gateway: TaskGateway, issue: number, epoch: number): Promise<TaskSnapshot[]> {
  const tasks = new Map<number, TaskSnapshot>();
  const pending = [issue];
  while (pending.length > 0) {
    const number = pending.shift()!;
    if (tasks.has(number)) continue;
    if (tasks.size >= 1_000) throw new Error("A projeção excede 1.000 issues; reduza o escopo. Nenhum arquivo foi alterado.");
    const task = await gateway.readTask(number, epoch);
    if (task.issue.number !== number) throw new Error("Leitura remota devolveu uma issue diferente da solicitada.");
    tasks.set(number, task);
    pending.push(...task.subIssues);
  }
  return [...tasks.values()];
}

/** Replace only an identified, unedited projection; authored specs cannot be adopted implicitly. */
export async function writeProjection(
  output: string,
  config: ProjectConfig,
  rootIssue: number,
  tasks: TaskSnapshot[],
): Promise<string> {
  if (!output || output.split(/[\\/]/).some((part) => part === "..")) throw new Error("O diretório da projeção não pode conter '..'.");
  const directory = resolve(output);
  if (directory === parse(directory).root) throw new Error("A raiz do sistema não pode ser uma projeção.");
  const root = tasks.find((task) => task.issue.number === rootIssue);
  if (!root || new Set(tasks.map((task) => task.issue.number)).size !== tasks.length) throw new Error("Grafo da projeção incompleto ou duplicado.");
  if (tasks.some((task) => !Number.isSafeInteger(task.issue.number) || task.issue.number < 1 || task.projectId !== config.projectId)) {
    throw new Error("A projeção contém uma issue inválida ou de outro Project.");
  }
  await assertNoSymlink(directory);
  await mkdir(dirname(directory), { recursive: true });
  const lockPath = join(dirname(directory), `.${basename(directory)}.projection.lock`);
  const lock = await open(lockPath, "wx");
  let staging: string | undefined;
  let backup: string | undefined;
  try {
    await assertReplaceable(directory, config, rootIssue);
    const files: Record<string, string> = { "task.md": renderTask(config, root) };
    const rows = tasks.map((task) => `| ${issueLink(config, task.issue.number)} | ${task.issue.title.replaceAll("|", "\\|").replaceAll("\n", " ")} | ${task.status ?? "—"} | ${task.priority ?? "—"} | ${task.dependencies.map((dependency) => issueLink(config, dependency.number)).join(", ") || "—"} |`);
    files["_tasks.md"] = `${HEADER}\n\n# Projeção de ${issueLink(config, rootIssue)}\n\n`
      + `> Fotografia remota descartável, sem autoridade para claim ou transição. Consulte o GitHub antes de agir.\n\n`
      + `| Issue | Escopo | Status observado | Prioridade observada | Dependências nativas |\n|---|---|---|---|---|\n${rows.join("\n")}\n`;
    for (const task of tasks) {
      if (task.issue.number !== rootIssue) files[`issues/${task.issue.number}/task.md`] = renderTask(config, task);
    }
    const metadata: ProjectionMetadata = {
      kind: KIND, version: 1, repository: config.repository, projectId: config.projectId, rootIssue,
      generatedAt: new Date().toISOString(), files: Object.fromEntries(Object.entries(files).map(([path, body]) => [path, digest(body)])), issues: tasks,
    };
    staging = await mkdtemp(join(dirname(directory), `.${basename(directory)}.projection-`));
    for (const [path, body] of Object.entries({ ...files, [METADATA]: `${JSON.stringify(metadata, null, 2)}\n` })) {
      await mkdir(dirname(join(staging, path)), { recursive: true });
      await writeFile(join(staging, path), body, { flag: "wx" });
    }
    // Validate again after staging so a local edit during rendering is preserved.
    const exists = await assertReplaceable(directory, config, rootIssue);
    if (exists) {
      backup = `${staging}.previous`;
      await rename(directory, backup);
    }
    try {
      await rename(staging, directory);
      staging = undefined;
    } catch (error) {
      if (backup) { await rename(backup, directory); backup = undefined; }
      throw error;
    }
    if (backup) { await rm(backup, { recursive: true }); backup = undefined; }
    return directory;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
