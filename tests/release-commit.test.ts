import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/release/commit-da-versao.ts");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd: string, assunto: string, corpo?: string): string {
  writeFileSync(`${cwd}/estado.txt`, `${assunto}\n${Date.now()}\n`);
  git(cwd, "add", "estado.txt");
  const args = ["commit", "-m", assunto];
  if (corpo) args.push("-m", corpo);
  git(cwd, ...args);
  return git(cwd, "rev-parse", "HEAD");
}

describe("commit-da-versao", () => {
  it("ignora menção no corpo e encontra o release anterior ao topo", () => {
    const repo = mkdtempSync(`${tmpdir()}/master-jobs-release-`);
    git(repo, "init", "-q");
    git(repo, "config", "user.name", "Release Test");
    git(repo, "config", "user.email", "release@example.test");

    const release = commit(repo, "chore(release): 1.1.0");
    commit(repo, "docs: explica o release", "chore(release): 1.1.0");

    const encontrado = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", SCRIPT, "HEAD", "1.1.0"],
      { cwd: repo, encoding: "utf8" },
    ).trim();

    expect(encontrado).toBe(release);
    expect(encontrado).not.toBe(git(repo, "rev-parse", "HEAD"));
  });
});
