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
import { readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
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
 * Remoto legado (`<dir>/remotes/<nome>` com `Push:`, `<dir>/branches/<nome>`):
 * o git o lê fora da configuração, e o destino escapa da conferência. Pasta
 * ausente é a normal; qualquer entrada, ou erro que não seja ausência, conta.
 * @param {string[]} dirs
 */
function hasLegacyRemotes(dirs) {
  for (const dir of dirs) {
    for (const name of ["remotes", "branches"]) {
      try {
        if (readdirSync(join(dir, name)).length > 0) return true;
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") return true;
      }
    }
  }
  return false;
}

/**
 * Branches locais que são ref simbólica (`refs/heads/atalho` → `refs/heads/dev`):
 * empurrar `atalho` atualiza o destino do alvo, não `atalho`.
 * @param {(args: string[], ok?: number[]) => string} git
 */
function symbolicBranches(git) {
  const names = [];
  for (const line of git(["for-each-ref", "--format=%(refname)%00%(symref)", "refs/heads"]).split("\n")) {
    const [ref, target] = line.split("\0");
    if (ref?.startsWith("refs/heads/") && target) names.push(ref.slice("refs/heads/".length));
  }
  return names;
}

/**
 * O que o push leva, pela configuração: `safe` só quando o push sem refspec
 * leva o branch atual e nada mais (`push.default` de um branch, sem
 * `remote.*.push`, `remote.*.mirror`, `push.followTags` nem remoto legado em
 * `remotes/`/`branches/`) e o ref de acompanhamento do remoto tem o nome do
 * branch remoto (`fetch` padrão). `pushDefault` é o efetivo (`simple` sem
 * configuração): com `upstream`/`tracking`, o refspec sem `:` que nomeia um
 * branch vai para o upstream dele. `symrefs`: branches que são ref simbólica.
 * @param {(args: string[], ok?: number[]) => string} git
 * @param {string[]} gitDirs diretório comum e o da worktree
 * @returns {import("./shell-policy.mjs").PushInfo}
 */
function pushInfo(git, gitDirs) {
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
  if (hasLegacyRemotes(gitDirs)) safe = false;
  const remote = pushRef === null ? null : [...remotes].filter((name) => pushRef.startsWith(`refs/remotes/${name}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
  if (remote !== null) {
    const standard = `refs/heads/*:refs/remotes/${remote}/*`;
    const specs = fetches.get(remote) ?? [];
    if (specs.length === 0 || specs.some((spec) => spec.replace(/^\+/, "") !== standard)) safe = false;
  }
  return { safe, remote, pushRef: remote === null ? null : pushRef, pushDefault: pushDefault ?? "simple", symrefs: symbolicBranches(git) };
}

/**
 * Diretório em que o shell roda o comando quando a ferramenta recebe um
 * `workdir` (OpenCode, Codex): relativo vale sobre `base`. Com `..`, o
 * sistema sobe pelo caminho físico (depois de seguir link simbólico) e
 * `path.resolve` pelo texto, então o caminho é resolvido pelo próprio sistema
 * (`realpath` nativo); se não existe, `undefined` — sem diretório conferido.
 * @param {string | undefined} base
 * @param {unknown} workdir
 * @returns {string | undefined}
 */
export function workingDirectory(base, workdir) {
  if (typeof workdir !== "string" || workdir === "") return base;
  if (!isAbsolute(workdir) && (typeof base !== "string" || !isAbsolute(base))) return undefined;
  const joined = isAbsolute(workdir) ? workdir : `${base}/${workdir}`;
  if (!joined.split("/").includes("..")) return resolve(joined);
  try {
    return realpathSync.native(joined);
  } catch {
    return undefined;
  }
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
    // `..` no diretório atual: `resolve` sobe pelo texto, o sistema pelo caminho físico.
    if (cwd.split("/").includes("..")) return null;
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

    // `--symbolic-full-name`, não `--abbrev-ref`: com uma tag `dev`, o abreviado
    // vira `heads/dev` e escaparia da comparação com as branches protegidas.
    const [toplevel, commonDir, gitDir, head] = git([
      "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--absolute-git-dir", "--symbolic-full-name", "HEAD",
    ]).split("\n");
    if (!toplevel || !commonDir || !gitDir || !head) return null;
    const branch = head.startsWith("refs/heads/") && head.length > "refs/heads/".length ? head.slice("refs/heads/".length) : "HEAD";

    // A primeira entrada é a checkout principal; as outras, as registradas.
    const worktrees = git(["worktree", "list", "--porcelain", "-z"])
      .split("\0")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => real(line.slice("worktree ".length)));
    const top = real(toplevel);
    const isMainWorktree = worktrees.length === 0 || worktrees[0] === top || !worktrees.slice(1).includes(top) || real(gitDir) === real(commonDir);

    return { command, cwd, dir, branch, isMainWorktree, push: probe.sub === "push" ? pushInfo(git, [commonDir, gitDir]) : null };
  } catch {
    return null;
  }
}
