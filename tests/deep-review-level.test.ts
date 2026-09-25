// Suite: nível da revisão profunda por risco do caminho (#319, G53)
// Invariant: diff que toca auth, /p/, schema, promoção/deploy, scorer ou
//   segredos recebe o pipeline completo (L2); só Markdown dispensa a revisão
//   (L0); o resto é L1. O agente não rebaixa o nível, e ele não cai entre rodadas.
// Boundary IN: .claude/skills/deep-review/scripts/review_level.py, a recusa de
//   `build_jobs.py --level L1` e as faixas exigidas por `merge_findings.py`;
//   instrução por symlink (CLAUDE.md -> AGENTS.md) conta uma fonte só (#328)
// Boundary OUT: a revisão em si (agentes), que nenhum teste automatizado prova
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPTS = ".claude/skills/deep-review/scripts";
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

type Level = { level: string; paths: { path: string; level: string; why: string }[]; pinned_by_prior_round?: boolean };

function python(args: string[]) {
  return spawnSync("python3", args, { encoding: "utf8", env: ENV });
}

function classify(...paths: string[]): Level {
  const run = python([`${SCRIPTS}/review_level.py`, "--paths", ...paths]);
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as Level;
}

function outDir(files: { path: string; disposition: string; old_path?: string }[]): string {
  const out = mkdtempSync(join(tmpdir(), "jho-deep-review-"));
  temporary.push(out);
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ files, diff_command: "git diff" }));
  return out;
}

describe("review_level.py — classificação por caminho", () => {
  it.each([
    ["src/contexts/auth/app/session.ts"],
    ["app/login/actions.ts"],
    ["app/api/export/route.ts"],
    ["app/admin/actions.ts"],
    ["app/jobs/[id]/analysis-actions.ts"],
    ["app/locale-action.ts"],
    ["app/login/callback/route.ts"],
    ["tests/entry-denial.test.ts"],
    ["tests/architecture.test.ts"],
    ["proxy.ts"],
    ["app/p/[slug]/page.tsx"],
    ["src/core/public-cv.ts"],
    ["drizzle/postgres/0027_x.sql"],
    ["src/core/db/schema.ts"],
    [".github/workflows/promover-para-staging.yml"],
    ["scripts/release/promotion.ts"],
    ["vercel.json"],
    ["src/core/scoring/score.ts"],
    ["profile/profile.yaml"],
    ["src/core/security.ts"],
    ["src/core/llm/providers.ts"],
    ["tests/password-reset.test.ts"],
    ["src/contexts/pursuit/infra/session-store.ts"],
  ])("%s é L2", (path) => {
    expect(classify(path).level).toBe("L2");
  });

  it("só Markdown é L0; código comum e script de skill são L1", () => {
    expect(classify("docs/engineering/workflow.md", "AGENTS.md", "changelog.d/x.md").level).toBe("L0");
    expect(classify("docs/engineering/workflow.md", "app/jobs/page.tsx").level).toBe("L1");
    expect(classify(".claude/skills/deep-review/scripts/build_jobs.py").level).toBe("L1");
    expect(classify("docs/diagrama.png").level).toBe("L1");
  });

  it("o nível é o máximo do diff e nomeia o caminho que o elevou", () => {
    const result = classify("docs/scoring.md", "src/core/scoring/freshness.ts");
    expect(result.level).toBe("L2");
    expect(result.paths.find((row) => row.path === "src/core/scoring/freshness.ts")?.why).toContain("scorer");
  });

  it("conta caminho filtrado e origem de rename, e não cai entre rodadas", () => {
    const out = outDir([
      { path: "docs/data-model.md", disposition: "selected" },
      { path: "drizzle/postgres/meta/0027_snapshot.json", disposition: "ignored" },
    ]);
    expect(python([`${SCRIPTS}/review_level.py`, "--out", out]).status).toBe(0);
    expect((JSON.parse(readFileSync(join(out, "level.json"), "utf8")) as Level).level).toBe("L2");

    // Rodada 2: o delta só toca Markdown, e a rodada anterior foi arquivada.
    mkdirSync(join(out, "rounds", "round-1"), { recursive: true });
    writeFileSync(join(out, "rounds", "round-1", "level.json"), readFileSync(join(out, "level.json")));
    rmSync(join(out, "level.json"));
    writeFileSync(join(out, "manifest.json"), JSON.stringify({ files: [{ path: "docs/data-model.md", disposition: "selected" }] }));
    expect(python([`${SCRIPTS}/review_level.py`, "--out", out]).status).toBe(0);
    const pinned = JSON.parse(readFileSync(join(out, "level.json"), "utf8")) as Level;
    expect(pinned.level).toBe("L2");
    expect(pinned.pinned_by_prior_round).toBe(true);

    const renamed = outDir([{ path: "legacy/0001.sql", old_path: "drizzle/0001_supreme_rawhide_kid.sql", disposition: "selected" }]);
    expect(python([`${SCRIPTS}/review_level.py`, "--out", renamed]).status).toBe(0);
    expect((JSON.parse(readFileSync(join(renamed, "level.json"), "utf8")) as Level).level).toBe("L2");
  });
});

describe("build_jobs.py e merge_findings.py — L1 não rebaixa L2 nem exige polish", () => {
  function planned(files: { path: string; disposition: string }[]): string {
    const out = outDir(files);
    writeFileSync(join(out, "plan.json"), JSON.stringify({ cohorts: [] }));
    writeFileSync(join(out, "rules.json"), JSON.stringify({ rules: [] }));
    writeFileSync(join(out, "knowledge.json"), JSON.stringify({}));
    writeFileSync(join(out, "context-pack.md"), "");
    return out;
  }

  it("recusa --level L1 para diff L2", () => {
    const out = planned([{ path: "src/contexts/auth/app/session.ts", disposition: "selected" }]);
    const run = python([`${SCRIPTS}/build_jobs.py`, "--out", out, "--level", "L1"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("--level L1 refused: the diff classifies as L2");
  });

  it("aceita --level L1 para diff comum (a recusa vem antes da validação do plano)", () => {
    const out = planned([{ path: "app/jobs/page.tsx", disposition: "selected" }]);
    const run = python([`${SCRIPTS}/build_jobs.py`, "--out", out, "--level", "L1"]);
    expect(run.stderr).not.toContain("refused");
  });

  it("L1 exige só a faixa de defeito; L2 continua exigindo as duas", () => {
    const probe = [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
      "from merge_findings import coverage_ledger",
      "manifest = {'files': [{'path': 'a.ts', 'disposition': 'selected', 'hunks': [{'start': 1, 'lines': 2, 'side': 'new'}]}]}",
      "rows = [{'lane': 'defect', 'file': 'a.ts', 'hunk': 'new:1-2'}]",
      "collected = {'hunk_coverage': rows, 'rule_coverage': []}",
      "print(json.dumps(coverage_ledger(manifest, collected, ('defect',))['summary']['lanes']))",
      "try:",
      "    coverage_ledger(manifest, collected, ('defect', 'polish'))",
      "except RuntimeError as error:",
      "    print(error)",
    ].join("\n");
    const run = python(["-c", probe]);
    expect(run.status, run.stderr).toBe(0);
    const [lanes, refusal] = run.stdout.trim().split("\n");
    expect(Object.keys(JSON.parse(lanes!) as object)).toEqual(["defect"]);
    expect(refusal).toContain("polish coverage incomplete");
  });
});

// #328: CLAUDE.md é symlink para AGENTS.md. `rel()` resolve o caminho, então as
// duas entradas viravam a mesma fonte `AGENTS.md`, e o build_jobs.py recusava o
// rules.json derivado do template com "duplicate source accounting rows".
describe("build_knowledge.py + build_jobs.py — instrução por symlink conta uma vez", () => {
  function repoWithSymlinkedInstructions(): string {
    const repo = mkdtempSync(join(tmpdir(), "jho-deep-review-repo-"));
    temporary.push(repo);
    expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(0);
    writeFileSync(join(repo, "AGENTS.md"), "# regras\n");
    symlinkSync("AGENTS.md", join(repo, "CLAUDE.md"));
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    const out = join(repo, ".deep-review", "run");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "manifest.json"), JSON.stringify({
      target: "worktree", base: "HEAD", diff_command: "git diff",
      files: [{ path: "a.ts", status: "A", disposition: "selected", adds: 1, dels: 0, hunks: [{ start: 1, lines: 1, side: "new" }] }],
    }));
    return repo;
  }

  function inRepo(repo: string, script: string, args: string[]) {
    return spawnSync("python3", [resolve(SCRIPTS, script), ...args], { cwd: repo, encoding: "utf8", env: ENV });
  }

  it("registra AGENTS.md uma vez, e o template vira rules.json aceito; L1 não anuncia polish", () => {
    const repo = repoWithSymlinkedInstructions();
    const out = join(repo, ".deep-review", "run");
    const knowledgeRun = inRepo(repo, "build_knowledge.py", ["--out", out]);
    expect(knowledgeRun.status, knowledgeRun.stderr).toBe(0);

    const knowledge = JSON.parse(readFileSync(join(out, "knowledge.json"), "utf8")) as { sources: { path: string; kind: string }[] };
    const instructions = knowledge.sources.filter((source) => source.kind === "instruction").map((source) => source.path);
    expect(instructions).toEqual(["AGENTS.md"]);

    const template = JSON.parse(readFileSync(join(out, "rules.template.json"), "utf8")) as { sources: { source: string; status: string; reason: string }[] };
    const sources = template.sources.map((row) => ({ ...row, status: "not-applicable", reason: "fixture" }));
    writeFileSync(join(out, "rules.json"), JSON.stringify({ sources, rules: [] }));
    writeFileSync(join(out, "plan.json"), JSON.stringify({ cohorts: [{ id: "C1", name: "a", risk: "normal", files: ["a.ts"] }] }));
    writeFileSync(join(out, "context-pack.md"), "");

    const l1 = inRepo(repo, "build_jobs.py", ["--out", out, "--level", "L1"]);
    expect(l1.status, l1.stderr).toBe(0);
    expect(l1.stdout).toContain("0 polish cohorts");
    expect(l1.stdout).not.toContain("polish limit");

    const l2 = inRepo(repo, "build_jobs.py", ["--out", out, "--level", "L2"]);
    expect(l2.status, l2.stderr).toBe(0);
    expect(l2.stdout).toContain("polish limit");
  });
});
