// Suite: classes de impacto → gates locais (#320, G57)
// Invariant: caminho desconhecido recebe o pacote completo; cada classe resolve
//   os gates que declara; o que `review_level.py` chama de L2 nunca recebe menos
//   que a suíte Vitest inteira, e o que ele chama de L0 só recebe os
//   validadores estruturais. Mapa inválido lança em vez de virar "nenhum gate".
// Boundary IN: config/validation-impact.json, scripts/gates/impact.ts,
//   scripts/gates/cli.ts (plano e argumentos)
// Boundary OUT: a execução real de cada gate, que é o próprio `pnpm check`
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commandFor, loadImpactMap, parseArgs } from "../scripts/gates/cli.ts";
import {
  classifyPath,
  globToRegex,
  pathWordsSource,
  planGates,
  renderPlan,
  testsMentioning,
  validateImpactMap,
  type ImpactMap,
} from "../scripts/gates/impact.ts";

const ROOT = process.cwd();
const RAW = JSON.parse(readFileSync("config/validation-impact.json", "utf8")) as Record<string, unknown>;
const MAP = loadImpactMap(ROOT);
const STRUCTURAL = ["release-ready", "instructions", "harness", "qa-tracker"];
const FULL_SUITE = ["tests", "coverage"];

/** Um caminho concreto que o glob aceita: `**` vira diretório, `*` vira nome. */
function sample(glob: string): string {
  return glob.replaceAll("**/", "x/").replaceAll("**", "x/y.ts").replaceAll("*", "x").replaceAll("?", "x");
}

function gateIds(paths: string[], map: ImpactMap = MAP): string[] {
  return planGates(map, paths).gates.map((gate) => gate.id);
}

function reviewLevelTables(): { l2: string[]; words: string; l0: string[] } {
  const probe = [
    "import sys, json",
    "sys.path.insert(0, '.claude/skills/deep-review/scripts')",
    "import review_level as r",
    "print(json.dumps({'l2': [g for g, _ in r.L2_GLOBS], 'words': r.L2_WORDS.pattern, 'l0': list(r.L0_GLOBS)}))",
  ].join("\n");
  const run = spawnSync("python3", ["-c", probe], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as { l2: string[]; words: string; l0: string[] };
}

function reviewLevel(paths: string[]): string {
  const run = spawnSync("python3", [".claude/skills/deep-review/scripts/review_level.py", "--paths", ...paths], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  expect(run.status, run.stderr).toBe(0);
  return (JSON.parse(run.stdout) as { level: string }).level;
}

describe("mapa de impacto — caminho desconhecido falha fechado", () => {
  it("caminho sem classe recebe o pacote completo e é nomeado no plano", () => {
    const plan = planGates(MAP, ["arquivo-novo-na-raiz.xyz"]);
    expect(plan.unknown).toEqual(["arquivo-novo-na-raiz.xyz"]);
    expect(plan.gates.map((gate) => gate.id).sort()).toEqual([...MAP.fullPackage].sort());
    expect(plan.gates.every((gate) => gate.reasons.includes("desconhecido"))).toBe(true);
    expect(renderPlan(plan)).toContain("arquivo-novo-na-raiz.xyz");
  });

  it("um caminho desconhecido num diff de documentação ainda puxa o pacote completo", () => {
    expect(gateIds(["docs/scoring.md", "segredo-sem-dono.bin"])).toEqual(expect.arrayContaining(MAP.fullPackage));
  });

  it("diff vazio não pede gate nenhum", () => {
    const plan = planGates(MAP, []);
    expect(plan.gates).toEqual([]);
    expect(renderPlan(plan)).toContain("nada a validar");
  });

  it("recusa caminho fora do repositório", () => {
    expect(() => planGates(MAP, ["../fora.ts"])).toThrow("fora do repositório");
    expect(() => planGates(MAP, ["/etc/passwd"])).toThrow("fora do repositório");
  });
});

describe("mapa de impacto — cada classe resolve os gates que declara", () => {
  it.each(MAP.classes.map((klass) => [klass.id, klass] as const))("%s", (_id, klass) => {
    const path = sample(klass.patterns[0]!);
    expect(classifyPath(MAP, path)).toContain(klass.id);
    const planned = new Set(gateIds([path]));
    const expected = klass.gates.flatMap((gate) => (gate === "full" ? MAP.fullPackage : [gate]));
    for (const gate of expected) {
      const coveredBy = Object.entries(MAP.gates).filter(([, spec]) => spec.satisfies?.includes(gate)).map(([id]) => id);
      expect(planned.has(gate) || coveredBy.some((id) => planned.has(id)), `${klass.id}: ${gate}`).toBe(true);
    }
  });

  it("as classes pedidas pela #320 existem", () => {
    const ids = MAP.classes.map((klass) => klass.id);
    for (const id of ["docs", "tooling", "backend", "ui", "db", "auth-security", "deploy"]) expect(ids).toContain(id);
  });

  it("Markdown fica só nos validadores estruturais, inclusive o de skill", () => {
    for (const path of ["docs/engineering/workflow.md", ".claude/skills/deep-review/SKILL.md", "changelog.d/x.md", "AGENTS.md"]) {
      expect(gateIds([path]), path).toEqual(STRUCTURAL);
    }
  });

  it("tela pede E2E; código de domínio pede tipos e testes relacionados", () => {
    expect(gateIds(["app/jobs/page.tsx"])).toEqual(["typecheck", "related-tests", "e2e"]);
    expect(gateIds(["src/contexts/matching/domain/rank.ts"])).toEqual(["typecheck", "related-tests"]);
  });

  it("a suíte inteira satisfaz os testes relacionados, e a união ordena pelo mapa", () => {
    const plan = planGates(MAP, ["drizzle/0099_x.sql", "app/jobs/page.tsx", "docs/data-model.md"]);
    expect(plan.gates.map((gate) => gate.id)).toEqual([...STRUCTURAL, "typecheck", "tests", "e2e"]);
    expect(plan.gates.find((gate) => gate.id === "tests")?.reasons).toEqual(["db"]);
  });

  it("palavra de segurança no caminho classifica mesmo sem padrão", () => {
    expect(classifyPath(MAP, "src/contexts/pursuit/infra/session-store.ts")).toContain("auth-security");
    expect(classifyPath(MAP, "tests/password-reset.test.ts")).toContain("auth-security");
    expect(classifyPath(MAP, "src/core/sessionless.ts")).not.toContain("auth-security");
  });
});

describe("mapa de impacto — coerente com review_level.py (#319)", () => {
  const tables = reviewLevelTables();

  it("usa exatamente as palavras de segurança do nível de revisão", () => {
    const auth = MAP.classes.find((klass) => klass.id === "auth-security")!;
    expect(pathWordsSource(auth.pathWords!)).toBe(tables.words);
  });

  it.each(tables.l2.map((glob) => [glob]))("L2 %s nunca recebe menos que a suíte inteira", (glob) => {
    const path = sample(glob);
    expect(reviewLevel([path])).toBe("L2");
    expect(gateIds([path]).some((gate) => FULL_SUITE.includes(gate)), path).toBe(true);
  });

  it("L0 recebe só os validadores estruturais", () => {
    for (const glob of tables.l0) {
      const path = sample(glob);
      expect(reviewLevel([path])).toBe("L0");
      expect(gateIds([path])).toEqual(STRUCTURAL);
    }
  });

  it("o glob lê o padrão exatamente como o tradutor da skill", () => {
    const cases: [string, string][] = [
      ["app/**/route.ts", "app/route.ts"],
      ["app/**/route.ts", "app/x/y/route.ts"],
      ["app/**/route.ts", "apps/route.ts"],
      ["**/*.md", "README.md"],
      ["**/*.md", "a/b/c.md"],
      ["scripts/*.ts", "scripts/a/b.ts"],
      ["scripts/**", "scripts"],
      ["a?c.ts", "abc.ts"],
      ["a?c.ts", "a/c.ts"],
      ["a+b.ts", "aab.ts"],
      ["**/.env*", ".env.local"],
    ];
    const probe = [
      "import sys, json",
      "sys.path.insert(0, '.claude/skills/deep-review/scripts')",
      "from _common import glob_to_regex",
      `cases = json.loads(${JSON.stringify(JSON.stringify(cases))})`,
      "print(json.dumps([bool(glob_to_regex(g).match(p)) for g, p in cases]))",
    ].join("\n");
    const run = spawnSync("python3", ["-c", probe], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    expect(run.status, run.stderr).toBe(0);
    expect(cases.map(([glob, path]) => globToRegex(glob).test(path))).toEqual(JSON.parse(run.stdout));
  });
});

describe("mapa de impacto — validação falha fechado", () => {
  const broken = (patch: (map: Record<string, unknown>) => void) => {
    const copy = structuredClone(RAW);
    patch(copy);
    return () => validateImpactMap(copy);
  };
  const classes = (map: Record<string, unknown>) => map.classes as Record<string, unknown>[];
  const gates = (map: Record<string, unknown>) => map.gates as Record<string, Record<string, unknown>>;

  it.each([
    ["não objeto", () => validateImpactMap([]), "objeto"],
    ["schemaVersion", broken((map) => { map.schemaVersion = 2; }), "schemaVersion"],
    ["mapVersion", broken((map) => { map.mapVersion = "1"; }), "mapVersion"],
    ["unknownPaths", broken((map) => { map.unknownPaths = "skip"; }), "unknownPaths"],
    ["gates ausentes", broken((map) => { map.gates = {}; }), "gates ausentes"],
    ["gate reservado", broken((map) => { gates(map).full = { description: "x", command: ["x"] }; }), "reservado"],
    ["gate não objeto", broken((map) => { gates(map).x = "pnpm x" as never; }), "gate x inválido"],
    ["gate sem descrição", broken((map) => { gates(map).typecheck!.description = ""; }), "sem descrição"],
    ["gate sem comando", broken((map) => { gates(map).typecheck!.command = []; }), "sem comando"],
    ["appendFiles", broken((map) => { gates(map).typecheck!.appendFiles = "sim"; }), "appendFiles"],
    ["satisfies inválido", broken((map) => { gates(map).tests!.satisfies = "related-tests"; }), "satisfies"],
    ["satisfies inexistente", broken((map) => { gates(map).tests!.satisfies = ["nada"]; }), "inexistente nada"],
    ["satisfies a si", broken((map) => { gates(map).tests!.satisfies = ["tests"]; }), "a si mesmo"],
    ["fullPackage vazio", broken((map) => { map.fullPackage = []; }), "fullPackage"],
    ["fullPackage inexistente", broken((map) => { map.fullPackage = ["nada"]; }), "fullPackage cita"],
    ["classes ausentes", broken((map) => { map.classes = []; }), "classes ausentes"],
    ["classe sem id", broken((map) => { classes(map)[0]!.id = ""; }), "sem id"],
    ["classe duplicada", broken((map) => { classes(map)[1]!.id = classes(map)[0]!.id; }), "duplicada"],
    ["classe sem descrição", broken((map) => { classes(map)[0]!.description = ""; }), "sem descrição"],
    ["classe sem padrões", broken((map) => { classes(map)[0]!.patterns = []; }), "sem padrões"],
    ["exclude inválido", broken((map) => { classes(map)[0]!.exclude = [""]; }), "exclude"],
    ["pathWords inválido", broken((map) => { classes(map)[0]!.pathWords = ["a|b"]; }), "pathWords"],
    ["classe sem gates", broken((map) => { classes(map)[0]!.gates = []; }), "sem gates"],
    ["gate inexistente", broken((map) => { classes(map)[0]!.gates = ["nada"]; }), "gate inexistente nada"],
  ])("%s", (_name, run, message) => {
    expect(run).toThrow(message);
  });

  it("o mapa versionado é válido", () => {
    expect(() => validateImpactMap(RAW)).not.toThrow();
  });
});

describe("pnpm gates — argumentos e comando", () => {
  it("lê base, plano e caminhos, e recusa o resto", () => {
    expect(parseArgs([])).toEqual({ base: "origin/dev", plan: false, paths: null });
    expect(parseArgs(["--plan", "--base", "main", "--paths", "a.ts", "b.md"])).toEqual({ base: "main", plan: true, paths: ["a.ts", "b.md"] });
    expect(() => parseArgs(["--base"])).toThrow("--base exige");
    expect(() => parseArgs(["--paths"])).toThrow("--paths exige");
    expect(() => parseArgs(["--rapido"])).toThrow("opção desconhecida");
  });

  it("testes relacionados recebem os arquivos e os testes que os citam", () => {
    expect(testsMentioning({ "tests/a.test.ts": "spawn('scripts/x.sh')", "tests/b.test.ts": "nada" }, ["scripts/x.sh"])).toEqual(["tests/a.test.ts"]);
    expect(testsMentioning({ "tests/a.test.ts": "tests/a.test.ts" }, ["tests/a.test.ts"])).toEqual([]);
    const [gate] = planGates(MAP, ["scripts/worktree-status.mjs"]).gates.filter((item) => item.id === "related-tests");
    const command = commandFor(gate!, ROOT, MAP);
    expect(command.slice(0, 5)).toEqual(["pnpm", "exec", "vitest", "related", "--run"]);
    expect(command).toContain("scripts/worktree-status.mjs");
    expect(command).toContain("tests/worktree-workflow.test.ts");
  });

  it("diff que só apagou arquivos roda a suíte inteira em vez de nenhum teste", () => {
    const [gate] = planGates(MAP, ["src/core/apagado-ha-tempo.ts"]).gates.filter((item) => item.id === "related-tests");
    expect(commandFor(gate!, ROOT, MAP)).toEqual(MAP.gates.tests!.command);
  });

  it("--plan imprime o plano em JSON pela CLI", () => {
    const run = spawnSync("node", ["--experimental-strip-types", "--no-warnings", "scripts/gates/cli.ts", "--plan", "--paths", "docs/x.md"], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect((JSON.parse(run.stdout) as { gates: { id: string }[] }).gates.map((gate) => gate.id)).toEqual(STRUCTURAL);
  });

  it("opção inválida sai com código 1 e sem plano", () => {
    const run = spawnSync("node", ["--experimental-strip-types", "--no-warnings", "scripts/gates/cli.ts", "--rapido"], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("opção desconhecida");
  });
});
