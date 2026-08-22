import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/release/commit-da-versao.ts");
const VERSIONAR = resolve("scripts/release/versionar.ts");
const PROMOVER = resolve("scripts/release/promover-staging.ts");
const VALIDAR_TAG = resolve("scripts/release/validar-tag.ts");

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
    try {
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
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("retoma o bump pré-tag e promove somente até o commit do release", () => {
    const base = mkdtempSync(`${tmpdir()}/master-jobs-transaction-`);
    const repo = `${base}/repo`;
    const remote = `${base}/remote.git`;

    try {
      execFileSync("git", ["init", "-q", "--bare", remote]);
      execFileSync("git", ["init", "-q", repo]);
      git(repo, "config", "user.name", "Release Test");
      git(repo, "config", "user.email", "release@example.test");
      git(repo, "remote", "add", "origin", remote);

      writeFileSync(`${repo}/package.json`, '{"version":"1.0.0"}\n');
      writeFileSync(`${repo}/CHANGELOG.md`, "## [1.0.0] - 2026-08-21\n");
      writeFileSync(`${repo}/USER_CHANGELOG.md`, "## [1.0.0] - 2026-08-21\n");
      git(repo, "add", ".");
      git(repo, "commit", "-m", "chore: base");
      const inicial = git(repo, "rev-parse", "HEAD");
      git(repo, "tag", "v1.0.0");
      git(repo, "branch", "staging");

      writeFileSync(`${repo}/package.json`, '{"version":"1.1.0"}\n');
      const changelog = "## [Unreleased]\n\n## [1.1.0] - 2026-08-22\n\n## [1.0.0] - 2026-08-21\n";
      writeFileSync(`${repo}/CHANGELOG.md`, changelog);
      writeFileSync(`${repo}/USER_CHANGELOG.md`, changelog);
      git(repo, "add", ".");
      git(repo, "commit", "-m", "chore(release): 1.1.0");
      const release = git(repo, "rev-parse", "HEAD");
      commit(repo, "docs: depois do release", "chore(release): 1.1.0");
      const topo = git(repo, "rev-parse", "HEAD");

      git(repo, "branch", "dev");
      git(repo, "push", "-q", "origin", "staging", "dev");
      git(repo, "fetch", "-q", "origin", "staging", "dev");
      expect(git(remote, "rev-parse", "staging")).toBe(inicial);

      const estado = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", VERSIONAR, "HEAD"],
        { cwd: repo, encoding: "utf8" },
      ).trim();
      expect(estado).toBe("already-released");

      const resolvido = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", SCRIPT, "HEAD", "1.1.0"],
        { cwd: repo, encoding: "utf8" },
      ).trim();
      expect(resolvido).toBe(release);

      execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", PROMOVER, "origin", "origin/staging", "origin/dev", release],
        { cwd: repo, stdio: "pipe" },
      );
      expect(git(remote, "rev-parse", "staging")).toBe(release);
      expect(git(remote, "rev-parse", "staging")).not.toBe(topo);

      const ausente = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", VALIDAR_TAG, release, ""],
        { cwd: repo, encoding: "utf8" },
      ).trim();
      expect(ausente).toBe("missing");
      const divergente = spawnSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", VALIDAR_TAG, release, topo],
        { cwd: repo, encoding: "utf8" },
      );
      expect(divergente.status).not.toBe(0);
      const ausenteObrigatoria = spawnSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", VALIDAR_TAG, release, "", "--required"],
        { cwd: repo, encoding: "utf8" },
      );
      expect(ausenteObrigatoria.status).not.toBe(0);
      expect(
        execFileSync(
          process.execPath,
          ["--experimental-strip-types", "--no-warnings", VALIDAR_TAG, "", "", "--must-be-missing"],
          { cwd: repo, encoding: "utf8" },
        ).trim(),
      ).toBe("missing");
      const alvoConflitante = spawnSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", VALIDAR_TAG, "", topo, "--must-be-missing"],
        { cwd: repo, encoding: "utf8" },
      );
      expect(alvoConflitante.status).not.toBe(0);

      git(repo, "tag", "v1.1.0", release);
      const manutencao = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", VERSIONAR, "HEAD"],
        { cwd: repo, encoding: "utf8" },
      ).trim();
      expect(manutencao).toBe("no-release");
      expect(
        execFileSync(
          process.execPath,
          ["--experimental-strip-types", "--no-warnings", VALIDAR_TAG, release, release, "--required"],
          { cwd: repo, encoding: "utf8" },
        ).trim(),
      ).toBe("current");

      execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", PROMOVER, "origin", "origin/staging", "origin/dev", ""],
        { cwd: repo, stdio: "pipe" },
      );
      expect(git(remote, "rev-parse", "staging")).toBe(topo);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
