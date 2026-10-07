// Contexto real de um comando `git` (#476), para a política de shell.
//
// A política (`shell-policy.mjs`) é pura e não vê o disco, e olhar só o
// caminho (`.claude/worktrees/<nome>`) não basta: um diretório comum ali
// dentro sobe até a checkout principal e empurra `dev`, e configuração
// persistida muda o destino do push. Este módulo, impuro, pergunta ao próprio
// git onde o comando roda — checkout principal ou worktree registrada, em que
// branch — e, no push, para onde ele iria. Os três chamadores (hook do Claude
// Code, guarda do Codex, plugin do OpenCode) passam o resultado em
// `env.gitTarget`, e a política decide.
//
// Falha fecha: comando fora da forma simples (`plainGitCommand`), erro do git
// ou estouro do tempo devolvem `null`, e o git volta a ser julgado só pelo
// texto — o push sem refspec, o forçado e o que descarta trabalho perguntam.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { plainGitCommand } from "./shell-policy.mjs";

/** Teto do conjunto de chamadas ao git, bem abaixo do tempo-limite do hook. */
export const GIT_TARGET_TIMEOUT_MS = 1500;

/** Subcomandos cuja decisão depende do contexto: os outros nem chamam o git. */
const CONTEXT_SUBCOMMANDS = new Set(["push", "reset", "clean", "checkout", "switch", "restore", "rm", "commit"]);

/**
 * Variáveis que apontam outro repositório ou injetam configuração: com elas
 * no ambiente do hook, o que ele resolve pode não ser o que o shell roda.
 */
const REDIRECTING_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"];
/** `push.default` em que o push sem refspec leva só o branch atual. */
const SINGLE_BRANCH_DEFAULTS = new Set(["simple", "current", "upstream", "tracking"]);
const FALSE_VALUES = new Set(["false", "no", "off", "0"]);

function real(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Entradas de `git config -z --get-regexp`: `chave\nvalor\0` (ou `chave\0` sem valor). */
function parseConfig(output) {
  const entries = [];
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const newline = record.indexOf("\n");
    entries.push(newline === -1 ? { key: record, value: null } : { key: record.slice(0, newline), value: record.slice(newline + 1) });
  }
  return entries;
}

const truthy = (value) => value === null || !FALSE_VALUES.has(value.toLowerCase());

/**
 * O que o push leva, pela configuração: `safe` só quando o push sem refspec
 * leva o branch atual e nada mais (`push.default` de um branch, sem
 * `remote.*.push`, `remote.*.mirror` nem `push.followTags`) e o ref de
 * acompanhamento do remoto tem o nome do branch remoto (`fetch` padrão).
 * @param {(args: string[], ok?: number[]) => string} git
 * @returns {import("./shell-policy.mjs").PushInfo}
 */
function pushInfo(git) {
  let pushRef = null;
  try {
    pushRef = git(["rev-parse", "--symbolic-full-name", "@{push}"]).trim() || null;
  } catch {
    pushRef = null;
  }
  const config = parseConfig(git(["config", "-z", "--get-regexp", "^(push|remote)\\."], [0, 1]));
  let safe = true;
  let pushDefault = null;
  const remotes = new Set();
  const fetches = new Map();
  for (const { key, value } of config) {
    const lower = key.toLowerCase();
    if (lower === "push.default") pushDefault = (value ?? "").toLowerCase();
    else if (lower === "push.followtags" && truthy(value)) safe = false;
    else if (lower.startsWith("remote.")) {
      const last = key.lastIndexOf(".");
      const name = key.slice("remote.".length, last);
      const variable = lower.slice(last + 1);
      if (name === "") continue;
      if (variable === "push") safe = false;
      if (variable === "mirror" && truthy(value)) safe = false;
      remotes.add(name);
      if (variable === "fetch") fetches.set(name, [...(fetches.get(name) ?? []), value ?? ""]);
    }
  }
  if (pushDefault !== null && !SINGLE_BRANCH_DEFAULTS.has(pushDefault)) safe = false;
  const remote = pushRef === null ? null : [...remotes].filter((name) => pushRef.startsWith(`refs/remotes/${name}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
  if (remote !== null) {
    const standard = `refs/heads/*:refs/remotes/${remote}/*`;
    const specs = fetches.get(remote) ?? [];
    if (specs.length === 0 || specs.some((spec) => spec.replace(/^\+/, "") !== standard)) safe = false;
  }
  return { safe, remote, pushRef: remote === null ? null : pushRef };
}

/**
 * Para um comando `git` na forma de `plainGitCommand` cujo subcomando depende
 * do contexto: diretório efetivo (`-C` encadeado sobre o `cwd`), branch atual,
 * se o diretório é a checkout principal (ou não é worktree registrada) e, no
 * push, `@{push}` e a segurança da configuração. `null` quando não se aplica
 * ou qualquer passo falha.
 * @param {string} command
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {import("./shell-policy.mjs").GitTarget | null}
 */
export function resolveGitTarget(command, { cwd, env = process.env, timeoutMs = GIT_TARGET_TIMEOUT_MS } = {}) {
  try {
    if (typeof command !== "string" || typeof cwd !== "string" || !isAbsolute(cwd)) return null;
    const probe = plainGitCommand(command);
    if (!probe || !CONTEXT_SUBCOMMANDS.has(probe.sub)) return null;
    if (REDIRECTING_ENV.some((name) => env[name] !== undefined && env[name] !== "")) return null;
    const dir = resolve(cwd, ...probe.chain);
    const deadline = Date.now() + timeoutMs;
    /** @param {string[]} args @param {number[]} [ok] */
    const git = (args, ok = [0]) => {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("tempo esgotado");
      const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env, timeout: left, stdio: ["ignore", "pipe", "ignore"] });
      if (result.error || result.signal || !ok.includes(result.status ?? -1)) throw new Error(`git ${args[0]} falhou`);
      return result.stdout;
    };

    const [toplevel, commonDir, gitDir, branch] = git([
      "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--absolute-git-dir", "--abbrev-ref", "HEAD",
    ]).split("\n");
    if (!toplevel || !commonDir || !gitDir || !branch) return null;

    // A primeira entrada é a checkout principal; as outras, as registradas.
    const worktrees = git(["worktree", "list", "--porcelain", "-z"])
      .split("\0")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => real(line.slice("worktree ".length)));
    const top = real(toplevel);
    const isMainWorktree = worktrees.length === 0 || worktrees[0] === top || !worktrees.slice(1).includes(top) || real(gitDir) === real(commonDir);

    return { command, cwd, dir, branch, isMainWorktree, push: probe.sub === "push" ? pushInfo(git) : null };
  } catch {
    return null;
  }
}
