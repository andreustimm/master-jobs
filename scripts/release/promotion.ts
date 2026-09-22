/** Git/GitHub boundary shared by the promotion workflow and disposable-repository tests. */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  classificarBump, commitDaVersao, estadoDaTag, exigirTagAlvoAusente, prepareRelease,
  proximaVersao, shaDaTagRemota,
} from "../../src/core/release.ts";
import { commitSubjectsSince, mostRecentVersionTag } from "./git-context.ts";
import { ghApi, requireSha, requireSourceCI } from "./promotion-ci.ts";
import { versionar } from "./versionar.ts";

const CHANGELOGS = {
  technical: "CHANGELOG.md", ptBR: "USER_CHANGELOG.pt-BR.md", en: "USER_CHANGELOG.en.md",
} as const;
const RELEASE_FILES = ["package.json", ...Object.values(CHANGELOGS)];
type Input = { source: string; confirmMigration: boolean; runId?: number };
type Event = {
  inputs?: { "target-sha"?: string; "confirmar-migracao"?: boolean | string };
  workflow_run?: { id: number; head_sha: string; head_branch: string; event: string; conclusion: string };
};

export function promotionInput(eventName: string, event: Event): Input {
  if (eventName === "workflow_dispatch") {
    return {
      source: requireSha(event.inputs?.["target-sha"] ?? ""),
      confirmMigration: [true, "true"].includes(event.inputs?.["confirmar-migracao"] ?? false),
    };
  }
  const run = event.workflow_run;
  if (eventName !== "workflow_run" || !run || run.head_branch !== "dev" ||
    run.event !== "push" || run.conclusion !== "success") throw new Error("Evento de CI inválido.");
  return { source: requireSha(run.head_sha), confirmMigration: false, runId: run.id };
}

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}

function isAncestor(directory: string, ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: directory });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error("Falha ao consultar ancestralidade.");
  return result.status === 0;
}

function readAt(directory: string, sha: string, path: string): string {
  return execFileSync("git", ["show", `${sha}:${path}`], { cwd: directory, encoding: "utf8" });
}

function remoteTag(repository: string, version: string): string | null {
  return shaDaTagRemota(ghApi(`repos/${repository}/git/matching-refs/tags/v${version}`), version);
}

function refresh(directory: string): void {
  git(directory, "fetch", "origin", "dev", "staging", "--tags", "--quiet");
}

/** Rechecked at publication time; a later dev tip never enters the schema interval. */
export function requirePromotionRange(directory: string, target: string, confirmMigration: boolean): "ready" | "superseded" {
  requireSha(target);
  if (!isAncestor(directory, target, "origin/dev")) throw new Error("O alvo não pertence ao histórico de dev.");
  const staging = git(directory, "rev-parse", "origin/staging");
  if (staging !== target && isAncestor(directory, target, staging)) return "superseded";
  if (!isAncestor(directory, staging, target)) throw new Error("staging divergiu: fast-forward impossível.");
  const changed = git(directory, "diff", "--name-only", staging, target, "--", "drizzle/", "src/core/db/schema.ts");
  if (changed && !confirmMigration) throw new Error(`Migração exige confirmação humana para o alvo ${target}:\n${changed}`);
  return "ready";
}

/** A trailer identifies the retry; byte equality proves it contains only the release transformation. */
function verifyReleaseChild(directory: string, source: string, target: string): void {
  if (git(directory, "show", "-s", "--format=%P", target) !== source ||
    !git(directory, "show", "-s", "--format=%B", target).split("\n").includes(`Promotion-Source: ${source}`)) {
    throw new Error("Commit de release não corresponde ao SHA de entrada.");
  }
  const pkg = JSON.parse(readAt(directory, source, "package.json"));
  const next = JSON.parse(readAt(directory, target, "package.json"));
  const recordedBase = git(directory, "show", "-s", "--format=%(trailers:key=Promotion-Base,valueonly)", target);
  const baseline = recordedBase === "none" ? null : requireSha(recordedBase);
  if (baseline && !isAncestor(directory, baseline, source)) throw new Error("Base do versionamento não é ancestral da entrada.");
  const bump = classificarBump(commitSubjectsSince(source, directory, baseline));
  if (!bump || next.version !== proximaVersao(pkg.version, bump) ||
    git(directory, "show", "-s", "--format=%s", target) !== `chore(release): ${next.version}` ||
    readAt(directory, target, "package.json") !== `${JSON.stringify({ ...pkg, version: next.version }, null, 2)}\n`) {
    throw new Error("Metadados inesperados no commit de release.");
  }
  const prepared = prepareRelease({
    documents: {
      technical: readAt(directory, source, CHANGELOGS.technical),
      ptBR: readAt(directory, source, CHANGELOGS.ptBR),
      en: readAt(directory, source, CHANGELOGS.en),
    },
    version: next.version,
    publishedAt: new Date(git(directory, "show", "-s", "--format=%cI", target)),
  });
  if (prepared.status !== "prepared") throw new Error("Transformação de release inesperada.");
  if ((Object.keys(CHANGELOGS) as Array<keyof typeof CHANGELOGS>)
    .some((key) => readAt(directory, target, CHANGELOGS[key]) !== prepared.documents[key]) ||
    git(directory, "diff", "--name-only", source, target).split("\n").some((path) => !RELEASE_FILES.includes(path))) {
    throw new Error("O commit de release contém alterações fora do versionamento.");
  }
}

function releaseChild(directory: string, source: string): string | undefined {
  const matches = git(directory, "log", "--format=%H", "--fixed-strings", `--grep=Promotion-Source: ${source}`, `${source}..origin/dev`)
    .split("\n").filter(Boolean);
  if (matches.length > 1) throw new Error("Mais de um release para a mesma entrada.");
  if (matches[0]) verifyReleaseChild(directory, source, matches[0]);
  return matches[0];
}

/** A new approved source may replace an untagged candidate; its original retry remains immutable. */
function pendingPredecessor(directory: string, repository: string, source: string): string | undefined {
  const { version } = JSON.parse(readAt(directory, source, "package.json"));
  if (remoteTag(repository, version)) return undefined;
  const release = commitDaVersao(git(directory, "log", "--format=%H%x09%s", source), version);
  if (release === source) return undefined;
  const parent = git(directory, "show", "-s", "--format=%P", release);
  if (!git(directory, "show", "-s", "--format=%B", release).split("\n").includes(`Promotion-Source: ${parent}`)) {
    return undefined;
  }
  verifyReleaseChild(directory, parent, release);
  return release;
}

export function preparePromotion(directory: string, repository: string, input: Input): string {
  requireSourceCI(repository, input.source, input.runId);
  refresh(directory);
  const existing = releaseChild(directory, input.source);
  const target = existing ?? input.source;
  if (requirePromotionRange(directory, target, input.confirmMigration) === "superseded") return target;
  if (existing) return existing;
  const supersedes = pendingPredecessor(directory, repository, input.source);
  git(directory, "checkout", "--detach", input.source);
  const tag = mostRecentVersionTag(directory, input.source);
  const baseline = tag ? git(directory, "rev-parse", `refs/tags/${tag}^{commit}`) : null;
  const publishedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const result = versionar(input.source, directory, {
    publishedAt,
    supersedePending: supersedes !== undefined,
    baseline,
  });
  if (result === "no-release" || result === "already-released") return input.source;
  if (git(directory, "rev-parse", "origin/dev") !== input.source) {
    throw new Error("dev avançou: não é possível criar release sobre a entrada antiga. Aguarde o CI do novo SHA.");
  }
  exigirTagAlvoAusente(remoteTag(repository, result));
  git(directory, "config", "user.name", "github-actions[bot]");
  git(directory, "config", "user.email", "github-actions[bot]@users.noreply.github.com");
  git(directory, "add", "--", ...RELEASE_FILES);
  const provenance = `Promotion-Source: ${input.source}\nPromotion-Base: ${baseline ?? "none"}${supersedes ? `\nPromotion-Supersedes: ${supersedes}` : ""}`;
  execFileSync("git", ["commit", "-m", `chore(release): ${result}`, "-m", provenance], {
    cwd: directory,
    env: { ...process.env, GIT_AUTHOR_DATE: publishedAt.toISOString(), GIT_COMMITTER_DATE: publishedAt.toISOString() },
  });
  const release = git(directory, "rev-parse", "HEAD");
  verifyReleaseChild(directory, input.source, release);
  // A concurrent push to dev rejects this fast-forward. Never rebase or substitute its newer tip.
  git(directory, "push", "origin", `${release}:refs/heads/dev`);
  return release;
}

export function completePromotion(directory: string, repository: string, input: Input, target: string, validated: string): boolean {
  requireSha(target);
  if (validated !== target) throw new Error("O CI reutilizável não comprovou o SHA a promover.");
  refresh(directory);
  if (target !== input.source) verifyReleaseChild(directory, input.source, target);
  if (requirePromotionRange(directory, target, input.confirmMigration) === "superseded") return false;
  const pkg = JSON.parse(readAt(directory, target, "package.json"));
  const release = commitDaVersao(git(directory, "log", "--format=%H%x09%s", target), pkg.version);
  const tag = remoteTag(repository, pkg.version);
  const pendingRelease = git(directory, "show", "-s", "--format=%s", target) === `chore(release): ${pkg.version}`;
  if (estadoDaTag(release, tag, !pendingRelease) === "missing") {
    ghApi(`repos/${repository}/git/refs`, ["--method", "POST", "-f", `ref=refs/tags/v${pkg.version}`, "-f", `sha=${release}`]);
  }
  git(directory, "push", "origin", `${target}:refs/heads/staging`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [phase, directory] = process.argv.slice(2);
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  if (!directory || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Uso: promotion.ts prepare|complete <directory>; GITHUB_REPOSITORY obrigatório.");
  const input = promotionInput(process.env.GITHUB_EVENT_NAME ?? "", JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")));
  let output: string;
  if (phase === "prepare") {
    const target = preparePromotion(directory, repository, input);
    output = `source=${input.source}\ntarget=${target}\n`;
  } else if (phase === "complete") {
    const promoted = completePromotion(directory, repository, input, process.env.PROMOTION_TARGET ?? "", process.env.VALIDATED_SHA ?? "");
    output = `promoted=${promoted}\n`;
  } else throw new Error("Fase de promoção inválida.");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.log(output.trim());
}
