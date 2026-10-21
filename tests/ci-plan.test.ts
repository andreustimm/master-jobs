// Suite: plano do CI de PR (issue #535, decisão do dono de 13/10/2026 sobre a G57)
// Invariant: só uma PR para `dev`, com diff legível e conhecido, recebe o plano
//   recortado — e o recorte é o da tabela de impacto, não um segundo
//   classificador. Todo o resto (push, dispatch, promoção, produção, dúvida)
//   recebe o plano completo.
// Boundary IN: scripts/github/ci-plan.ts com o mapa real de
//   config/validation-impact.json; um repositório Git temporário com commit de
//   merge de verdade para o diff.
// Boundary OUT: o scheduler do Actions (ci-pipeline.test.ts lê o workflow).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateImpactMap } from "../scripts/gates/impact.ts";
import {
  DATABASE_PATTERNS,
  DECISIONS,
  PLAN_OUTPUTS,
  PLAN_SELF_PATHS,
  changedPaths,
  ciPlan,
  type PlanInput,
} from "../scripts/github/ci-plan.ts";

const map = validateImpactMap(JSON.parse(readFileSync("config/validation-impact.json", "utf8")));
const pullRequest: PlanInput = { event: "pull_request", baseRef: "dev", targetSha: "" };

const plan = (paths: string[], input: Partial<PlanInput> = {}) => ciPlan({ ...pullRequest, ...input }, map, () => paths);

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
      // O que só o navegador observa, mesmo fora de `app/` (classe `browser-visible`).
      "next.config.ts",
      "content/legal/terms.pt-BR.md",
      "USER_CHANGELOG.en.md",
      "CHANGELOG.md",
      "scripts/build-changelog.ts",
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
    expect(plan(["app/jobs/page.tsx"]).motivo).toContain("e2e roda");
    expect(plan(["docs/x.md"]).motivo).toContain("e2e pula");
  });
});

describe("banco-nas-majors em PR: só quando o diff toca a lista do banco", () => {
  it("a lista é a decisão do dono de 13/10/2026 mais o que a revisão do orquestrador somou", () => {
    expect([...DATABASE_PATTERNS]).toEqual([
      // O dono.
      "drizzle/**",
      "src/core/db/**",
      "supabase/**",
      "tests/support/**",
      "config/postgres-majors.json",
      // Revisão do orquestrador: dependência, configuração do drizzle-kit e o
      // runner do próprio job.
      "package.json",
      "pnpm-lock.yaml",
      "drizzle.config.ts",
      "drizzle.postgres.config.ts",
      "scripts/versions/postgres-majors.ts",
    ]);
  });

  it("cada caminho da lista aciona o banco", () => {
    for (const path of [
      "drizzle/postgres/0035_x.sql",
      "drizzle/postgres/meta/_journal.json",
      "src/core/db/client.ts",
      "src/core/db/sub/pasta/x.ts",
      "supabase/config.toml",
      "supabase/migrations/20260101_x.sql",
      "tests/support/postgres-global.ts",
      "config/postgres-majors.json",
      "package.json",
      "pnpm-lock.yaml",
      "drizzle.config.ts",
      "drizzle.postgres.config.ts",
      "scripts/versions/postgres-majors.ts",
    ]) {
      expect(plan([path]).banco, path).toBe(true);
    }
  });

  it("o bump de dependência que o Renovate abre roda o banco e o E2E; o runner do job, só o banco", () => {
    expect(plan(["package.json", "pnpm-lock.yaml"])).toMatchObject({ banco: true, e2e: true });
    expect(plan(["scripts/versions/postgres-majors.ts"])).toMatchObject({ banco: true, e2e: false });
  });

  it("um caminho da lista no meio de outros basta; fora da lista, não — documentação inclusive", () => {
    expect(plan(["app/jobs/page.tsx", "src/core/db/schema.ts"]).banco).toBe(true);
    for (const path of [
      "app/jobs/page.tsx",
      "src/core/dbx/x.ts",
      "src/core/scoring/db.ts",
      "scripts/versions/check.ts",
      "tests/support-extra/x.ts",
      "docs/data-model.md",
      "changelog.d/x.md",
    ]) {
      expect(plan([path]).banco, path).toBe(false);
    }
  });
});

describe("as decisões do plano", () => {
  it("uma saída por job recortado, e o plano completo liga todas", () => {
    expect([...PLAN_OUTPUTS].sort()).toEqual(["banco", "e2e"]);
    expect(Object.keys(DECISIONS).sort()).toEqual([...PLAN_OUTPUTS].sort());
    const result = plan(["docs/a.md"], { event: "push" });
    for (const output of PLAN_OUTPUTS) expect(result[output], output).toBe(true);
  });

  it("o motivo nomeia o que cada saída decidiu", () => {
    expect(plan(["drizzle/postgres/0035_x.sql"]).motivo).toBe("1 arquivo(s); e2e pula, banco roda");
  });
});

describe("tudo o que não é PR para dev recebe o plano completo", () => {
  const docsOnly = ["docs/engineering/deploy.md"];

  it("push, dispatch, chamada de workflow e evento ausente", () => {
    for (const event of ["push", "workflow_dispatch", "workflow_run", "schedule", "merge_group", undefined]) {
      const result = plan(docsOnly, { event });
      expect(result, String(event)).toMatchObject({ e2e: true, banco: true });
      expect(result.motivo).toContain("plano completo");
    }
  });

  it("a chamada reutilizável da promoção, mesmo que o evento do chamador seja PR", () => {
    expect(plan(docsOnly, { targetSha: "a".repeat(40) })).toMatchObject({ e2e: true, banco: true });
  });

  it("PR de outra base: a de produção e qualquer branch que não seja dev", () => {
    for (const baseRef of ["main", "staging", "feat/outra", "", undefined]) {
      expect(plan(docsOnly, { baseRef }), String(baseRef)).toMatchObject({ e2e: true, banco: true });
    }
  });

  it("diff vazio, ilegível ou com caminho inválido não prova nada", () => {
    expect(plan([])).toEqual({ e2e: true, banco: true, motivo: "diff vazio: plano completo" });
    const unreadable = ciPlan(pullRequest, map, () => {
      throw new Error("fatal: bad revision 'HEAD^1'\nmais uma linha");
    });
    expect(unreadable).toEqual({
      e2e: true,
      banco: true,
      motivo: "diff ilegível (fatal: bad revision 'HEAD^1'): plano completo",
    });
    const outside = plan(["../fora.md"]);
    expect(outside).toMatchObject({ e2e: true, banco: true });
    expect(outside.motivo).toContain("caminho inválido");
    // Desconhecido liga TODAS as saídas, inclusive as que não leem os gates.
    for (const path of ["sql/seed.sql", "infra/terraform/main.tf"]) {
      const unknown = plan(["docs/a.md", path]);
      expect(unknown, path).toMatchObject({ e2e: true, banco: true });
      expect(unknown.motivo).toContain(`caminho desconhecido (${path})`);
    }
  });

  it("PR que muda o próprio plano não o relaxa", () => {
    expect([...PLAN_SELF_PATHS]).toEqual([
      ".github/workflows/ci.yml",
      "scripts/github/ci-plan.ts",
      "scripts/gates/impact.ts",
      "config/validation-impact.json",
    ]);
    for (const path of PLAN_SELF_PATHS) {
      const result = plan(["docs/a.md", path]);
      expect(result, path).toMatchObject({ e2e: true, banco: true });
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
    expect(docs.stdout).toBe("e2e=false\nbanco=false\n");
    expect(docs.stderr).toContain("e2e pula, banco pula");

    const ui = exec(mergeCommit({ "app/page.tsx": "export {};\n" }), {});
    expect(ui.stdout).toBe("e2e=true\nbanco=false\n");

    const db = exec(mergeCommit({ "drizzle/postgres/0035_x.sql": "select 1;\n" }), {});
    expect(db.stdout).toBe("e2e=false\nbanco=true\n");

    const push = exec(mergeCommit({ "docs/a.md": "x\n" }), { EVENTO: "push" });
    expect(push.stdout).toBe("e2e=true\nbanco=true\n");

    // Sem commit de merge (clone raso do push, por exemplo) a PR não recorta nada.
    const semMerge = exec(mergeCommit({ "docs/a.md": "x\n" }, { merge: false }), {});
    expect(semMerge.stdout).toBe("e2e=true\nbanco=true\n");
    expect(semMerge.stderr).toContain("HEAD não é um commit de merge de PR");
    // Cinco repositórios Git e cinco processos Node: os 5 s padrão não bastam
    // numa máquina carregada.
  }, 30_000);
});
