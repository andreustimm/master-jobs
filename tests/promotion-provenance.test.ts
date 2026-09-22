// Real Git/CLI boundaries; GitHub responses and writes terminate in a local fixture executable.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { promotionInput } from "../scripts/release/promotion.ts";
import { REQUIRED_CI_JOBS } from "../scripts/release/promotion-ci.ts";
import { updatePromotionBody } from "../scripts/release/promotion-pr.ts";

const SCRIPT = resolve("scripts/release/promotion.ts");
const LOWER_LEVEL = resolve("scripts/release/promover-staging.ts");
let root: string;
let repo: string;
let remote: string;
let base: string;
let source: string;

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function commit(subject: string, files: Record<string, string>): string {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(resolve(repo, path, ".."), { recursive: true });
    writeFileSync(resolve(repo, path), contents);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-qm", subject);
  return git(repo, "rev-parse", "HEAD");
}
function notes(ready: boolean): Record<string, string> {
  return Object.fromEntries(["CHANGELOG.md", "USER_CHANGELOG.pt-BR.md", "USER_CHANGELOG.en.md"].map((path) => [
    path, `# Changes\n\n## [Unreleased]\n\n${ready ? "- Corrigir comportamento.\n\n" : ""}## [1.0.0] - 2026-08-21\n\n- Initial release.\n`,
  ]));
}
function publishSource(subject = "fix: comportamento", files: Record<string, string> = {}) {
  source = commit(subject, { ...notes(subject.startsWith("fix:")), "app.txt": subject, ...files });
  git(repo, "push", "-q", "origin", `${source}:refs/heads/dev`);
  setAPI();
}
function goodRun() {
  return {
    id: 12, run_attempt: 2, head_sha: source, head_branch: "dev", event: "push",
    path: ".github/workflows/ci.yml", status: "completed", conclusion: "success",
    head_repository: { full_name: "owner/repo" },
  };
}
function goodJobs() {
  return REQUIRED_CI_JOBS.map((name) => ({ name, head_sha: source, status: "completed", conclusion: "success" }));
}
function setAPI(overrides: Record<string, unknown> = {}) {
  writeFileSync(`${root}/api.json`, JSON.stringify({ source, runs: [goodRun()], jobs: goodJobs(), ...overrides }));
}
function calls(): string[][] {
  return readFileSync(`${root}/calls.jsonl`, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
function refs(): string {
  return git(remote, "for-each-ref", "--format=%(refname) %(objectname)");
}
function run(phase: string, options: { target?: string; validated?: string; confirm?: boolean; automatic?: boolean; sha?: string } = {}) {
  const sha = options.sha ?? source;
  const event = options.automatic
    ? { workflow_run: { ...goodRun(), head_sha: sha } }
    : { inputs: { "target-sha": sha, "confirmar-migracao": options.confirm ?? false } };
  writeFileSync(`${root}/event.json`, JSON.stringify(event));
  writeFileSync(`${root}/output`, "");
  const result = spawnSync(process.execPath, [SCRIPT, phase, repo], {
    encoding: "utf8",
    env: {
      ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FIXTURE_ROOT: root,
      GITHUB_REPOSITORY: "owner/repo", GITHUB_EVENT_PATH: `${root}/event.json`,
      GITHUB_EVENT_NAME: options.automatic ? "workflow_run" : "workflow_dispatch",
      GITHUB_OUTPUT: `${root}/output`, PROMOTION_TARGET: options.target ?? "",
      VALIDATED_SHA: options.validated ?? "",
    },
  });
  const outputs = Object.fromEntries(readFileSync(`${root}/output`, "utf8").trim().split("\n").filter(Boolean).map((line) => line.split("=")));
  return { ...result, outputs };
}

beforeEach(() => {
  root = mkdtempSync(`${tmpdir()}/master-jobs-provenance-`);
  repo = `${root}/repo`;
  remote = `${root}/remote.git`;
  mkdirSync(repo);
  mkdirSync(`${root}/bin`);
  git(root, "init", "--bare", "-q", remote);
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Promotion Fixture");
  git(repo, "config", "user.email", "fixture@example.test");
  git(repo, "remote", "add", "origin", remote);
  base = commit("chore(release): 1.0.0", { "package.json": '{"version":"1.0.0"}\n', ...notes(false) });
  git(repo, "tag", "v1.0.0");
  git(repo, "push", "-q", "origin", `${base}:refs/heads/dev`, `${base}:refs/heads/staging`, `${base}:refs/heads/main`, "v1.0.0");
  writeFileSync(`${root}/calls.jsonl`, "");
  writeFileSync(`${root}/bin/gh`, `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const root = process.env.FIXTURE_ROOT;
const args = process.argv.slice(2);
fs.appendFileSync(root + '/calls.jsonl', JSON.stringify(args) + '\\n');
const data = JSON.parse(fs.readFileSync(root + '/api.json', 'utf8'));
if (data.fail) process.exit(42);
const path = args.find(arg => arg.startsWith('repos/')) ?? '';
let result;
if (args[0] === 'pr' && data.promotionPR) {
  if (args[1] !== 'list') throw new Error('Existing PR must be updated');
  process.stdout.write('77');
  process.exit(0);
}
if (args[0] === 'pr' && data.returnPR) {
  if (args[1] === 'list') process.stdout.write(fs.existsSync(root + '/pr-created') ? '77' : '');
  else if (args[1] === 'create') fs.writeFileSync(root + '/pr-created', '77');
  else if (args[1] === 'merge') process.exit(1);
  else throw new Error('Unexpected PR call');
  process.exit(0);
}
if (path.includes('/actions/')) {
  if (!args.includes('--paginate') || !args.includes('--slurp')) throw new Error('Pagination required');
  if (path === 'repos/owner/repo/actions/workflows/ci.yml/runs?head_sha=' + data.source + '&branch=dev&event=push&per_page=100') result = [{workflow_runs: data.runs}];
  else if (path === 'repos/owner/repo/actions/runs/12/attempts/2/jobs?per_page=100') result = [{jobs: data.jobs.slice(0,1)}, {jobs: data.jobs.slice(1)}];
  else throw new Error('Wrong CI endpoint: ' + path);
}
else if (path === 'repos/owner/repo/pulls/77') {
  if (args.includes('PATCH')) {
    const bodyFile = args.find(arg => arg.startsWith('body=@')).slice(6);
    fs.writeFileSync(root + '/updated-pr.md', fs.readFileSync(bodyFile));
    result = {};
  } else {
    process.stdout.write(data.promotionPR.body);
    process.exit(0);
  }
}
else if (path === 'repos/owner/repo/issues/77/assignees' && args.includes('POST')) result = {};
else if (path.includes('/git/matching-refs/tags/')) {
  const tag = path.split('/tags/')[1];
  const found = cp.spawnSync('git', ['--git-dir', root + '/remote.git', 'rev-parse', '--verify', 'refs/tags/' + tag], {encoding:'utf8'});
  result = found.status === 0 ? [{ref:'refs/tags/' + tag, object:{sha:found.stdout.trim()}}] : [];
} else if (path.endsWith('/git/refs') && args.includes('POST')) {
  const ref = args.find(x=>x.startsWith('ref=')).slice(4);
  const sha = args.find(x=>x.startsWith('sha=')).slice(4);
  cp.execFileSync('git', ['--git-dir', root + '/remote.git', 'update-ref', ref, sha, '0000000000000000000000000000000000000000']);
  result = {};
} else throw new Error('Unexpected API call: ' + args.join(' '));
process.stdout.write(JSON.stringify(result));
`);
  chmodSync(`${root}/bin/gh`, 0o755);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("V01-01 — CI A cannot authorize B", () => {
  it("rejects a concurrent dev push after preparation without rebasing onto B", () => {
    publishSource();
    const newer = commit("fix: concorrente", { "app.txt": "B" });
    git(repo, "push", "-q", "origin", `${newer}:refs/heads/race-fixture`);
    writeFileSync(`${repo}/.git/hooks/pre-push`, `#!/bin/sh\ngit --git-dir '${remote}' update-ref refs/heads/dev '${newer}' '${source}'\n`);
    chmodSync(`${repo}/.git/hooks/pre-push`, 0o755);
    const result = run("prepare", { automatic: true });
    expect(result.status).not.toBe(0);
    expect(git(remote, "rev-parse", "dev")).toBe(newer);
    expect(git(remote, "rev-parse", "staging")).toBe(base);
    expect(git(remote, "tag", "--list")).toBe("v1.0.0");
  });

  it("refuses a stale release source and performs no remote mutation", () => {
    publishSource();
    const newer = commit("fix: posterior sem CI", { "app.txt": "B" });
    git(repo, "push", "-q", "origin", `${newer}:refs/heads/dev`);
    const before = refs();
    const result = run("prepare", { automatic: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("dev avançou");
    expect(refs()).toBe(before);
    expect(calls().every((args) => !args.includes("POST"))).toBe(true);
    expect(calls()[0]![1]).toContain(`head_sha=${source}`);
  });

  it("promotes the exact maintenance SHA even if later dev changes schema", () => {
    publishSource("docs: manutenção");
    const newer = commit("fix: schema posterior", { "drizzle/next.sql": "ALTER TABLE x ADD y int;" });
    git(repo, "push", "-q", "origin", `${newer}:refs/heads/dev`);
    const prepared = run("prepare", { automatic: true });
    expect(prepared.status, prepared.stderr).toBe(0);
    expect(prepared.outputs.target).toBe(source);
    const done = run("complete", { target: source, validated: source });
    expect(done.status, done.stderr).toBe(0);
    expect(git(remote, "rev-parse", "staging")).toBe(source);
    expect(git(remote, "rev-parse", "dev")).toBe(newer);
  });
});

describe("V01-02 — identical source checks for automatic and manual entry", () => {
  it.each([
    "missing-run", "failed-run", "pending-run", "wrong-sha", "wrong-branch", "wrong-workflow", "fork",
    "missing-job", "failed-job", "pending-job", "skipped-job", "wrong-job-sha", "newer-failed-run", "api-error",
  ])("rejects %s before any push or tag", (failure) => {
    publishSource();
    const candidate = goodRun();
    const jobs = goodJobs();
    if (failure === "failed-run") candidate.conclusion = "failure";
    if (failure === "pending-run") candidate.status = "in_progress";
    if (failure === "wrong-sha") candidate.head_sha = base;
    if (failure === "wrong-branch") candidate.head_branch = "main";
    if (failure === "wrong-workflow") candidate.path = ".github/workflows/other.yml";
    if (failure === "fork") candidate.head_repository.full_name = "fork/repo";
    if (failure === "failed-job") jobs[1]!.conclusion = "failure";
    if (failure === "pending-job") jobs[1]!.status = "queued";
    if (failure === "skipped-job") jobs[1]!.conclusion = "skipped";
    if (failure === "wrong-job-sha") jobs[1]!.head_sha = base;
    setAPI({
      runs: failure === "missing-run" ? [] : failure === "newer-failed-run" ? [candidate, { ...candidate, id: 13, conclusion: "failure" }] : [candidate],
      jobs: failure === "missing-job" ? jobs.slice(0, 1) : jobs,
      fail: failure === "api-error",
    });
    const before = refs();
    const result = run("prepare");
    expect(result.status).not.toBe(0);
    expect(refs()).toBe(before);
    expect(calls().every((args) => !args.includes("POST"))).toBe(true);
  });

  it("requires an explicit full SHA and ignores forged migration approval in automatic events", () => {
    for (const sha of ["", "dev", "deadbee", "a".repeat(40) + "\n"]) {
      expect(() => promotionInput("workflow_dispatch", { inputs: { "target-sha": sha } })).toThrow();
    }
    expect(promotionInput("workflow_run", { workflow_run: goodRun(), inputs: { "confirmar-migracao": true } }).confirmMigration).toBe(false);
  });
});

describe("V01-03 — migrations use staging..target", () => {
  it("requires human confirmation and still refuses missing CI with that confirmation", () => {
    publishSource("fix: migração", { "src/core/db/schema.ts": "export const changed = true;" });
    const before = refs();
    const blocked = run("prepare");
    expect(blocked.stderr).toContain("Migração exige confirmação");
    expect(refs()).toBe(before);
    setAPI({ jobs: [] });
    expect(run("prepare", { confirm: true }).status).not.toBe(0);
    expect(refs()).toBe(before);
    setAPI();
    const prepared = run("prepare", { confirm: true });
    expect(prepared.status, prepared.stderr).toBe(0);
    const target = prepared.outputs.target!;
    expect(run("complete", { target, validated: target }).status).not.toBe(0);
    expect(git(remote, "rev-parse", "staging")).toBe(base);
    const done = run("complete", { target, validated: target, confirm: true });
    expect(done.status, done.stderr).toBe(0);
    expect(git(remote, "rev-parse", "staging")).toBe(target);
  });
});

describe("V01-04 — release validation and retries", () => {
  it("keeps R2's bump stable when a recovered retry publishes the predecessor tag later", () => {
    publishSource("feat: primeiro candidato", notes(true));
    const firstSource = source;
    const first = run("prepare");
    expect(first.status, first.stderr).toBe(0);
    const predecessor = first.outputs.target!;
    expect(JSON.parse(git(repo, "show", `${predecessor}:package.json`)).version).toBe("1.1.0");
    const correction = Object.fromEntries(Object.keys(notes(false)).map((path) => [
      path, readFileSync(`${repo}/${path}`, "utf8").replace("## [Unreleased]", "## [Unreleased]\n\n- Corrigir candidato."),
    ]));
    source = commit("fix: nova entrada", { ...correction, "app.txt": "B" });
    const secondSource = source;
    git(repo, "push", "-q", "origin", `${source}:refs/heads/dev`);
    setAPI();
    const second = run("prepare");
    expect(second.status, second.stderr).toBe(0);
    const replacement = second.outputs.target!;
    expect(JSON.parse(git(repo, "show", `${replacement}:package.json`)).version).toBe("1.2.0");
    expect(git(repo, "show", "-s", "--format=%B", replacement)).toContain(`Promotion-Base: ${base}`);

    // R had an infrastructure failure; its independent CI retry now succeeds.
    source = firstSource;
    setAPI();
    expect(run("prepare").outputs.target).toBe(predecessor);
    const recovered = run("complete", { target: predecessor, validated: predecessor });
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(git(remote, "rev-parse", "v1.1.0")).toBe(predecessor);

    source = secondSource;
    setAPI();
    const retry = run("prepare");
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.outputs.target).toBe(replacement);
    const published = run("complete", { target: replacement, validated: replacement });
    expect(published.status, published.stderr).toBe(0);
    expect(git(remote, "rev-parse", "staging")).toBe(replacement);
    expect(git(remote, "rev-parse", "v1.2.0")).toBe(replacement);
    expect(git(remote, "rev-parse", "v1.1.0")).toBe(predecessor);
  });

  it("recovers a failing R through a new approved B and validated R2 without tagging R", () => {
    publishSource("fix: candidato sensível à versão", {
      "verify.cjs": "process.exit(require('./package.json').version === '1.0.1' ? 1 : 0);\n",
    });
    const firstSource = source;
    const verify = () => spawnSync(process.execPath, ["verify.cjs"], { cwd: repo }).status;
    expect(verify()).toBe(0);
    const prepared = run("prepare");
    expect(prepared.status, prepared.stderr).toBe(0);
    const rejected = prepared.outputs.target!;
    expect(verify()).toBe(1);
    expect(run("complete", { target: rejected }).status).not.toBe(0);
    expect(git(remote, "rev-parse", "staging")).toBe(base);
    const fixedNotes = Object.fromEntries(Object.keys(notes(false)).map((path) => [
      path, readFileSync(`${repo}/${path}`, "utf8").replace("## [Unreleased]", "## [Unreleased]\n\n- Corrigir validação da versão."),
    ]));
    source = commit("fix: validar candidato corrigido", { ...fixedNotes, "verify.cjs": "process.exit(0);\n" });
    git(repo, "push", "-q", "origin", `${source}:refs/heads/dev`);
    setAPI();
    expect(verify()).toBe(0);
    const recovered = run("prepare");
    expect(recovered.status, recovered.stderr).toBe(0);
    const replacement = recovered.outputs.target!;
    expect(replacement).not.toBe(source);
    expect(git(repo, "show", "-s", "--format=%P", replacement)).toBe(source);
    expect(git(repo, "show", "-s", "--format=%B", replacement)).toContain(`Promotion-Supersedes: ${rejected}`);
    expect(JSON.parse(git(repo, "show", `${replacement}:package.json`)).version).toBe("1.0.2");
    expect(verify()).toBe(0);
    const before = refs();
    expect(run("complete", { target: replacement, validated: source }).status).not.toBe(0);
    expect(refs()).toBe(before);
    const complete = run("complete", { target: replacement, validated: replacement });
    expect(complete.status, complete.stderr).toBe(0);
    expect(git(remote, "rev-parse", "staging")).toBe(replacement);
    expect(git(remote, "tag", "--list")).toBe("v1.0.0\nv1.0.2");
    expect(git(remote, "rev-parse", "v1.0.2")).toBe(replacement);
    expect(run("prepare").outputs.target).toBe(replacement);
    source = firstSource;
    setAPI();
    expect(run("prepare").outputs.target).toBe(rejected);
    git(repo, "checkout", "--detach", rejected);
    expect(verify()).toBe(1);
    expect(git(remote, "tag", "--list")).not.toContain("v1.0.1");
  });

  it("rejects a forged release child that adds runtime changes", () => {
    publishSource();
    const prepared = run("prepare");
    expect(prepared.status, prepared.stderr).toBe(0);
    const target = prepared.outputs.target!;
    // Construct a competing child of A with R's release bytes and an unrelated change.
    git(repo, "checkout", "--detach", source);
    git(repo, "checkout", target, "--", "package.json", "CHANGELOG.md", "USER_CHANGELOG.pt-BR.md", "USER_CHANGELOG.en.md");
    writeFileSync(`${repo}/app.txt`, "tampered");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "chore(release): 1.0.1", "-m", `Promotion-Source: ${source}\nPromotion-Base: ${base}`);
    const forged = git(repo, "rev-parse", "HEAD");
    // complete validates the child before touching refs, even when given a green receipt.
    const before = refs();
    expect(run("complete", { target: forged, validated: forged }).stderr).toContain("fora do versionamento");
    expect(refs()).toBe(before);
  });

  it("rejects a missing current tag when promoting maintenance", () => {
    publishSource("docs: manutenção");
    git(remote, "update-ref", "-d", "refs/tags/v1.0.0");
    const before = refs();
    expect(run("complete", { target: source, validated: source }).stderr).toContain("obrigatória ausente");
    expect(refs()).toBe(before);
  });

  it("requires CI of R and retries A at the same R after dev advances, without moving its tag", () => {
    publishSource();
    const prepared = run("prepare");
    expect(prepared.status, prepared.stderr).toBe(0);
    const target = prepared.outputs.target!;
    expect(target).not.toBe(source);
    expect(git(repo, "diff", "--name-only", source, target).split("\n").sort()).toEqual([
      "CHANGELOG.md", "USER_CHANGELOG.en.md", "USER_CHANGELOG.pt-BR.md", "package.json",
    ]);
    const timestamp = new Date(git(repo, "show", "-s", "--format=%cI", target)).toISOString();
    for (const path of ["USER_CHANGELOG.pt-BR.md", "USER_CHANGELOG.en.md"]) {
      expect(git(repo, "show", `${target}:${path}`)).toContain(`## [1.0.1] - ${timestamp}`);
    }
    expect(git(remote, "rev-parse", "dev")).toBe(target);
    expect(git(repo, "show", "-s", "--format=%P", target)).toBe(source);
    const before = refs();
    for (const validated of ["", source]) {
      expect(run("complete", { target, validated }).stderr).toContain("não comprovou o SHA");
      expect(refs()).toBe(before);
    }
    const newer = commit("fix: B posterior", { "app.txt": "B", ...notes(true) });
    git(repo, "push", "-q", "origin", `${newer}:refs/heads/dev`);
    const retry = run("prepare");
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.outputs.target).toBe(target);
    const done = run("complete", { target, validated: target });
    expect(done.status, done.stderr).toBe(0);
    expect(git(remote, "rev-parse", "staging")).toBe(target);
    expect(git(remote, "rev-parse", "v1.0.1")).toBe(target);
    expect(git(remote, "rev-parse", "dev")).toBe(newer);
    const after = refs();
    expect(run("prepare").outputs.target).toBe(target);
    expect(run("complete", { target, validated: target }).status).toBe(0);
    expect(refs()).toBe(after);
    expect(calls().filter((args) => args.includes("POST"))).toHaveLength(1);
  });

  it("does not let a newer unrelated version tag change the source bump", () => {
    publishSource();
    git(repo, "checkout", "--detach", base);
    const other = commit("chore(release): 9.0.0", { "other.txt": "side" });
    git(repo, "tag", "v9.0.0", other);
    git(repo, "push", "-q", "origin", "v9.0.0");
    const prepared = run("prepare");
    expect(prepared.status, prepared.stderr).toBe(0);
    expect(JSON.parse(git(repo, "show", `${prepared.outputs.target}:package.json`)).version).toBe("1.0.1");
  });
});

describe("V01-05 — ancestry and existing delivery", () => {
  it("updates an existing production PR with current provenance while preserving human review", () => {
    publishSource();
    const start = "<!-- promotion-provenance:start -->";
    const end = "<!-- promotion-provenance:end -->";
    const humanPrefix = "Revisão humana: deploy combinado.\n\n";
    const humanSuffix = "\n\n- [x] Changelogs revisados.\n- [ ] QA full.\n\nNota do revisor: conferir migração.\n";
    setAPI({ promotionPR: { body: `${humanPrefix}${start}\nAlvo antigo; run/100.\n${end}${humanSuffix}` } });
    mkdirSync(`${root}/control/scripts/release`, { recursive: true });
    copyFileSync("scripts/release/promotion-pr.ts", `${root}/control/scripts/release/promotion-pr.ts`);
    const workflow = YAML.parse(readFileSync(".github/workflows/promover-para-staging.yml", "utf8"));
    const step = workflow.jobs.promover.steps.find((candidate: { name?: string }) => candidate.name === "Abrir a PR staging → main");
    const result = spawnSync("bash", ["-e", "-c", step.run], {
      cwd: repo, encoding: "utf8",
      env: {
        ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FIXTURE_ROOT: root,
        SOURCE_SHA: source, TARGET_SHA: source, GITHUB_REPOSITORY: "owner/repo",
        GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "200", RUNNER_TEMP: root,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const updated = readFileSync(`${root}/updated-pr.md`, "utf8");
    expect(updated.startsWith(humanPrefix)).toBe(true);
    expect(updated.endsWith(humanSuffix)).toBe(true);
    expect(updated).toContain(`Entrada com CI aprovado: ${source}. Alvo validado pelo CI reutilizável: ${source}.`);
    expect(updated).toContain("https://github.com/owner/repo/actions/runs/200");
    expect(updated).not.toContain("run/100");
    expect(calls().some((args) => args.includes("assignees[]=andreustimm"))).toBe(true);
  });

  it("runs the post-main return steps and opens a PR when dev has diverged", () => {
    publishSource();
    git(repo, "checkout", "--detach", base);
    const main = commit("fix: hotfix publicado", { "main.txt": "hotfix" });
    git(repo, "push", "-q", "origin", `${main}:refs/heads/main`);
    git(repo, "fetch", "-q", "origin", "main", "dev");
    setAPI({ returnPR: true });
    const workflow = YAML.parse(readFileSync(".github/workflows/sincronizar-apos-main.yml", "utf8"));
    const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FIXTURE_ROOT: root, GITHUB_OUTPUT: `${root}/return-output`, VERSAO: "1.0.1" };
    const before = refs();
    for (const name of ["Devolver por fast-forward", "Devolver por PR"]) {
      const step = workflow.jobs.devolver.steps.find((candidate: { name?: string }) => candidate.name === name);
      const result = spawnSync("bash", ["-e", "-c", step.run], { cwd: repo, env, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
    expect(readFileSync(`${root}/return-output`, "utf8")).toContain("feito=nao");
    expect(calls().find((args) => args[0] === "pr" && args[1] === "create")).toEqual(expect.arrayContaining(["--base", "dev", "--head", "main"]));
    expect(calls().find((args) => args[0] === "pr" && args[1] === "merge")).toEqual(["pr", "merge", "77", "--merge", "--delete-branch=false"]);
    expect(refs()).toBe(before);
  });

  it("refuses divergence at publication time without tag, force-push or merge", () => {
    publishSource();
    const prepared = run("prepare");
    expect(prepared.status, prepared.stderr).toBe(0);
    const target = prepared.outputs.target!;
    git(repo, "checkout", "--detach", base);
    const divergent = commit("docs: staging divergiu", { "staging.txt": "diverged" });
    git(repo, "push", "-q", "origin", `${divergent}:refs/heads/staging`);
    const before = refs();
    expect(run("complete", { target, validated: target }).stderr).toContain("staging divergiu");
    expect(refs()).toBe(before);
    expect(calls().filter((args) => args.includes("POST"))).toHaveLength(0);
  });

  it("rejects non-dev targets and the old helper's implicit dev fallback", () => {
    publishSource();
    git(repo, "checkout", "--detach", base);
    const outsider = commit("docs: fora de dev", { "other.txt": "outside" });
    const before = refs();
    expect(run("complete", { target: outsider, sha: outsider, validated: outsider }).stderr).toContain("não pertence");
    const fallback = spawnSync(process.execPath, [LOWER_LEVEL, "origin", "origin/staging", "origin/dev", ""], { cwd: repo, encoding: "utf8" });
    expect(fallback.status).not.toBe(0);
    expect(refs()).toBe(before);
  });

  it("a superseded retry leaves newer staging and tags untouched", () => {
    publishSource("docs: manutenção");
    const newer = commit("docs: outra promoção", { "app.txt": "newer" });
    git(repo, "push", "-q", "origin", `${newer}:refs/heads/dev`, `${newer}:refs/heads/staging`);
    const before = refs();
    expect(run("prepare").outputs.target).toBe(source);
    const done = run("complete", { target: source, validated: source });
    expect(done.status, done.stderr).toBe(0);
    expect(done.outputs.promoted).toBe("false");
    expect(refs()).toBe(before);
  });
});

it("preserves legacy PR bodies and rejects ambiguous provenance markers", () => {
  const start = "<!-- promotion-provenance:start -->";
  const end = "<!-- promotion-provenance:end -->";
  const generated = `Template\n${start}\nProva atual.\n${end}\nChecklist novo.`;
  const legacy = "- [x] Revisado por uma pessoa.\n";
  expect(updatePromotionBody(legacy, generated)).toBe(`${start}\nProva atual.\n${end}\n\n${legacy}`);
  for (const malformed of [start, end, `${end}${start}`, `${start}${start}${end}`, `${start}${end}${end}`]) {
    expect(() => updatePromotionBody(malformed, generated)).toThrow("ambíguo");
  }
  expect(() => updatePromotionBody(legacy, "no provenance")).toThrow("sem bloco");
});

it("wires the same CI jobs to the exact target with read-only credentials before publication", () => {
  const ci = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const promotion = YAML.parse(readFileSync(".github/workflows/promover-para-staging.yml", "utf8"));
  expect(promotion.on.workflow_dispatch.inputs["target-sha"].required).toBe(true);
  expect(promotion.jobs.validar.uses).toBe("./.github/workflows/ci.yml");
  expect(promotion.jobs.validar.with["target-sha"]).toBe("${{ needs.preparar.outputs.target }}");
  expect(promotion.jobs.validar.permissions).toEqual({ contents: "read" });
  expect(promotion.jobs.validar.secrets).toBeUndefined();
  expect(promotion.jobs.promover.needs).toEqual(["preparar", "validar"]);
  expect(ci.jobs.validacao.needs).toEqual(REQUIRED_CI_JOBS);
  for (const job of REQUIRED_CI_JOBS) {
    expect(ci.jobs[job].if).toBeUndefined();
    expect(ci.jobs[job]["continue-on-error"]).toBeUndefined();
    const checkout = ci.jobs[job].steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout.with.ref).toBe("${{ inputs.target-sha || github.sha }}");
    expect(checkout.with["persist-credentials"]).toBe(false);
  }
  expect(promotion.jobs.promover.steps.find((step: { id?: string }) => step.id === "promocao").env.VALIDATED_SHA).toBe("${{ needs.validar.outputs.validated-sha }}");
  expect(ci.concurrency.group).toBe("ci-${{ inputs.target-sha || github.ref }}");
});
