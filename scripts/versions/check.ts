// Gate da política de versões (issue #468, docs/engineering/versions.md).
//
// "Sempre a versão mais nova" só se sustenta se cada versão estiver ESCRITA no
// repositório: é o que o Renovate lê para abrir a PR que a sobe, e o que o CI
// testa antes de ela chegar a produção. Uma etiqueta flutuante (`ubuntu-latest`,
// `node:latest`, `actions/checkout@main`) troca de versão por fora, sem PR e sem
// CI — foi o aviso de `ubuntu-latest` virar Ubuntu 26 em 19/10/2026 que abriu a
// issue. Este gate reprova esse tipo de referência, confere que as várias
// fontes da major do Node dizem a mesma coisa e que a imagem Supabase do
// Compose local está na major `local` de config/postgres-majors.json.
//
// Ele NÃO sabe qual é a versão mais nova (não consulta rede): isso é do
// Renovate. Aqui só se garante que existe uma versão explícita para ele subir.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { parsePostgresMajors } from "./postgres-majors.ts";

export type VersionViolation = { file: string; message: string };

/** Etiqueta de runner que muda de SO por decisão do GitHub, sem PR nossa. */
const FLOATING_RUNNER = /\b(ubuntu|windows|macos)-latest\b/;

/** Ref de Action aceita: tag de versão (`v7`, `v4.6.0`, `1.6`) ou SHA de commit. */
const VERSIONED_REF = /^(v?\d+(\.\d+)*|[0-9a-f]{40})$/;

/**
 * Uma imagem só tem versão explícita com tag diferente de `latest` ou digest.
 * O `:` de porta de registro (`host:5000/img`) não é tag: só conta o que vem
 * depois da última `/`.
 */
export function imageViolation(image: string): string | null {
  const reference = image.trim();
  if (reference === "" || reference === "scratch") return null;
  const [name, digest] = reference.split("@");
  if (digest !== undefined) return /^sha256:[0-9a-f]{64}$/.test(digest) ? null : `digest inválido em \`${reference}\``;
  const lastSegment = name!.slice(name!.lastIndexOf("/") + 1);
  const colon = lastSegment.indexOf(":");
  if (colon === -1) return `imagem \`${reference}\` sem tag nem digest`;
  const tag = lastSegment.slice(colon + 1);
  if (tag === "" || tag === "latest") return `imagem \`${reference}\` com tag flutuante`;
  return null;
}

/** `${VAR:-padrão}` vira o padrão: é o que roda quando ninguém define a variável. */
function composeDefault(value: string): string {
  const match = /^\$\{[A-Z0-9_]+:?-(.+)\}$/.exec(value.trim());
  return match ? match[1]! : value;
}

function actionViolation(uses: string): string | null {
  const reference = uses.trim();
  if (reference.startsWith("./")) return null;
  if (reference.startsWith("docker://")) return imageViolation(reference.slice("docker://".length));
  const at = reference.lastIndexOf("@");
  if (at === -1) return `\`uses: ${reference}\` sem versão`;
  const ref = reference.slice(at + 1);
  if (!VERSIONED_REF.test(ref)) return `\`uses: ${reference}\` aponta para \`${ref}\`, que não é tag de versão nem SHA`;
  return null;
}

type WorkflowStep = { uses?: unknown };
type WorkflowJob = {
  "runs-on"?: unknown;
  uses?: unknown;
  steps?: WorkflowStep[];
  container?: unknown;
  services?: Record<string, { image?: unknown } | undefined>;
};

function runsOnValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (value && typeof value === "object") {
    const labels = (value as { labels?: unknown }).labels;
    return runsOnValues(labels);
  }
  return [];
}

export function workflowViolations(file: string, content: string): VersionViolation[] {
  const violations: VersionViolation[] = [];
  const workflow = YAML.parse(content) as { jobs?: Record<string, WorkflowJob> } | null;
  for (const [name, job] of Object.entries(workflow?.jobs ?? {})) {
    for (const label of runsOnValues(job["runs-on"])) {
      if (FLOATING_RUNNER.test(label)) {
        violations.push({ file, message: `job \`${name}\`: \`runs-on\` usa etiqueta flutuante (\`${FLOATING_RUNNER.exec(label)![0]}\`); escreva a versão do SO (\`ubuntu-NN.04\`), que o Renovate sobe` });
      }
    }
    const uses = [job.uses, ...(job.steps ?? []).map((step) => step.uses)];
    for (const reference of uses) {
      if (typeof reference !== "string") continue;
      const problem = actionViolation(reference);
      if (problem) violations.push({ file, message: `job \`${name}\`: ${problem}` });
    }
    const container = typeof job.container === "string"
      ? job.container
      : (job.container as { image?: unknown } | undefined)?.image;
    const images = [container, ...Object.values(job.services ?? {}).map((service) => service?.image)];
    for (const image of images) {
      if (typeof image !== "string") continue;
      const problem = imageViolation(image);
      if (problem) violations.push({ file, message: `job \`${name}\`: ${problem}` });
    }
  }
  return violations;
}

/**
 * Cada `FROM`, com `ARG` resolvido pelo valor padrão. `FROM <estágio>` que
 * reaproveita um estágio anterior (`FROM deps`) não é imagem e fica de fora.
 */
export function dockerfileViolations(file: string, content: string): VersionViolation[] {
  const violations: VersionViolation[] = [];
  const args = new Map<string, string>();
  const stages = new Set<string>();
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    const arg = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)=(\S+)/i.exec(line);
    if (arg) {
      args.set(arg[1]!, arg[2]!);
      continue;
    }
    const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (!from) continue;
    const image = from[1]!.replace(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/, (whole, name: string) => args.get(name) ?? whole);
    const reusesStage = stages.has(image.toLowerCase());
    if (from[2]) stages.add(from[2].toLowerCase());
    if (reusesStage) continue;
    if (image.startsWith("$")) {
      violations.push({ file, message: `\`FROM ${from[1]}\` usa ARG sem valor padrão` });
      continue;
    }
    const problem = imageViolation(image);
    if (problem) violations.push({ file, message: problem });
  }
  return violations;
}

export function composeViolations(file: string, content: string): VersionViolation[] {
  const compose = YAML.parse(content) as { services?: Record<string, { image?: unknown } | undefined> } | null;
  const violations: VersionViolation[] = [];
  for (const [name, service] of Object.entries(compose?.services ?? {})) {
    if (typeof service?.image !== "string") continue;
    const problem = imageViolation(composeDefault(service.image));
    if (problem) violations.push({ file, message: `serviço \`${name}\`: ${problem}` });
  }
  return violations;
}

/** A imagem do Compose local que entrega o PostgreSQL com as extensões da Supabase. */
export const LOCAL_POSTGRES_IMAGE = "supabase/postgres";

/**
 * A major do PostgreSQL local é a chave `local` de `config/postgres-majors.json`
 * e a tag `supabase/postgres:<major>.…` do Compose: as duas andam juntas. O
 * Renovate sobe a tag; numa major nova o bootstrap (`docker/postgres/init`)
 * precisa ser revisto, e é este gate que obriga a PR a subir a chave também.
 */
export function localPostgresViolations(file: string, content: string, localMajor: string): VersionViolation[] {
  const compose = YAML.parse(content) as { services?: Record<string, { image?: unknown } | undefined> } | null;
  const images = Object.values(compose?.services ?? {})
    .map((service) => (typeof service?.image === "string" ? composeDefault(service.image) : ""))
    .filter((image) => image.startsWith(`${LOCAL_POSTGRES_IMAGE}:`));
  if (images.length !== 1) {
    return [{ file, message: `esperava um serviço com \`${LOCAL_POSTGRES_IMAGE}\`, achei ${images.length}` }];
  }
  const tag = images[0]!.split("@")[0]!.slice(LOCAL_POSTGRES_IMAGE.length + 1);
  const major = /^(\d+)\./.exec(tag)?.[1];
  if (major === localMajor) return [];
  return [{
    file,
    message: `\`${images[0]}\` é PostgreSQL ${major ?? "?"}, mas \`local\` em config/postgres-majors.json diz ${localMajor}; suba os dois juntos e revise docker/postgres/init`,
  }];
}

export type NodeSources = {
  engines: string;
  nvmrc: string;
  typesNode: string;
  /** Imagens Docker `node:<tag>` por arquivo. */
  nodeImages: { file: string; image: string }[];
};

const firstNumber = (text: string) => /(\d+)/.exec(text)?.[1];

/**
 * A major do Node mora em vários lugares; quando divergem, a que quebra é a
 * que ninguém lembrou de subir. `@types/node` acompanha o runtime, não o
 * pacote mais novo: tipos de uma major acima deixam passar API que o Node da
 * Vercel não tem.
 */
export function nodeAlignmentViolations(sources: NodeSources): VersionViolation[] {
  const major = firstNumber(sources.engines);
  if (!major) return [{ file: "package.json", message: "`engines.node` sem major" }];
  const violations: VersionViolation[] = [];
  if (firstNumber(sources.nvmrc) !== major) {
    violations.push({ file: ".nvmrc", message: `\`.nvmrc\` (${sources.nvmrc.trim()}) não é a major ${major} de \`engines.node\`` });
  }
  if (firstNumber(sources.typesNode) !== major) {
    violations.push({ file: "package.json", message: `\`@types/node\` (${sources.typesNode}) não é a major ${major} do runtime` });
  }
  for (const { file, image } of sources.nodeImages) {
    const tag = image.split("@")[0]!.split(":")[1] ?? "";
    if (firstNumber(tag) !== major) {
      violations.push({ file, message: `imagem \`${image}\` não é a major ${major} de \`engines.node\`` });
    }
  }
  return violations;
}

/** Só `FROM` e `ARG`: comentário que cita outra versão não é a imagem usada. */
function nodeImagesIn(file: string, content: string): { file: string; image: string }[] {
  return content
    .split("\n")
    .filter((line) => /^\s*(FROM|ARG)\b/i.test(line))
    .flatMap((line) => [...line.matchAll(/\bnode:[A-Za-z0-9._-]+(?:@sha256:[0-9a-f]{64})?/g)])
    .map((match) => ({ file, image: match[0] }));
}

export const DOCKERFILES = ["Dockerfile", "scripts/runner/Dockerfile"];
export const LOCAL_COMPOSE_FILE = "docker-compose.local.yml";
export const COMPOSE_FILES = [LOCAL_COMPOSE_FILE];
export const POSTGRES_MAJORS_FILE = "config/postgres-majors.json";
export const WORKFLOW_DIRECTORY = ".github/workflows";

export function checkRepository(root: string): VersionViolation[] {
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const violations: VersionViolation[] = [];
  const workflows = readdirSync(join(root, WORKFLOW_DIRECTORY))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => `${WORKFLOW_DIRECTORY}/${name}`);
  for (const file of workflows) violations.push(...workflowViolations(file, read(file)));
  const dockerfiles = DOCKERFILES.filter((file) => existsSync(join(root, file)));
  for (const file of dockerfiles) violations.push(...dockerfileViolations(file, read(file)));
  for (const file of COMPOSE_FILES.filter((path) => existsSync(join(root, path)))) {
    violations.push(...composeViolations(file, read(file)));
  }
  if (existsSync(join(root, POSTGRES_MAJORS_FILE)) && existsSync(join(root, LOCAL_COMPOSE_FILE))) {
    const { local } = parsePostgresMajors(read(POSTGRES_MAJORS_FILE));
    violations.push(...localPostgresViolations(LOCAL_COMPOSE_FILE, read(LOCAL_COMPOSE_FILE), local));
  }
  const pkg = JSON.parse(read("package.json")) as {
    engines?: { node?: string };
    devDependencies?: Record<string, string>;
  };
  violations.push(...nodeAlignmentViolations({
    engines: pkg.engines?.node ?? "",
    nvmrc: existsSync(join(root, ".nvmrc")) ? read(".nvmrc") : "",
    typesNode: pkg.devDependencies?.["@types/node"] ?? "",
    nodeImages: dockerfiles.flatMap((file) => nodeImagesIn(file, read(file))),
  }));
  return violations;
}

function main(): void {
  const violations = checkRepository(process.argv[2] ?? process.cwd());
  if (violations.length === 0) {
    console.log("Versões explícitas: nenhuma etiqueta flutuante, a major do Node é a mesma em todas as fontes e o Compose local está na major `local`.");
    return;
  }
  for (const { file, message } of violations) console.error(`${file}: ${message}`);
  console.error(`\n${violations.length} violação(ões) da política de versões (docs/engineering/versions.md).`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
