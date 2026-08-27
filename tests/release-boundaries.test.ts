// Suite: release automation boundaries
// Invariant: Git failures stop release gates and remote tags are visible in the same sync
// Boundary IN: real temporary Git repositories, staged indexes, hook scripts and CLI arguments
// Boundary OUT: GitHub network calls, replaced only by a deterministic local gh executable
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commitSubjectsSinceLatestTag,
  mostRecentVersionTag,
} from "../scripts/release/git-context.ts";

const VALIDATOR = resolve("scripts/release/validar-changelogs.ts");
const GITHUB_RELEASES = resolve("scripts/release/github-releases.ts");
const HOOK_INSTALLER = resolve("scripts/configure-git-hooks.mjs");
const NODE_TS_ARGS = ["--experimental-strip-types", "--no-warnings"];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initializeRepository(directory: string): void {
  git(directory, "init", "-q");
  git(directory, "config", "user.name", "Release Test");
  git(directory, "config", "user.email", "release@example.test");
}

function commitAll(directory: string, subject: string): string {
  git(directory, "add", ".");
  git(directory, "commit", "-q", "-m", subject);
  return git(directory, "rev-parse", "HEAD");
}

describe("Git release context", () => {
  it("returns subjects since the latest tag and propagates invalid Git state", () => {
    const base = mkdtempSync(`${tmpdir()}/master-jobs-git-context-`);
    const repo = `${base}/repo`;
    const notRepo = `${base}/not-repo`;
    mkdirSync(repo);
    mkdirSync(notRepo);

    try {
      initializeRepository(repo);
      writeFileSync(`${repo}/state.txt`, "v1.9\n");
      commitAll(repo, "chore: base");
      git(repo, "tag", "v1.9.0");
      writeFileSync(`${repo}/state.txt`, "v1.10\n");
      commitAll(repo, "chore: base 1.10");
      git(repo, "tag", "v1.10.0");

      const primaryBranch = git(repo, "branch", "--show-current");
      git(repo, "switch", "-q", "-c", "release-side");
      writeFileSync(`${repo}/side.txt`, "fix\n");
      commitAll(repo, "fix(ui): corrigir cabeçalho");
      git(repo, "switch", "-q", primaryBranch);
      writeFileSync(`${repo}/main.txt`, "docs\n");
      commitAll(repo, "docs: registrar mudança");
      git(repo, "merge", "-q", "--no-ff", "release-side", "-m", "Merge release-side");

      expect(mostRecentVersionTag(repo)).toBe("v1.10.0");
      const subjects = commitSubjectsSinceLatestTag("HEAD", repo);
      expect(subjects).toHaveLength(2);
      expect(subjects).toEqual(expect.arrayContaining([
        "fix(ui): corrigir cabeçalho",
        "docs: registrar mudança",
      ]));
      expect(subjects.some((subject) => subject.startsWith("Merge "))).toBe(false);
      expect(() => commitSubjectsSinceLatestTag("ref-inexistente", repo)).toThrow();
      expect(() => mostRecentVersionTag(notRepo)).toThrow();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("versioned commit hook", () => {
  it("reads the index, rejects incomplete notes and accepts the exact release commit", () => {
    const repo = mkdtempSync(`${tmpdir()}/master-jobs-release-hook-`);
    const readyTechnical =
      "# Changelog\n\n## [Unreleased]\n\n### Corrigido\n\n- Gate técnico.\n";
    const emptyTechnical = "# Changelog\n\n## [Unreleased]\n";
    const readyPt = "# Novidades\n\n## [Unreleased]\n\n### Correção\n\n- Correção visível.\n";
    const readyEn = "# What's New\n\n## [Unreleased]\n\n### Fixed\n\n- Visible fix.\n";

    try {
      expect(statSync(".githooks/commit-msg").mode & 0o111).not.toBe(0);
      mkdirSync(`${repo}/.githooks`, { recursive: true });
      mkdirSync(`${repo}/scripts/release`, { recursive: true });
      mkdirSync(`${repo}/src/core`, { recursive: true });
      copyFileSync(".githooks/commit-msg", `${repo}/.githooks/commit-msg`);
      copyFileSync(VALIDATOR, `${repo}/scripts/release/validar-changelogs.ts`);
      copyFileSync("scripts/release/git-context.ts", `${repo}/scripts/release/git-context.ts`);
      copyFileSync("src/core/release.ts", `${repo}/src/core/release.ts`);
      copyFileSync("src/core/changelog.ts", `${repo}/src/core/changelog.ts`);
      chmodSync(`${repo}/.githooks/commit-msg`, 0o755);
      writeFileSync(`${repo}/package.json`, '{"type":"module","version":"1.3.7"}\n');
      writeFileSync(`${repo}/CHANGELOG.md`, emptyTechnical);
      writeFileSync(`${repo}/USER_CHANGELOG.pt-BR.md`, readyPt);
      writeFileSync(`${repo}/USER_CHANGELOG.en.md`, readyEn);
      initializeRepository(repo);
      commitAll(repo, "chore: base");
      git(repo, "tag", "v1.3.7");

      const message = `${repo}/commit-message.txt`;
      writeFileSync(message, "fix(ui): corrigir cabeçalho\n");
      const rejected = spawnSync(`${repo}/.githooks/commit-msg`, [message], {
        cwd: repo,
        encoding: "utf8",
      });
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("code=empty_body");

      writeFileSync(`${repo}/CHANGELOG.md`, readyTechnical);
      git(repo, "add", "CHANGELOG.md");
      writeFileSync(`${repo}/CHANGELOG.md`, emptyTechnical);
      const stagedAccepted = spawnSync(`${repo}/.githooks/commit-msg`, [message], {
        cwd: repo,
        encoding: "utf8",
      });
      expect(stagedAccepted.status).toBe(0);
      expect(stagedAccepted.stdout).toContain("release-ready version=1.3.8");

      writeFileSync(`${repo}/pending.txt`, "releaseable\n");
      commitAll(repo, "fix(ui): mudança pendente");
      for (const nearMiss of [
        "chore(release): 1.3",
        "chore(release): 1.3.8 extra",
        "prefix chore(release): 1.3.8",
      ]) {
        writeFileSync(message, `${nearMiss}\n`);
        const nearMissRejected = spawnSync(`${repo}/.githooks/commit-msg`, [message], {
          cwd: repo,
          encoding: "utf8",
        });
        expect(nearMissRejected.status, nearMiss).not.toBe(0);
      }

      writeFileSync(message, "chore(release): 1.3.8\n");
      const releaseAccepted = spawnSync(`${repo}/.githooks/commit-msg`, [message], {
        cwd: repo,
        encoding: "utf8",
      });
      expect(releaseAccepted.status).toBe(0);
      expect(releaseAccepted.stdout).toContain("release-commit");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("GitHub Release synchronization", () => {
  it("fetches a tag created remotely after checkout before planning releases", () => {
    const base = mkdtempSync(`${tmpdir()}/master-jobs-github-release-`);
    const repo = `${base}/repo`;
    const remote = `${base}/remote.git`;
    const bin = `${base}/bin`;
    const ghLog = `${base}/gh.log`;

    try {
      execFileSync("git", ["init", "-q", "--bare", remote]);
      mkdirSync(repo);
      initializeRepository(repo);
      git(repo, "remote", "add", "origin", remote);
      writeFileSync(
        `${repo}/CHANGELOG.md`,
        "# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-08-21\n\n- Nova.\n\n## [1.0.0] - 2026-08-20\n\n- Inicial.\n",
      );
      const first = commitAll(repo, "chore: base");
      git(repo, "tag", "v1.0.0", first);
      git(repo, "push", "-q", "origin", "HEAD:main", "v1.0.0");
      writeFileSync(`${repo}/state.txt`, "next\n");
      const second = commitAll(repo, "fix: próxima versão");
      git(repo, "push", "-q", "origin", "HEAD:refs/heads/next");
      execFileSync("git", ["--git-dir", remote, "update-ref", "refs/tags/v1.1.0", second]);
      expect(git(repo, "tag", "--list", "v1.1.0")).toBe("");

      mkdirSync(bin);
      writeFileSync(
        `${bin}/gh`,
        '#!/bin/sh\nprintf \'%s\\n\' "$@" >> "$GH_LOG"\nif [ "$2" = "--paginate" ]; then\n  printf \'%s\\n\' "v1.0.0"\nfi\n',
      );
      chmodSync(`${bin}/gh`, 0o755);
      const result = spawnSync(
        process.execPath,
        [
          ...NODE_TS_ARGS,
          GITHUB_RELEASES,
          "--directory",
          repo,
          "--repo",
          "owner/repository",
          "--apply",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            GH_LOG: ghLog,
            PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("created v1.1.0");
      expect(git(repo, "tag", "--list", "v1.1.0")).toBe("v1.1.0");
      const post = readFileSync(ghLog, "utf8");
      expect(post).toContain("repos/owner/repository/releases");
      expect(post).toContain("--method\nPOST");
      expect(post).toContain("tag_name=v1.1.0");
      expect(post).toContain("name=v1.1.0");
      expect(post).toContain("body=- Nova.");
      expect(post).toContain("draft=false");
      expect(post).toContain("prerelease=false");
      expect(post).toContain("make_latest=legacy");
      expect(post).not.toContain("tag_name=v1.0.0");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("release CLI configuration", () => {
  it("rejects every value-bearing flag when its value is missing", () => {
    const cases = [
      [GITHUB_RELEASES, "--repo"],
      [GITHUB_RELEASES, "--directory"],
      [VALIDATOR, "--base"],
      [VALIDATOR, "--directory"],
      [VALIDATOR, "--commit-message-file"],
    ];

    for (const [script, flag] of cases) {
      const result = spawnSync(process.execPath, [...NODE_TS_ARGS, script!, flag!], {
        encoding: "utf8",
        env: { ...process.env, GITHUB_REPOSITORY: "" },
      });
      expect(result.status, `${script} ${flag}`).not.toBe(0);
      if (script === GITHUB_RELEASES) {
        expect(`${result.stdout}${result.stderr}`).toContain("exige um valor");
      }
    }
  });

  it("installs the committed hooks path inside Git and skips outside a repository", () => {
    const base = mkdtempSync(`${tmpdir()}/master-jobs-hook-installer-`);
    const repo = `${base}/repo`;
    const notRepo = `${base}/not-repo`;
    mkdirSync(repo);
    mkdirSync(notRepo);

    try {
      initializeRepository(repo);
      const configured = spawnSync(process.execPath, [HOOK_INSTALLER], {
        cwd: repo,
        encoding: "utf8",
      });
      expect(configured.status).toBe(0);
      expect(git(repo, "config", "--get", "core.hooksPath")).toBe(".githooks");

      const skipped = spawnSync(process.execPath, [HOOK_INSTALLER], {
        cwd: notRepo,
        encoding: "utf8",
      });
      expect(skipped.status).toBe(0);
      expect(skipped.stdout).toContain("Git worktree unavailable");

      const bin = `${base}/bin`;
      mkdirSync(bin);
      writeFileSync(
        `${bin}/git`,
        '#!/bin/sh\nif [ "$1" = "rev-parse" ]; then\n  echo true\n  exit 0\nfi\nexit 73\n',
      );
      chmodSync(`${bin}/git`, 0o755);
      const failed = spawnSync(process.execPath, [HOOK_INSTALLER], {
        cwd: notRepo,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      });
      expect(failed.status).toBe(73);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
