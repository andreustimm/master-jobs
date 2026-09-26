// `pnpm gates [--base <ref>] [--plan] [--fresh] [--paths <caminho>…]`
//
// Roda os gates locais que o diff exige, na ordem de `config/validation-impact.json`
// (G57, #320). Sem `--paths`, o diff é tudo o que difere da base de mesclagem
// com `--base` (padrão `origin/dev`): commits da branch, índice, árvore de
// trabalho e arquivos novos não ignorados. `--plan` só imprime o plano em JSON.
// Para no primeiro gate vermelho. Base que não resolve falha fechado.
//
// Gate que já passou neste mesmo estado (HEAD, árvore e mapa) e dentro do
// prazo não roda de novo: o recibo mora no diretório Git da worktree, fora da
// árvore versionada. `--fresh` ignora o recibo (e grava um novo).
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planGates, renderPlan, testsMentioning, validateImpactMap, type ImpactMap, type Plan, type PlannedGate } from "./impact.ts";
import { covers, fingerprintOf, readReceipt, recordFail, recordPass, sha256, treeHash, type Fingerprint, type Receipt, type TreeEntry } from "./receipt.ts";
import { selectE2E, validateE2EMap, type E2EMap, type Selection } from "./e2e-selection.ts";

export const IMPACT_FILE = "config/validation-impact.json";
export const E2E_MAP_FILE = "config/e2e-spec-map.json";
export const DEFAULT_BASE = "origin/dev";
/** Relativo ao diretório Git da worktree (`git rev-parse --git-path`). */
export const RECEIPT_GIT_PATH = "jho-gates/receipt.json";

export type Args = { base: string; plan: boolean; fresh: boolean; paths: string[] | null };

const USAGE = "uso: pnpm gates [--base <ref>] [--plan] [--fresh] [--paths <caminho>…]";

export function loadImpactMap(root: string): ImpactMap {
  return validateImpactMap(JSON.parse(readFileSync(resolve(root, IMPACT_FILE), "utf8")));
}

export function loadE2EMap(root: string): E2EMap {
  return validateE2EMap(JSON.parse(readFileSync(resolve(root, E2E_MAP_FILE), "utf8")));
}

/** A seleção de E2E de um gate com `e2eAreas`; `null` para os outros gates. */
export function e2eSelectionFor(gate: PlannedGate, root: string): Selection | null {
  return gate.e2eAreas ? selectE2E(loadE2EMap(root), gate.files) : null;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { base: DEFAULT_BASE, plan: false, fresh: false, paths: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--plan") args.plan = true;
    else if (arg === "--fresh") args.fresh = true;
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

/** O que difere de HEAD, como o disco tem agora: conteúdo, bit executável, symlink, remoção. */
export function treeEntries(root: string): TreeEntry[] {
  const changed = nulList(git(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"]));
  const untracked = nulList(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  return [...new Set([...changed, ...untracked])].map((path): TreeEntry => {
    const absolute = resolve(root, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, kind: "deleted", content: "" };
      throw error;
    }
    if (stat.isSymbolicLink()) return { path, kind: "symlink", content: readlinkSync(absolute) };
    if (stat.isFile()) return { path, kind: stat.mode & 0o111 ? "executable" : "file", content: readFileSync(absolute) };
    return { path, kind: "other", content: String(stat.mode) };
  });
}

export function currentFingerprint(root: string, map: ImpactMap): Fingerprint {
  return fingerprintOf({
    head: git(root, ["rev-parse", "HEAD"]).trim(),
    tree: treeHash(treeEntries(root)),
    mapVersion: map.mapVersion,
    mapChecksum: sha256(readFileSync(resolve(root, IMPACT_FILE))),
  });
}

export function receiptFile(root: string): string {
  return resolve(root, git(root, ["rev-parse", "--git-path", RECEIPT_GIT_PATH]).trim());
}

/** Recibo ilegível conta como ausente, e o motivo aparece na saída. */
export function loadReceipt(file: string, fingerprint: Fingerprint): { receipt: Receipt | null; reason: string | null } {
  if (!existsSync(file)) return { receipt: null, reason: "sem recibo" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { receipt: null, reason: "recibo ilegível" };
  }
  const read = readReceipt(raw, fingerprint);
  return "receipt" in read ? { receipt: read.receipt, reason: null } : { receipt: null, reason: read.reason };
}

function saveReceipt(file: string, receipt: Receipt): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
}

function testSources(root: string): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const file of nulList(git(root, ["ls-files", "-z", "--", "tests"]))) {
    if (file.endsWith(".test.ts") && existsSync(resolve(root, file))) sources[file] = readFileSync(resolve(root, file), "utf8");
  }
  return sources;
}

/**
 * O comando final de um gate. O E2E recebe as áreas que os arquivos pedem, ou
 * roda inteiro quando algum é transversal ou não mapeado. O que recebe
 * arquivos leva os que existem e os testes que os citam; se nenhum existe (o
 * diff só apagou), roda a suíte inteira — apagar não pode virar "nenhum teste".
 */
export function commandFor(gate: PlannedGate, root: string, map: ImpactMap): string[] {
  const selection = e2eSelectionFor(gate, root);
  if (selection !== null) {
    return selection.mode === "affected" ? [...gate.command, "--areas", selection.areas.join(",")] : gate.command;
  }
  if (!gate.appendFiles) return gate.command;
  const present = gate.files.filter((file) => existsSync(resolve(root, file)));
  if (present.length === 0) return map.gates.tests?.command ?? gate.command;
  const mentioned = testsMentioning(testSources(root), present);
  return [...gate.command, ...new Set([...present, ...mentioned])];
}

export type GateResult = { id: string; status: "pass" | "fail" | "receipt"; seconds: number };

export type RunDeps = {
  /** Executa o comando e devolve o código de saída. */
  exec: (command: string[]) => number;
  now: () => number;
  /** Fingerprint do estado atual, recalculado depois de cada gate. */
  fingerprint: () => Fingerprint;
  receipt: Receipt | null;
  save: (receipt: Receipt) => void;
  log: (line: string) => void;
};

/**
 * Roda o plano. Gate coberto pelo recibo é pulado; gate verde é registrado com
 * o fingerprint tirado ANTES dele, e só se o estado não mudou durante a
 * execução — um gate que reescreveu a árvore não pode aprovar o que não viu.
 */
export function runPlan(plan: Plan, commands: (gate: PlannedGate) => string[], deps: RunDeps): GateResult[] {
  const results: GateResult[] = [];
  let receipt = deps.receipt;
  for (const gate of plan.gates) {
    const before = deps.fingerprint();
    const command = commands(gate);
    if (receipt !== null && receipt.fingerprint === before.value && covers(receipt, gate.id, command, deps.now())) {
      deps.log(`↺ ${gate.id}: já verde neste estado (${receipt.gates[gate.id]!.at})`);
      results.push({ id: gate.id, status: "receipt", seconds: 0 });
      continue;
    }
    deps.log(`\n▶ ${gate.id}: ${command.join(" ")}`);
    const started = deps.now();
    const code = deps.exec(command);
    const seconds = Math.round((deps.now() - started) / 1000);
    if (code !== 0) {
      results.push({ id: gate.id, status: "fail", seconds });
      receipt = recordFail(receipt, before, gate.id);
      deps.save(receipt);
      break;
    }
    results.push({ id: gate.id, status: "pass", seconds });
    const after = deps.fingerprint();
    if (after.value !== before.value) {
      deps.log(`! ${gate.id} passou, mas a árvore mudou durante a execução: recibo não gravado`);
      continue;
    }
    receipt = recordPass(receipt, before, gate.id, command, seconds, deps.now());
    deps.save(receipt);
  }
  return results;
}

export function main(argv: readonly string[], root: string): number {
  const args = parseArgs(argv);
  const map = loadImpactMap(root);
  const plan = planGates(map, args.paths ?? changedPaths(root, args.base));
  const fingerprint = currentFingerprint(root, map);
  const file = receiptFile(root);
  const loaded = args.fresh ? { receipt: null, reason: "--fresh" } : loadReceipt(file, fingerprint);
  if (args.plan) {
    const now = Date.now();
    const covered = plan.gates
      .filter((gate) => covers(loaded.receipt, gate.id, commandFor(gate, root, map), now))
      .map((gate) => gate.id);
    const e2e = plan.gates.map((gate) => e2eSelectionFor(gate, root)).find((selection) => selection !== null) ?? null;
    console.log(JSON.stringify({ ...plan, e2e, fingerprint: fingerprint.value, receipt: { covered, reason: loaded.reason } }, null, 2));
    return 0;
  }
  console.log(renderPlan(plan));
  for (const gate of plan.gates) {
    const selection = e2eSelectionFor(gate, root);
    if (selection?.mode === "affected") console.log(`E2E seletivo: fumaça + ${selection.areas.join(", ")}`);
    if (selection?.mode === "full") {
      console.log(`E2E inteiro: ${selection.escalations.map((item) => `${item.path} (${item.reason})`).join("; ")}`);
    }
  }
  if (loaded.reason !== null && plan.gates.length > 0) console.log(`recibo: ${loaded.reason} — todos os gates rodam`);
  const results = runPlan(plan, (gate) => commandFor(gate, root, map), {
    exec: ([command, ...rest]) => spawnSync(command!, rest, { cwd: root, stdio: "inherit" }).status ?? 1,
    now: Date.now,
    fingerprint: () => currentFingerprint(root, map),
    receipt: loaded.receipt,
    save: (receipt) => saveReceipt(file, receipt),
    log: (line) => console.log(line),
  });
  console.log("");
  const mark = { pass: "✓", fail: "✗", receipt: "↺" } as const;
  for (const result of results) console.log(`${mark[result.status]} ${result.id} (${result.status === "receipt" ? "recibo" : `${result.seconds}s`})`);
  const skipped = plan.gates.slice(results.length).map((gate) => gate.id);
  if (skipped.length > 0) console.log(`não rodaram: ${skipped.join(", ")}`);
  return results.every((result) => result.status !== "fail") ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main(process.argv.slice(2), process.cwd());
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
