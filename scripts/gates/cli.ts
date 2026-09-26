// `pnpm gates [--base <ref>] [--plan] [--paths <caminho>…]`
//
// Roda os gates locais que o diff exige, na ordem de `config/validation-impact.json`
// (G57, #320). Sem `--paths`, o diff é tudo o que difere da base de mesclagem
// com `--base` (padrão `origin/dev`): commits da branch, índice, árvore de
// trabalho e arquivos novos não ignorados. `--plan` só imprime o plano em JSON.
// Para no primeiro gate vermelho. Base que não resolve falha fechado.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planGates, renderPlan, testsMentioning, validateImpactMap, type ImpactMap, type Plan, type PlannedGate } from "./impact.ts";

export const IMPACT_FILE = "config/validation-impact.json";
export const DEFAULT_BASE = "origin/dev";

export type Args = { base: string; plan: boolean; paths: string[] | null };

const USAGE = "uso: pnpm gates [--base <ref>] [--plan] [--paths <caminho>…]";

export function loadImpactMap(root: string): ImpactMap {
  return validateImpactMap(JSON.parse(readFileSync(resolve(root, IMPACT_FILE), "utf8")));
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { base: DEFAULT_BASE, plan: false, paths: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--plan") args.plan = true;
    else if (arg === "--base") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`--base exige um valor\n${USAGE}`);
      args.base = value;
    } else if (arg === "--paths") {
      args.paths = argv.slice(index + 1);
      if (args.paths.length === 0) throw new Error(`--paths exige ao menos um caminho\n${USAGE}`);
      break;
    } else throw new Error(`opção desconhecida: ${arg}\n${USAGE}`);
  }
  return args;
}

function git(root: string, args: string[]): string {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.trim() || `saída ${run.status}`}`);
  return run.stdout;
}

function nulList(output: string): string[] {
  return output.split("\0").filter((item) => item !== "");
}

/**
 * Tudo o que difere da base de mesclagem: `git diff <merge-base>` compara com a
 * árvore de trabalho, então pega commit, índice e edição não indexada de uma
 * vez. `--no-renames` põe origem e destino de um rename no plano — mover um
 * arquivo para fora de `drizzle/` ainda toca schema.
 */
export function changedPaths(root: string, base: string): string[] {
  const mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
  const tracked = nulList(git(root, ["diff", "--name-only", "--no-renames", "-z", mergeBase, "--"]));
  const untracked = nulList(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  return [...new Set([...tracked, ...untracked])].sort();
}

function testSources(root: string): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const file of nulList(git(root, ["ls-files", "-z", "--", "tests"]))) {
    if (file.endsWith(".test.ts") && existsSync(resolve(root, file))) sources[file] = readFileSync(resolve(root, file), "utf8");
  }
  return sources;
}

/**
 * O comando final de um gate. O que recebe arquivos leva os que existem e os
 * testes que os citam; se nenhum existe (o diff só apagou), roda a suíte
 * inteira — apagar não pode virar "nenhum teste".
 */
export function commandFor(gate: PlannedGate, root: string, map: ImpactMap): string[] {
  if (!gate.appendFiles) return gate.command;
  const present = gate.files.filter((file) => existsSync(resolve(root, file)));
  if (present.length === 0) return map.gates.tests?.command ?? gate.command;
  const mentioned = testsMentioning(testSources(root), present);
  return [...gate.command, ...new Set([...present, ...mentioned])];
}

export type GateResult = { id: string; status: "pass" | "fail"; seconds: number };

export function runPlan(plan: Plan, root: string, map: ImpactMap): GateResult[] {
  const results: GateResult[] = [];
  for (const gate of plan.gates) {
    const [command, ...args] = commandFor(gate, root, map);
    console.log(`\n▶ ${gate.id}: ${[command, ...args].join(" ")}`);
    const started = Date.now();
    const run = spawnSync(command!, args, { cwd: root, stdio: "inherit" });
    const status = run.status === 0 ? "pass" : "fail";
    results.push({ id: gate.id, status, seconds: Math.round((Date.now() - started) / 1000) });
    if (status === "fail") break;
  }
  return results;
}

export function main(argv: readonly string[], root: string): number {
  const args = parseArgs(argv);
  const map = loadImpactMap(root);
  const plan = planGates(map, args.paths ?? changedPaths(root, args.base));
  if (args.plan) {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  console.log(renderPlan(plan));
  const results = runPlan(plan, root, map);
  console.log("");
  for (const result of results) console.log(`${result.status === "pass" ? "✓" : "✗"} ${result.id} (${result.seconds}s)`);
  const skipped = plan.gates.slice(results.length).map((gate) => gate.id);
  if (skipped.length > 0) console.log(`não rodaram: ${skipped.join(", ")}`);
  return results.every((result) => result.status === "pass") ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main(process.argv.slice(2), process.cwd());
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
