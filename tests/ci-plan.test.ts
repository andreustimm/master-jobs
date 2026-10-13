// Suite: plano do CI de PR (issue #535, decisão do dono de 13/10/2026 sobre a G57)
// Invariant: só uma PR para `dev`, com diff legível e conhecido, recebe o plano
//   recortado — e o recorte é o da tabela de impacto (mais a lista de banco do
//   dono), não um segundo classificador. Markdown que o app ou o build lê não
//   é L0. Todo o resto (push, dispatch, promoção, produção, dúvida) recebe o
//   plano completo.
// Boundary IN: scripts/github/ci-plan.ts com o mapa real de
//   config/validation-impact.json; um repositório Git temporário com commit de
//   merge de verdade para o diff.
// Boundary OUT: o scheduler do Actions (ci-pipeline.test.ts lê o workflow).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyPath, validateImpactMap } from "../scripts/gates/impact.ts";
import {
  DATABASE_PATTERNS,
  PLAN_SELF_PATHS,
  STRUCTURAL_GATES,
  changedPaths,
  ciPlan,
  type PlanInput,
} from "../scripts/github/ci-plan.ts";

const map = validateImpactMap(JSON.parse(readFileSync("config/validation-impact.json", "utf8")));
const pullRequest: PlanInput = { event: "pull_request", baseRef: "dev", targetSha: "" };

const plan = (paths: string[], input: Partial<PlanInput> = {}) => ciPlan({ ...pullRequest, ...input }, map, () => paths);
const classes = (path: string) => classifyPath(map, path);

describe("PR para dev: o E2E segue a tabela de impacto", () => {
  it("não roda para o que a tabela não manda testar em navegador", () => {
    for (const paths of [
      ["docs/engineering/deploy.md"],
      ["changelog.d/gates-por-plano.md", "docs/engineering/rules/delivery.md", "AGENTS.md"],
      ["src/core/ingest/detect.ts", "tests/ingest.test.ts"],
      ["scripts/gates/cli.ts"],
      ["drizzle/postgres/0034_x.sql"],
      [".github/workflows/governanca.yml"],
    ]) {
      expect(plan(paths).e2e, paths.join(", ")).toBe(false);
    }
  });

  it("roda para tela, dicionário, suíte de navegador, autenticação, transversal e desconhecido", () => {
    for (const path of [
      "app/jobs/page.tsx",
      "components/nav.tsx",
      "src/core/i18n/pt-BR.ts",
      "tests/e2e/setup.mjs",
      "src/contexts/auth/session-store.ts",
      "proxy.ts",
      "package.json",
      "tests/support/postgres-global.ts",
      "algo-que-nenhuma-classe-conhece.bin",
    ]) {
      expect(plan([path]).e2e, path).toBe(true);
    }
  });

  it("um arquivo que a tabela manda testar basta, no meio de documentação", () => {
    expect(plan(["docs/a.md", "docs/b.md", "app/jobs/page.tsx"]).e2e).toBe(true);
  });

  it("decide pelo que o `planGates` decide, sem segundo classificador", () => {
    const ui = map.classes.find((klass) => klass.id === "ui")!;
    expect(ui.gates).toContain("e2e");
    expect(plan(["app/jobs/page.tsx"]).motivo).toContain("pede o gate e2e");
    expect(plan(["docs/x.md"]).motivo).toContain("não pede o gate e2e");
  });
});

describe("PR L0: só validadores estruturais, nenhum job pesado", () => {
  it("documentação não paga E2E, suíte nem banco", () => {
    for (const paths of [
      ["docs/engineering/deploy.md"],
      ["changelog.d/gates-por-plano.md", "docs/engineering/rules/delivery.md", "AGENTS.md"],
      [".claude/skills/deep-review/SKILL.md"],
      [".compozy/tasks/x/_techspec.md"],
      ["docs/qa/scenarios/PIPE-x.md", "README.md"],
      ["docs/imagem.png"],
    ]) {
      const result = plan(paths);
      expect(result, paths.join(", ")).toMatchObject({ e2e: false, suite: false, banco: false });
      expect(result.motivo).toContain("L0");
    }
  });

  it("L0 é o que a tabela chama de validadores estruturais, nem mais nem menos", () => {
    expect([...STRUCTURAL_GATES].sort()).toEqual(["harness", "instructions", "qa-tracker", "release-ready"]);
    const docs = map.classes.filter((klass) => klass.id === "docs" || klass.id === "docs-assets");
    for (const klass of docs) expect(klass.gates.every((gate) => STRUCTURAL_GATES.has(gate)), klass.id).toBe(true);
  });

  it("Markdown que o app ou o build lê NÃO é L0: textos legais, prompts e changelogs compilados", () => {
    for (const path of [
      "content/legal/terms.pt-BR.md",
      "content/legal/privacy.en.md",
      "docs/prompts/system/job-analysis.md",
      "CHANGELOG.md",
      "USER_CHANGELOG.pt-BR.md",
      "USER_CHANGELOG.en.md",
    ]) {
      const result = plan([path]);
      expect(result, path).toMatchObject({ e2e: false, suite: true, banco: false });
      // O pacote da tabela é o do `runtime-markdown`, não um acidente de caminho desconhecido.
      expect(classes(path), path).toContain("runtime-markdown");
    }
  });

  it("um arquivo de código, no meio de documentação, traz a suíte inteira de volta", () => {
    for (const code of ["scripts/gates/cli.ts", "src/core/ingest/detect.ts", "package.json", "algo-que-nenhuma-classe-conhece.bin"]) {
      expect(plan(["docs/a.md", "docs/b.md", code]).suite, code).toBe(true);
    }
  });

  it("código recebe a suíte e não recebe o banco, a menos que toque o banco", () => {
    expect(plan(["src/core/ingest/detect.ts", "tests/ingest.test.ts"])).toMatchObject({ suite: true, banco: false });
    expect(plan(["app/jobs/page.tsx"])).toMatchObject({ suite: true, banco: false });
  });
});

describe("banco-nas-majors em PR: só quando o diff toca a lista do dono", () => {
  it("a lista é exatamente a decisão de 13/10/2026", () => {
    expect([...DATABASE_PATTERNS]).toEqual([
      "drizzle/**",
      "src/core/db/**",
      "supabase/**",
      "tests/support/**",
      "config/postgres-majors.json",
    ]);
  });

  it("cada caminho da lista aciona o banco, e a suíte junto", () => {
    for (const path of [
      "drizzle/postgres/0035_x.sql",
      "drizzle/postgres/meta/_journal.json",
      "src/core/db/client.ts",
      "src/core/db/sub/pasta/x.ts",
      "supabase/config.toml",
      "supabase/migrations/20260101_x.sql",
      "tests/support/postgres-global.ts",
      "config/postgres-majors.json",
    ]) {
      expect(plan([path]), path).toMatchObject({ suite: true, banco: true });
    }
  });

  it("um caminho da lista no meio de outros basta; fora da lista, não", () => {
    expect(plan(["app/jobs/page.tsx", "src/core/db/schema.ts"]).banco).toBe(true);
    for (const path of ["src/core/dbx/x.ts", "src/core/scoring/db.ts", "drizzle.config.ts", "docs/data-model.md"]) {
      expect(plan([path]).banco, path).toBe(false);
    }
  });

  it("L0 nunca roda o banco, nem com Markdown dentro de um caminho da lista", () => {
    for (const path of ["supabase/README.md", "src/core/db/README.md", "drizzle/postgres/NOTES.md"]) {
      expect(plan([path]), path).toMatchObject({ suite: false, banco: false });
    }
  });
});

describe("tudo o que não é PR para dev recebe o plano completo", () => {
  const docsOnly = ["docs/engineering/deploy.md"];
  const everything = { e2e: true, suite: true, banco: true };

  it("push, dispatch, chamada de workflow e evento ausente", () => {
    for (const event of ["push", "workflow_dispatch", "workflow_run", "schedule", "merge_group", undefined]) {
      const result = plan(docsOnly, { event });
      expect(result, String(event)).toMatchObject(everything);
      expect(result.motivo).toContain("plano completo");
    }
  });

  it("a chamada reutilizável da promoção, mesmo que o evento do chamador seja PR", () => {
    expect(plan(docsOnly, { targetSha: "a".repeat(40) })).toMatchObject(everything);
  });

  it("PR de outra base: a de produção e qualquer branch que não seja dev", () => {
    for (const baseRef of ["main", "staging", "feat/outra", "", undefined]) {
      expect(plan(docsOnly, { baseRef }), String(baseRef)).toMatchObject(everything);
    }
  });

  it("diff vazio, ilegível ou com caminho inválido não prova nada", () => {
    expect(plan([]).motivo).toContain("diff vazio");
    expect(plan([])).toMatchObject(everything);
    const unreadable = ciPlan(pullRequest, map, () => {
      throw new Error("fatal: bad revision 'HEAD^1'\nmais uma linha");
    });
    expect(unreadable).toEqual({ ...everything, motivo: "diff ilegível (fatal: bad revision 'HEAD^1'): plano completo" });
    expect(plan(["../fora.md"])).toMatchObject(everything);
  });

  it("PR que muda o próprio plano não o relaxa", () => {
    expect(PLAN_SELF_PATHS).toEqual(
      expect.arrayContaining([".github/workflows/ci.yml", "scripts/github/ci-plan.ts", "config/validation-impact.json"]),
    );
    for (const path of PLAN_SELF_PATHS) {
      const result = plan(["docs/a.md", path]);
      expect(result, path).toMatchObject(everything);
      expect(result.motivo).toContain("muda o próprio plano");
    }
  });
});

describe("com Git de verdade", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]) {
    const config = ["user.name=t", "user.email=t@example.com", "commit.gpgsign=false", "core.hooksPath=/dev/null"];
    const run = spawnSync("git", [...config.flatMap((entry) => ["-c", entry]), ...args], { cwd, encoding: "utf8" });
    if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
    return run.stdout;
  }

  /**
   * Base com `README.md`, branch da PR com `changes` (`null` apaga) e o commit
   * de merge que o Actions testa. A base anda depois da PR, para provar que o
   * diff é contra o primeiro pai e não contra a ponta antiga.
   */
  function mergeCommit(changes: Record<string, string | null>, { merge = true } = {}) {
    const root = mkdtempSync(join(tmpdir(), "ci-plan-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "dev");
    mkdirSync(join(root, "config"));
    cpSync("config/validation-impact.json", join(root, "config/validation-impact.json"));
    writeFileSync(join(root, "README.md"), "base\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "pr");
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) {
        rmSync(join(root, path));
        continue;
      }
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "pr");
    git(root, "checkout", "-q", "dev");
    writeFileSync(join(root, "so-na-base.md"), "base andou\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base andou");
    if (merge) git(root, "merge", "-q", "--no-ff", "-m", "merge", "pr");
    return root;
  }

  it("lê só o que a PR mudou, contra o primeiro pai, com acento", () => {
    const root = mergeCommit({ "docs/ação.md": "x\n", "app/page.tsx": "export {};\n" });
    // `so-na-base.md` entrou na base depois da PR e não é da PR.
    expect(changedPaths((args) => git(root, ...args)).sort()).toEqual(["app/page.tsx", "docs/ação.md"]);
  });

  it("arquivo movido lista origem e destino: mover código para docs/ não parece documentação", () => {
    const root = mergeCommit({ "README.md": null, "docs/README.md": "base\n" });
    expect(changedPaths((args) => git(root, ...args)).sort()).toEqual(["README.md", "docs/README.md"]);
  });

  it("HEAD que não é commit de merge lança, em vez de inventar um diff", () => {
    const root = mergeCommit({ "docs/a.md": "x\n" }, { merge: false });
    expect(() => changedPaths((args) => git(root, ...args))).toThrow("não é um commit de merge");
  });

  it("o script, de ponta a ponta: stdout para o GITHUB_OUTPUT, motivo no stderr", () => {
    const script = resolve("scripts/github/ci-plan.ts");
    const exec = (root: string, env: Record<string, string>) =>
      spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, EVENTO: "pull_request", BASE_REF: "dev", TARGET_SHA: "", ...env },
      });

    const docs = exec(mergeCommit({ "docs/a.md": "x\n" }), {});
    expect(docs.status).toBe(0);
    expect(docs.stdout).toBe("e2e=false\nsuite=false\nbanco=false\n");
    expect(docs.stderr).toContain("L0: só validadores estruturais");

    const ui = exec(mergeCommit({ "app/page.tsx": "export {};\n" }), {});
    expect(ui.stdout).toBe("e2e=true\nsuite=true\nbanco=false\n");

    const db = exec(mergeCommit({ "src/core/db/x.ts": "export {};\n" }), {});
    expect(db.stdout).toBe("e2e=false\nsuite=true\nbanco=true\n");

    // Markdown que o app lê no servidor não é documentação para o CI.
    const legal = exec(mergeCommit({ "content/legal/terms.pt-BR.md": "x\n" }), {});
    expect(legal.stdout).toBe("e2e=false\nsuite=true\nbanco=false\n");

    const push = exec(mergeCommit({ "docs/a.md": "x\n" }), { EVENTO: "push" });
    expect(push.stdout).toBe("e2e=true\nsuite=true\nbanco=true\n");

    // Sem commit de merge (clone raso do push, por exemplo) a PR não recorta nada.
    const semMerge = exec(mergeCommit({ "docs/a.md": "x\n" }, { merge: false }), {});
    expect(semMerge.stdout).toBe("e2e=true\nsuite=true\nbanco=true\n");
    expect(semMerge.stderr).toContain("HEAD não é um commit de merge de PR");
  });
});
