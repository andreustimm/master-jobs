/** Git/GitHub boundary shared by the promotion workflow and disposable-repository tests. */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  classificarBump, commitDaVersao, estadoDaTag, exigirTagAlvoAusente, prepareRelease,
  proximaVersao, shaDaTagRemota,
} from "../../src/core/release.ts";
import { FRAGMENT_DIRECTORY } from "../../src/core/changelog-fragments.ts";
import { describeFindings, reviewMigrationChanges } from "../../src/core/db/migration-review.ts";
import { commitSubjectsSince, mostRecentVersionTag } from "./git-context.ts";
import { ghApi, requireSha, requireSourceCI } from "./promotion-ci.ts";
import { versionar } from "./versionar.ts";

const CHANGELOGS = {
  technical: "CHANGELOG.md", ptBR: "USER_CHANGELOG.pt-BR.md", en: "USER_CHANGELOG.en.md",
} as const;
const RELEASE_FILES = ["package.json", ...Object.values(CHANGELOGS)];
/**
 * `automatic` marks the entries no person chose: the CI event and the timer.
 * Only they may end as a no-op, and neither carries migration approval.
 * `runId`/`ciConclusion` exist only for the CI event.
 */
type Input = { source: string; confirmMigration: boolean; automatic: boolean; runId?: number; ciConclusion?: string };
type Event = {
  inputs?: { "target-sha"?: string; "confirmar-migracao"?: boolean | string };
  workflow_run?: { id: number; head_sha: string; head_branch: string; event: string; conclusion: string | null };
};

/**
 * The CI event promotes the `head_sha` of the push run that just finished.
 * The scheduled run promotes the tip of dev as it is at preparation time;
 * `devTip` is resolved once, here, and the publication phase receives that
 * same SHA from the preparation output and never reads the branch again.
 */
export function promotionInput(eventName: string, event: Event, devTip: () => string): Input {
  if (eventName === "workflow_dispatch") {
    return {
      source: requireSha(event.inputs?.["target-sha"] ?? ""),
      confirmMigration: [true, "true"].includes(event.inputs?.["confirmar-migracao"] ?? false),
      automatic: false,
    };
  }
  if (eventName === "workflow_run") {
    const run = event.workflow_run;
    // `failure` still enters: a red run caused only by a NON_BLOCKING_CI_JOBS
    // job promotes; the job verdict, not the run conclusion, decides.
    if (!run || run.head_branch !== "dev" || run.event !== "push" ||
      !["success", "failure"].includes(run.conclusion ?? "")) throw new Error("Evento de CI inválido.");
    return { source: requireSha(run.head_sha), confirmMigration: false, automatic: true, runId: run.id, ciConclusion: run.conclusion! };
  }
  if (eventName !== "schedule") throw new Error("Evento de promoção inválido.");
  // Migration approval is a human decision; a timer cannot carry one.
  return { source: requireSha(devTip()), confirmMigration: false, automatic: true };
}

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}

/** Tracked fragment paths at a commit, e.g. `changelog.d/fix-x.md`. */
function fragmentPaths(directory: string, sha: string): string[] {
  return git(directory, "ls-tree", "-r", "-z", "--name-only", sha, "--", `${FRAGMENT_DIRECTORY}/`)
    .split("\0").filter(Boolean);
}

/**
 * Why an automatic entry ends without CI, release or publication, or null to
 * go on. Staging already containing A is what ends the release loop: the
 * `chore(release)` R pushed to dev may fire its own CI and this workflow
 * again, but that run is queued behind the one that publishes R, and by then
 * `staging` is R. A dispatch never skips: a person asked for that SHA.
 */
export function automaticSkip(directory: string, repository: string, input: Input): string | null {
  if (!input.automatic) return null;
  refresh(directory);
  if (isAncestor(directory, input.source, "origin/staging")) return `staging já contém ${input.source}; nada a promover.`;
  if (input.runId === undefined) return null;
  // Only the newest push promotes: its own CI event will follow this one.
  if (git(directory, "rev-parse", "origin/dev") !== input.source && isAncestor(directory, input.source, "origin/dev")) {
    return `dev já avançou além de ${input.source}; a promoção fica com o CI da nova ponta.`;
  }
  if (input.ciConclusion !== "success") {
    try {
      requireSourceCI(repository, input.source, input.runId);
    } catch (error) {
      // The CI run is already red on dev; a second red here would say nothing new.
      return `CI de push vermelho sem ser só job não bloqueante: ${(error as Error).message}`;
    }
  }
  return null;
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
  // `schema.ts` fica de fora: o SQL é o que chega ao banco, e o job
  // `schema-e-migracao` do CI já prova que os dois andam juntos. Sem detecção
  // de renome, um `.sql` renomeado aparece como remoção e pede revisão.
  const changes = git(directory, "diff", "--no-renames", "--name-status", "-z", staging, target, "--", "drizzle/")
    .split("\0").filter(Boolean);
  const files = [];
  for (let i = 0; i + 1 < changes.length; i += 2) files.push({ status: changes[i]!, path: changes[i + 1]! });
  const review = reviewMigrationChanges(files, (path) => readAt(directory, target, path));
  if (!review.automatic && !confirmMigration) {
    throw new Error(`Migração exige confirmação humana para o alvo ${target}:\n${describeFindings(review.findings)}`);
  }
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
  // The retry rebuilds R from A's own fragments: same bytes in, same bytes out.
  const consumed = fragmentPaths(directory, source);
  const prepared = prepareRelease({
    documents: {
      technical: readAt(directory, source, CHANGELOGS.technical),
      ptBR: readAt(directory, source, CHANGELOGS.ptBR),
      en: readAt(directory, source, CHANGELOGS.en),
    },
    version: next.version,
    publishedAt: new Date(git(directory, "show", "-s", "--format=%cI", target)),
    fragments: consumed.map((path) => ({
      name: path.slice(FRAGMENT_DIRECTORY.length + 1),
      content: readAt(directory, source, path),
    })),
  });
  if (prepared.status !== "prepared") throw new Error("Transformação de release inesperada.");
  const allowed = new Set([...RELEASE_FILES, ...consumed]);
  if ((Object.keys(CHANGELOGS) as Array<keyof typeof CHANGELOGS>)
    .some((key) => readAt(directory, target, CHANGELOGS[key]) !== prepared.documents[key]) ||
    git(directory, "diff", "--name-only", source, target).split("\n").some((path) => !allowed.has(path)) ||
    fragmentPaths(directory, target).length > 0) {
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
  // `add -A` on the consumed paths stages their deletion.
  git(directory, "add", "-A", "--", ...RELEASE_FILES, ...fragmentPaths(directory, input.source));
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
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8"));
  let output: string;
  if (phase === "prepare") {
    const input = promotionInput(eventName, event, () => {
      refresh(directory);
      return git(directory, "rev-parse", "origin/dev");
    });
    const skip = automaticSkip(directory, repository, input);
    if (skip) {
      console.log(`::notice::${skip}`);
      output = `source=${input.source}\ntarget=${input.source}\nskip=true\n`;
    } else {
      const target = preparePromotion(directory, repository, input);
      output = `source=${input.source}\ntarget=${target}\nskip=false\n`;
    }
  } else if (phase === "complete") {
    // Publication never re-reads dev: the source is the one preparation fixed.
    const source = requireSha(process.env.PROMOTION_SOURCE ?? "");
    const input = promotionInput(eventName, event, () => source);
    if (input.source !== source) throw new Error("A entrada da publicação difere da preparada.");
    const promoted = completePromotion(directory, repository, input, process.env.PROMOTION_TARGET ?? "", process.env.VALIDATED_SHA ?? "");
    output = `promoted=${promoted}\n`;
  } else throw new Error("Fase de promoção inválida.");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.log(output.trim());
}
