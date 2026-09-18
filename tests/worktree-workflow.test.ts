import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

const hooks = resolve(".githooks");
const inspector = resolve("scripts/worktree-status.mjs");
let root: string;
let repo: string;

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv });
}
const gitEnv = { ...process.env };
for (const key of Object.keys(gitEnv)) {
  if (key.startsWith("GIT_")) delete gitEnv[key];
}
Object.assign(gitEnv, {
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Workflow Test", GIT_AUTHOR_EMAIL: "workflow@example.test",
  GIT_COMMITTER_NAME: "Workflow Test", GIT_COMMITTER_EMAIL: "workflow@example.test",
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jho-workflow-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  git("init", "-q", "-b", "dev");
  writeFileSync(join(repo, "example.txt"), "base\n");
  git("add", "example.txt");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/dev", "HEAD");
  mkdirSync(join(repo, ".githooks"));
  for (const name of ["prepare-commit-msg", "pre-push"]) {
    copyFileSync(join(hooks, name), join(repo, ".githooks", name));
    chmodSync(join(repo, ".githooks", name), 0o755);
  }
  git("config", "core.hooksPath", ".githooks");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("blocks commits on permanent branches and permits task branches", () => {
  const initial = git("rev-parse", "HEAD");
  for (const branch of ["dev", "staging", "main"]) {
    if (branch !== "dev") git("switch", "-qc", branch);
    const result = spawnSync("git", ["commit", "--allow-empty", "-m", "blocked"], { cwd: repo, env: gitEnv, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Commit direto");
    expect(git("rev-parse", "HEAD")).toBe(initial);
  }
  git("switch", "-qc", "feat/example");
  git("commit", "--allow-empty", "-qm", "task");
  expect(git("rev-parse", "HEAD")).not.toBe(initial);
});

it("checks every push destination, including feature-to-dev and deletions", () => {
  const run = (input: string) => spawnSync("sh", [join(hooks, "pre-push")], { input, encoding: "utf8", env: gitEnv });
  for (const branch of ["dev", "staging", "main"]) {
    expect(run(`refs/heads/feat/example a refs/heads/${branch} b\n`).status).toBe(1);
    expect(run(`(delete) 0000 refs/heads/${branch} b\n`).status).toBe(1);
  }
  expect(run("refs/heads/feat/example a refs/heads/feat/example b\n").status).toBe(0);
  expect(run("refs/heads/feat/example a refs/heads/feat/example b\nrefs/heads/feat/second a refs/heads/dev b\n").status).toBe(1);
});

it("names work branches <type>/<slug> with Conventional Commits types", () => {
  const run = (input: string) => spawnSync("sh", [join(hooks, "pre-push")], { input, encoding: "utf8", env: gitEnv });
  const push = (branch: string) => run(`refs/heads/x a refs/heads/${branch} b\n`);
  for (const branch of ["feat/busca-por-tecnologia", "fix/node-24.19", "docs/prd-on-demand-job-search", "chore/branch-naming", "revert/x1"]) {
    expect(push(branch).status, branch).toBe(0);
  }
  for (const branch of ["feature/foo", "Feat/foo", "feat/Foo", "feat/foo_bar", "feat/", "feat/-foo", "feat/foo--bar", "wip/foo", "foo", "feat/a/b"]) {
    const result = push(branch);
    expect(result.status, branch).toBe(1);
    expect(result.stderr).toContain("<tipo>/<slug>");
  }
  expect(push("codex/f07-recruiter-history").status).toBe(0);
  expect(run("(delete) 0000 refs/heads/old_name b\n").status).toBe(0);
  expect(run("refs/tags/v1.13.0 a refs/tags/v1.13.0 b\n").status).toBe(0);
});

it("allows a task rebase to replay commits in detached HEAD", () => {
  git("switch", "-qc", "feat/task");
  writeFileSync(join(repo, "task.txt"), "task work\n");
  git("add", "task.txt");
  git("commit", "-qm", "task");
  git("switch", "-qc", "feat/upstream", "dev");
  writeFileSync(join(repo, "upstream.txt"), "upstream work\n");
  git("add", "upstream.txt");
  git("commit", "-qm", "upstream");
  git("rebase", "feat/upstream", "feat/task");
  expect(git("branch", "--show-current").trim()).toBe("feat/task");
  expect(git("merge-base", "--is-ancestor", "feat/upstream", "HEAD")).toBe("");
  expect(readFileSync(join(repo, "task.txt"), "utf8")).toBe("task work\n");
});

it("reports WIP even when HEAD equals dev, without modifying any worktree", () => {
  const worktree = join(root, "worktree with spaces");
  git("worktree", "add", "-qb", "feat/pending", worktree);
  writeFileSync(join(worktree, "example.txt"), "pending\n");
  writeFileSync(join(worktree, "draft.txt"), "untracked\n");
  mkdirSync(join(worktree, "drafts"));
  writeFileSync(join(worktree, "drafts", "a.md"), "first\n");
  writeFileSync(join(worktree, "drafts", "b.md"), "second\n");
  git("config", "status.showUntrackedFiles", "no");
  const output = execFileSync(process.execPath, [inspector], { cwd: repo, encoding: "utf8", env: gitEnv });
  expect(output).toContain("feat/pending: 4 arquivo(s) pendente(s), 0 commit(s) fora de origin/dev");
  expect(readFileSync(join(worktree, "example.txt"), "utf8")).toBe("pending\n");
  expect(readFileSync(join(worktree, "draft.txt"), "utf8")).toBe("untracked\n");
  expect(git("branch", "--list", "feat/pending")).toContain("feat/pending");
});

it("counts task commits missing from origin/dev when both sides advance", () => {
  const worktree = join(root, "committed-worktree");
  git("worktree", "add", "-qb", "feat/committed", worktree);
  git("-C", worktree, "commit", "--allow-empty", "-qm", "task commit");
  git("switch", "-qc", "feat/upstream");
  git("commit", "--allow-empty", "-qm", "upstream one");
  git("commit", "--allow-empty", "-qm", "upstream two");
  git("update-ref", "refs/remotes/origin/dev", "HEAD");
  const output = execFileSync(process.execPath, [inspector], { cwd: repo, encoding: "utf8", env: gitEnv });
  expect(output).toContain("feat/committed: 0 arquivo(s) pendente(s), 1 commit(s) fora de origin/dev");
});
