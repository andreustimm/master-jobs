/**
 * Filesystem and Git boundary for release versioning.
 *
 * The pure transaction lives in `src/core/release.ts`. This module validates
 * all three changelogs before the first write and is also imported by the
 * integration tests, so the workflows do not hide release behavior in YAML.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseUserChangelog } from "../../src/core/changelog.ts";
import {
  changelogTemVersao,
  classificarBump,
  prepareRelease,
  proximaVersao,
  ReleaseDomainError,
  versaoSemanticaValida,
  type PrepareReleaseResult,
  type ReleaseDocuments,
} from "../../src/core/release.ts";

export type ApplyReleaseFilesInput = {
  directory: string;
  version: string;
  publishedAt: Date;
};

export type ReleaseFileOperations = {
  read(path: string): string;
  write(path: string, content: string): void;
};

const DEFAULT_FILE_OPERATIONS: ReleaseFileOperations = {
  read: (path) => readFileSync(path, "utf8"),
  write: (path, content) => writeFileSync(path, content),
};

const RELEASE_FILES = {
  technical: "CHANGELOG.md",
  ptBR: "USER_CHANGELOG.pt-BR.md",
  en: "USER_CHANGELOG.en.md",
} as const;

function readDocuments(
  directory: string,
  operations: ReleaseFileOperations = DEFAULT_FILE_OPERATIONS,
): ReleaseDocuments {
  return {
    technical: operations.read(resolve(directory, RELEASE_FILES.technical)),
    ptBR: operations.read(resolve(directory, RELEASE_FILES.ptBR)),
    en: operations.read(resolve(directory, RELEASE_FILES.en)),
  };
}

function readPackage(
  directory: string,
  operations: ReleaseFileOperations = DEFAULT_FILE_OPERATIONS,
): { version: string; [key: string]: unknown } {
  return parsePackage(operations.read(resolve(directory, "package.json")));
}

function parsePackage(raw: string): { version: string; [key: string]: unknown } {
  const parsed = JSON.parse(raw) as {
    version?: unknown;
    [key: string]: unknown;
  };
  if (typeof parsed.version !== "string" || !versaoSemanticaValida(parsed.version)) {
    throw new ReleaseDomainError("invalid_release_version", {
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    });
  }
  return { ...parsed, version: parsed.version };
}

/** Preflight all bytes before persisting the four-file release transaction. */
export function applyReleaseFiles(
  input: ApplyReleaseFilesInput,
  operations: ReleaseFileOperations = DEFAULT_FILE_OPERATIONS,
): PrepareReleaseResult {
  const documents = readDocuments(input.directory, operations);
  const pkg = readPackage(input.directory, operations);
  const prepared = prepareRelease({
    documents,
    version: input.version,
    publishedAt: input.publishedAt,
  });

  if (prepared.status === "already-released") {
    if (pkg.version !== input.version) {
      throw new ReleaseDomainError("partial_existing_release", { version: input.version });
    }
    return prepared;
  }
  if (pkg.version === input.version) {
    throw new ReleaseDomainError("partial_existing_release", { version: input.version });
  }

  const nextPackage = `${JSON.stringify({ ...pkg, version: input.version }, null, 2)}\n`;
  operations.write(resolve(input.directory, RELEASE_FILES.technical), prepared.documents.technical);
  operations.write(resolve(input.directory, RELEASE_FILES.ptBR), prepared.documents.ptBR);
  operations.write(resolve(input.directory, RELEASE_FILES.en), prepared.documents.en);
  operations.write(resolve(input.directory, "package.json"), nextPackage);

  const persistedDocuments = readDocuments(input.directory, operations);
  const persistedPackageBytes = operations.read(resolve(input.directory, "package.json"));
  const persistedPackage = parsePackage(persistedPackageBytes);
  if (
    persistedDocuments.technical !== prepared.documents.technical ||
    persistedDocuments.ptBR !== prepared.documents.ptBR ||
    persistedDocuments.en !== prepared.documents.en ||
    persistedPackageBytes !== nextPackage
  ) {
    throw new ReleaseDomainError("partial_existing_release", { version: input.version });
  }
  const verified = prepareRelease({
    documents: persistedDocuments,
    version: input.version,
    publishedAt: input.publishedAt,
  });
  if (persistedPackage.version !== input.version || verified.status !== "already-released") {
    throw new ReleaseDomainError("partial_existing_release", { version: input.version });
  }
  return prepared;
}

function mostRecentTag(): string | null {
  try {
    const output = execFileSync("git", ["tag", "--list", "v*", "--sort=-version:refname"], {
      encoding: "utf8",
    }).trim();
    return output.split("\n").filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

function commitSubjects(base: string): string[] {
  const latest = mostRecentTag();
  const range = latest ? `${latest}..${base}` : base;
  try {
    // Merge subjects have no conventional prefix and would create phantom patches.
    return execFileSync("git", ["log", "--format=%s", "--no-merges", range], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function tagExists(version: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", `refs/tags/v${version}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function documentsContainVersion(documents: ReleaseDocuments, version: string): boolean[] {
  const ptBR = parseUserChangelog(documents.ptBR);
  const en = parseUserChangelog(documents.en);
  return [
    changelogTemVersao(documents.technical, version),
    ptBR.releases.some((release) => release.version === version) ||
      ptBR.omitted.some((release) => release.version === version),
    en.releases.some((release) => release.version === version) ||
      en.omitted.some((release) => release.version === version),
  ];
}

export function versionar(base = "HEAD", directory = process.cwd()): string {
  const current = readPackage(directory).version;
  const currentPresence = documentsContainVersion(readDocuments(directory), current);

  // The version commit reaches the remote before its tag. A retry must finish
  // that release even when the remaining commit subjects are only maintenance.
  if (!tagExists(current) && currentPresence.some(Boolean)) {
    if (!currentPresence.every(Boolean)) {
      throw new ReleaseDomainError("partial_existing_release", { version: current });
    }
    applyReleaseFiles({ directory, version: current, publishedAt: new Date() });
    return "already-released";
  }

  const bump = classificarBump(commitSubjects(base));
  if (!bump) return "no-release";

  const version = proximaVersao(current, bump);
  const result = applyReleaseFiles({ directory, version, publishedAt: new Date() });
  return result.status === "already-released" ? "already-released" : version;
}

function safeError(error: unknown): string {
  if (error instanceof ReleaseDomainError) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return `release_failed code=${error.code}`;
  }
  return "release_failed";
}

const direct = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (direct) {
  try {
    console.log(versionar(process.argv[2] ?? "HEAD"));
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  }
}
