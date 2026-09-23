import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ChangelogFragmentError,
  FRAGMENT_DIRECTORY,
  assertFragmentNames,
  type ChangelogFragment,
} from "../../src/core/changelog-fragments.ts";
import {
  ReleaseDomainError,
  validarReleasePendente,
  versaoSemanticaValida,
  type ReleaseDocuments,
} from "../../src/core/release.ts";
import { commitSubjectsSinceLatestTag } from "./git-context.ts";

const RELEASE_FILES = {
  technical: "CHANGELOG.md",
  ptBR: "USER_CHANGELOG.pt-BR.md",
  en: "USER_CHANGELOG.en.md",
} as const;

type Options = {
  base: string;
  directory: string;
  staged: boolean;
  commitMessageFile?: string;
};

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} exige um valor`);
  return value;
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    base: "HEAD",
    directory: process.cwd(),
    staged: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--staged") {
      options.staged = true;
    } else if (arg === "--base") {
      options.base = requiredValue(args, index, arg);
      index += 1;
    } else if (arg === "--directory") {
      options.directory = resolve(requiredValue(args, index, arg));
      index += 1;
    } else if (arg === "--commit-message-file") {
      options.commitMessageFile = resolve(requiredValue(args, index, arg));
      index += 1;
    } else {
      throw new Error(`argumento desconhecido: ${arg}`);
    }
  }
  return options;
}

function readProjectFile(path: string, options: Options): string {
  if (!options.staged) return readFileSync(resolve(options.directory, path), "utf8");
  return execFileSync("git", ["show", `:${path}`], {
    cwd: options.directory,
    encoding: "utf8",
  });
}

function readDocuments(options: Options): ReleaseDocuments {
  return {
    technical: readProjectFile(RELEASE_FILES.technical, options),
    ptBR: readProjectFile(RELEASE_FILES.ptBR, options),
    en: readProjectFile(RELEASE_FILES.en, options),
  };
}

/**
 * With `--staged`, the index decides: an unstaged fragment is not in the
 * commit. Without it, Git still decides what counts: tracked and untracked
 * files, minus what `.gitignore` excludes. A raw directory listing would fail
 * on a `.DS_Store` nobody commits, and skipping dotfiles by name would let a
 * committed `.gitkeep` pass here and break the promotion after the merge.
 */
function fragmentNames(options: Options): string[] {
  const args = options.staged
    ? ["ls-files", "--cached", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate", "-z"];
  const paths = execFileSync("git", [...args, "--", `${FRAGMENT_DIRECTORY}/`], {
    cwd: options.directory,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  // A tracked fragment deleted from the working tree is not part of it.
  const present = options.staged
    ? paths
    : paths.filter((path) => existsSync(resolve(options.directory, path)));
  return present.map((path) => path.slice(FRAGMENT_DIRECTORY.length + 1));
}

function readFragments(options: Options): ChangelogFragment[] {
  const names = fragmentNames(options);
  assertFragmentNames(names);
  return names.map((name) => ({ name, content: readProjectFile(`${FRAGMENT_DIRECTORY}/${name}`, options) }));
}

function packageVersion(options: Options): string {
  const parsed = JSON.parse(readProjectFile("package.json", options)) as { version?: unknown };
  if (typeof parsed.version !== "string" || !versaoSemanticaValida(parsed.version)) {
    throw new ReleaseDomainError("invalid_release_version", {
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    });
  }
  return parsed.version;
}

function candidateSubject(options: Options): string | null {
  if (!options.commitMessageFile) return null;
  return readFileSync(options.commitMessageFile, "utf8").split("\n")[0]?.trim() || null;
}

export function validatePendingRelease(options: Options): string {
  const candidate = candidateSubject(options);
  // O commit automatizado é posterior ao preflight e recria Unreleased vazio.
  // Revalidá-lo como uma nova leva faria o próprio escritor único se bloquear.
  if (/^chore\(release\): \d+\.\d+\.\d+$/.test(candidate ?? "")) {
    return "release-commit";
  }

  const subjects = commitSubjectsSinceLatestTag(options.base, options.directory);
  if (candidate && !candidate.startsWith("Merge ")) subjects.unshift(candidate);
  const result = validarReleasePendente({
    subjects,
    currentVersion: packageVersion(options),
    documents: readDocuments(options),
    publishedAt: new Date(),
    fragments: readFragments(options),
  });
  return result.status === "ready" ? `release-ready version=${result.version}` : "no-release";
}

function safeFailure(error: unknown): string {
  if (error instanceof ReleaseDomainError) return `release_changelog_not_ready code=${error.code}`;
  if (error instanceof ChangelogFragmentError) return error.message;
  return "release_changelog_not_ready";
}

const direct = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (direct) {
  try {
    console.log(validatePendingRelease(parseOptions(process.argv.slice(2))));
  } catch (error) {
    console.error(safeFailure(error));
    console.error(
      "Adicione um fragmento em changelog.d/<slug>.md (blocos Técnico, pt-BR e en) antes do commit releaseável.",
    );
    process.exitCode = 1;
  }
}
