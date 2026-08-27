import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  });
  return result.status === "ready" ? `release-ready version=${result.version}` : "no-release";
}

function safeFailure(error: unknown): string {
  if (error instanceof ReleaseDomainError) return `release_changelog_not_ready code=${error.code}`;
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
      "Atualize CHANGELOG.md, USER_CHANGELOG.pt-BR.md e USER_CHANGELOG.en.md antes do commit releaseável.",
    );
    process.exitCode = 1;
  }
}
