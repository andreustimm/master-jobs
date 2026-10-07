// Suite: git liberado em worktree de trabalho, com o contexto real (#476)
// Invariant: o comando `git` simples numa worktree registrada diferente da
//   checkout principal, fora de branch protegida, passa sem pergunta — push
//   sem refspec, forçado, `--delete` de branch de trabalho, `reset --hard`,
//   `clean`, `checkout` com descarte. Continuam perguntando ou negando: push
//   cujo destino real é `main`/`staging`/`dev` (destino não resolvido conta
//   como protegido), descarte na checkout principal (G44) e segredo. Os quatro
//   Critical da primeira versão (diretório comum sob `.claude/worktrees/`,
//   `--git-dir`/`GIT_DIR=`, `-c push.*`/`remote.*`, `env -C`/`sh -c`)
//   perguntam. Os três chamadores dão a mesma decisão.
// Boundary IN: `.claude/hooks/push-target.mjs` sobre um repositório git
//   descartável de verdade (remoto bare com main, staging e dev; worktrees
//   criadas de `origin/dev`), a política `.claude/hooks/shell-policy.mjs` e
//   os chamadores — hook do Claude Code, guarda do Codex e plugin do OpenCode
//   — sobre o `.claude/settings.json` real
// Boundary OUT: os binários do Claude Code, do Codex e do OpenCode
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hookOutcome } from "../.claude/hooks/no-compound-bash.mjs";
import { resolveGitTarget } from "../.claude/hooks/push-target.mjs";
import { bashRulesFromSettings, judgeShell } from "../.claude/hooks/shell-policy.mjs";
import { ShellGuard } from "../.opencode/plugins/shell-guard.js";
import { judge } from "../scripts/harness/codex-guard.ts";
import { parseRules, type ClaudePermissions } from "../scripts/harness/permissions.ts";

const SETTINGS = JSON.parse(readFileSync(".claude/settings.json", "utf8")) as { permissions: ClaudePermissions };
const CLAUDE_RULES = bashRulesFromSettings(SETTINGS);
const CODEX_RULES = parseRules(SETTINGS.permissions);

/** Variáveis que redirecionam o git: um hook do git rodando a suíte as deixa no ambiente. */
const GIT_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_INDEX_FILE"];
const saved = new Map<string, string | undefined>();

let base = "";
let remote = "";
let root = "";
let home = "";
/** Worktree de trabalho em `feat/x`, com upstream `origin/feat/x`. */
let wt = "";
/** Worktree em `feat/up`, com upstream `origin/dev` (o padrão de `worktree add -b … origin/dev`). */
let wtUp = "";
/** Worktree em `dev` (criada com `--force`). */
let wtDev = "";
/** Diretório comum sob `.claude/worktrees/`: sobe até a checkout principal. */
let plainDir = "";
/** Link simbólico para a checkout principal com nome de worktree. */
let link = "";

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function remoteRef(branch: string): string {
  return git(remote, "rev-parse", `refs/heads/${branch}`);
}

/** Destinos que o git de verdade empurraria (`--dry-run --porcelain`). */
function dryRun(cwd: string, args: string[], env: Record<string, string> = {}): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return `${result.stdout}${result.stderr}`;
}

type Outcome = "pass" | "ask" | "deny";

function claude(command: string, cwd: string): Outcome {
  const outcome = hookOutcome(command, CLAUDE_RULES, { root, cwd, home });
  if (outcome.exit === 2) return "deny";
  if (!outcome.stdout) return "pass";
  return JSON.parse(outcome.stdout).hookSpecificOutput.permissionDecision as Outcome;
}

function codex(command: string, cwd: string): Outcome {
  const verdict = judge({ tool_name: "Bash", tool_input: { command }, cwd }, CODEX_RULES, { root, home });
  if (verdict.decision === "allow") return "pass";
  return verdict.decision === "deny" && !verdict.message?.includes("(ask)") ? "deny" : "ask";
}

async function openCode(command: string, cwd: string): Promise<Outcome> {
  const plugin = await ShellGuard({ directory: cwd, worktree: root });
  try {
    await plugin["tool.execute.before"]({ tool: "bash" }, { args: { command } });
    return "pass";
  } catch (error) {
    return (error as Error).message.startsWith("Proibido") || (error as Error).message.startsWith("Comando composto") ? "deny" : "ask";
  }
}

async function decisions(command: string, cwd: string): Promise<Outcome[]> {
  return [claude(command, cwd), codex(command, cwd), await openCode(command, cwd)];
}

beforeAll(() => {
  for (const name of [...GIT_ENV, "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"]) saved.set(name, process.env[name]);
  for (const name of GIT_ENV) delete process.env[name];
  // Repositório hermético: nada da configuração pessoal muda o destino.
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  base = realpathSync(mkdtempSync(join(tmpdir(), "jho-git-target-")));
  home = join(base, "home");
  mkdirSync(home);
  remote = join(base, "remote.git");
  root = join(base, "repo");
  git(base, "init", "--bare", "-b", "main", remote);
  git(base, "init", "-b", "main", root);
  git(root, "config", "user.email", "teste@example.com");
  git(root, "config", "user.name", "Teste");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", "a.txt");
  git(root, "commit", "-m", "início");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "origin", "main");
  git(root, "push", "origin", "main:staging", "main:dev");
  git(root, "fetch", "origin");
  git(root, "switch", "-c", "dev", "--track", "origin/dev");

  wt = join(root, ".claude/worktrees/feat-x");
  git(root, "worktree", "add", "-b", "feat/x", wt, "origin/dev");
  git(wt, "push", "-u", "origin", "feat/x");
  git(wt, "push", "origin", "feat/x:feat/velha");
  wtUp = join(root, ".claude/worktrees/feat-up");
  git(root, "worktree", "add", "-b", "feat/up", wtUp, "origin/dev");
  wtDev = join(root, ".claude/worktrees/em-dev");
  git(root, "worktree", "add", "--force", wtDev, "dev");
  plainDir = join(root, ".claude/worktrees/node_modules");
  mkdirSync(plainDir, { recursive: true });
  link = join(root, ".claude/worktrees/atalho");
  symlinkSync(root, link);
});

afterAll(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (base) rmSync(base, { recursive: true, force: true });
});

describe("resolveGitTarget: o contexto vem do próprio git", () => {
  it("worktree de trabalho: branch, @{push} e configuração segura", () => {
    const target = resolveGitTarget(`git -C ${wt} push`, { cwd: root });
    expect(target).toMatchObject({
      dir: wt,
      branch: "feat/x",
      isMainWorktree: false,
      push: { safe: true, remote: "origin", pushRef: "refs/remotes/origin/feat/x" },
    });
  });

  it("checkout principal e diretório comum sob `.claude/worktrees/` são a principal", () => {
    expect(resolveGitTarget("git push", { cwd: root })).toMatchObject({ branch: "dev", isMainWorktree: true });
    expect(resolveGitTarget(`git -C ${plainDir} push`, { cwd: root })).toMatchObject({ branch: "dev", isMainWorktree: true });
    expect(resolveGitTarget(`git -C ${link} push`, { cwd: root })).toMatchObject({ branch: "dev", isMainWorktree: true });
    expect(resolveGitTarget("git push", { cwd: join(wt, "..", "..", "..") })).toMatchObject({ isMainWorktree: true });
  });

  it("upstream em origin/dev com push.default simple: @{push} não resolve", () => {
    expect(resolveGitTarget("git push", { cwd: wtUp })?.push).toMatchObject({ pushRef: null, remote: null });
  });

  it("forma fora da lista, ambiente que redireciona o git, tempo esgotado ou subcomando que não precisa: null", () => {
    expect(resolveGitTarget(`git --git-dir=${root}/.git -C ${wt} push`, { cwd: root })).toBeNull();
    expect(resolveGitTarget(`git -c push.default=upstream -C ${wt} push`, { cwd: root })).toBeNull();
    expect(resolveGitTarget(`GIT_DIR=${root}/.git git push`, { cwd: wt })).toBeNull();
    expect(resolveGitTarget(`env -C ${root} git push`, { cwd: wt })).toBeNull();
    expect(resolveGitTarget("git -C $X push", { cwd: wt })).toBeNull();
    expect(resolveGitTarget("git push", { cwd: wt, env: { ...process.env, GIT_DIR: `${root}/.git` } })).toBeNull();
    expect(resolveGitTarget("git push", { cwd: wt, timeoutMs: 0 })).toBeNull();
    expect(resolveGitTarget("git status", { cwd: wt })).toBeNull();
    expect(resolveGitTarget("git push", { cwd: join(base, "nao-existe") })).toBeNull();
  });

  it("configuração que leva mais que o branch atual marca o push como inseguro", () => {
    const settings: Array<[string, string]> = [
      ["push.default", "matching"],
      ["remote.origin.push", "refs/heads/*:refs/heads/*"],
      ["remote.origin.mirror", "true"],
      ["push.followTags", "true"],
      ["remote.origin.fetch", "+refs/heads/dev:refs/remotes/origin/feat/x"],
    ];
    for (const [key, value] of settings) {
      git(root, "config", "--add", key, value);
      try {
        expect(resolveGitTarget("git push", { cwd: wt })?.push?.safe, key).toBe(false);
      } finally {
        if (key === "remote.origin.fetch") git(root, "config", "--fixed-value", "--unset", key, value);
        else git(root, "config", "--unset-all", key);
      }
    }
    expect(resolveGitTarget("git push", { cwd: wt })?.push?.safe).toBe(true);
  });
});

describe("os quatro Critical da primeira versão: o git de verdade empurraria branch protegida", () => {
  it("cada forma vai para dev ou main no dry-run real", () => {
    expect(dryRun(root, ["-C", plainDir, "push", "--dry-run", "--porcelain"])).toContain("refs/heads/dev:refs/heads/dev");
    expect(dryRun(wt, ["--git-dir", `${root}/.git`, "push", "--dry-run", "--porcelain"])).toContain("refs/heads/dev:refs/heads/dev");
    expect(dryRun(wt, ["push", "--dry-run", "--porcelain"], { GIT_DIR: `${root}/.git` })).toContain("refs/heads/dev:refs/heads/dev");
    expect(dryRun(root, ["-c", "push.default=upstream", "-C", wtUp, "push", "--dry-run", "--porcelain"])).toContain("refs/heads/feat/up:refs/heads/dev");
    expect(dryRun(root, ["-c", "remote.origin.push=HEAD:main", "-C", wt, "push", "--dry-run", "--porcelain"])).toContain(":refs/heads/main");
  });
});

describe("os três chamadores dão a mesma decisão", () => {
  const cases: Array<[string, () => string, () => string, Outcome]> = [
    // Worktree de trabalho: git liberado, inclusive o destrutivo.
    ["push sem refspec por -C", () => `git -C ${wt} push`, () => root, "pass"],
    ["push sem refspec no diretório atual", () => "git push", () => wt, "pass"],
    ["push sem refspec com rtk", () => "rtk git push", () => wt, "pass"],
    ["push -u com o remoto", () => "git push -u origin", () => wt, "pass"],
    ["push forçado sem refspec", () => `git -C ${wt} push --force`, () => root, "pass"],
    ["push forçado com refspec de trabalho", () => "git push -f origin feat/x", () => wt, "pass"],
    ["push +refspec de trabalho", () => "git push origin +feat/x", () => wt, "pass"],
    ["push HEAD vai para o branch atual", () => "git push origin HEAD", () => wt, "pass"],
    ["push --no-verify", () => "git push --no-verify", () => wt, "pass"],
    ["push --delete de branch de trabalho", () => "git push origin --delete feat/velha", () => wt, "pass"],
    ["reset --hard", () => `git -C ${wt} reset --hard origin/dev`, () => root, "pass"],
    ["clean -fdx", () => "git clean -fdx", () => wt, "pass"],
    ["checkout -- caminho", () => "git checkout -- a.txt", () => wt, "pass"],
    ["checkout -f", () => "git checkout -f", () => wt, "pass"],
    ["checkout -B de trabalho", () => "git checkout -B feat/x", () => wt, "pass"],
    ["switch --discard-changes", () => "git switch --discard-changes feat/x", () => wt, "pass"],
    ["restore", () => "git restore a.txt", () => wt, "pass"],
    ["rm -rf", () => "git rm -rf a.txt", () => wt, "pass"],
    ["commit --no-verify", () => "git commit --no-verify -m x", () => wt, "pass"],
    ["rebase", () => "git rebase origin/dev", () => wt, "pass"],
    ["branch -D de trabalho", () => "git branch -D feat/velha", () => wt, "pass"],
    // Refspec sem `:` que não é o branch atual: o git o resolve localmente
    // (ref simbólica, upstream), então o destino forçado não é conhecido.
    ["push forçado de outro branch a partir da principal", () => "git push --force origin feat/x", () => root, "ask"],
    // Rodada 1 da L2: ref simbólica, link com `..`, tag forçada, worktree alheia.
    ["push forçado de main-worktree/HEAD", () => "git push -f origin main-worktree/HEAD", () => wt, "ask"],
    ["push de worktrees/<n>/HEAD", () => "git push origin worktrees/em-dev/HEAD", () => wt, "ask"],
    ["reset --hard por -C com link e ..", () => `git -C ${link}/sub/.. reset --hard`, () => wt, "ask"],
    ["push -f --tags", () => "git push -f --tags", () => wt, "ask"],
    ["push -f de tag por nome", () => "git push -f origin tag v1.0.0", () => wt, "ask"],
    ["push -f de refs/tags", () => "git push -f origin refs/tags/v1.0.0", () => wt, "ask"],
    ["switch --ignore-other-worktrees para dev", () => "git switch --ignore-other-worktrees dev", () => wt, "ask"],
    // Destino real protegido: nega ou pergunta.
    ["push forçado para dev", () => "git push --force origin dev", () => wt, "deny"],
    ["push HEAD:main", () => "git push origin HEAD:main", () => wt, "deny"],
    ["push HEAD numa worktree em dev", () => "git push origin HEAD", () => wtDev, "deny"],
    ["push sem refspec na checkout principal (dev)", () => "git push", () => root, "ask"],
    ["push sem refspec numa worktree em dev", () => `git -C ${wtDev} push`, () => root, "ask"],
    ["push forçado sem refspec numa worktree em dev", () => `git -C ${wtDev} push --force`, () => root, "ask"],
    ["push sem refspec com upstream origin/dev", () => "git push", () => wtUp, "ask"],
    ["push --all", () => "git push --all", () => wt, "ask"],
    ["push --mirror", () => "git push --mirror", () => wt, "ask"],
    ["push --prune", () => "git push --prune origin feat/x", () => wt, "ask"],
    ["push matching (:)", () => "git push origin :", () => wt, "ask"],
    ["push matching forçado (+:)", () => "git push origin +:", () => wt, "ask"],
    ["push matching na principal", () => "git push origin :", () => root, "ask"],
    ["push apaga tag",() => "git push origin :refs/tags/v1.0.0", () => wt, "ask"],
    ["push para outro remoto escrito", () => "git push upstream", () => wt, "ask"],
    // Critical 1: diretório comum sob `.claude/worktrees/` e atalhos para a principal.
    ["push em diretório comum sob .claude/worktrees", () => `git -C ${plainDir} push`, () => root, "ask"],
    ["push pelo link simbólico para a principal", () => `git -C ${link} push`, () => root, "ask"],
    ["push com .. até a principal", () => `git -C ${wt}/../../.. push`, () => root, "ask"],
    // Critical 2: `--git-dir` e `GIT_DIR=` apontando a principal.
    ["--git-dir para a principal", () => `git --git-dir=${root}/.git push`, () => wt, "ask"],
    ["--git-dir separado para a principal", () => `git --git-dir ${root}/.git -C ${wt} push`, () => root, "ask"],
    ["GIT_DIR= para a principal", () => `GIT_DIR=${root}/.git git push`, () => wt, "ask"],
    // Critical 3: configuração na linha de comando.
    ["-c push.default=upstream com upstream origin/dev", () => `git -c push.default=upstream -C ${wtUp} push`, () => root, "ask"],
    ["-c remote.origin.push=HEAD:main", () => `git -c remote.origin.push=HEAD:main -C ${wt} push`, () => root, "ask"],
    ["--config-env", () => `git --config-env=push.default=X -C ${wt} push`, () => root, "ask"],
    // Critical 4: diretório trocado por invólucro ou shell aninhado.
    ["env -C para a principal", () => `env -C ${root} git push`, () => wt, "ask"],
    ["env --chdir para a principal", () => `env --chdir=${root} git push`, () => wt, "ask"],
    ["sh -c com cd para a principal", () => `sh -c "cd ${root} && git push"`, () => wt, "ask"],
    ["bash -c com git -C", () => `bash -c "git -C ${root} push"`, () => wt, "ask"],
    ["find -exec", () => `find . -maxdepth 0 -exec git -C ${wt} push \\;`, () => wt, "ask"],
    // Descarte na checkout principal (G44) e em worktree em dev.
    ["reset --hard na principal", () => "git reset --hard", () => root, "ask"],
    ["reset --hard na principal por -C", () => `git -C ${root} reset --hard`, () => wt, "ask"],
    ["reset --hard no diretório comum sob .claude/worktrees", () => `git -C ${plainDir} reset --hard`, () => root, "ask"],
    ["clean na principal", () => "git clean -fd", () => root, "ask"],
    ["checkout -- caminho na principal", () => "git checkout -- a.txt", () => root, "ask"],
    ["checkout -f na principal", () => "git checkout -f", () => root, "ask"],
    ["reset --hard numa worktree em dev", () => "git reset --hard", () => wtDev, "ask"],
    ["reset --hard por sh -c", () => `sh -c "git -C ${wt} reset --hard"`, () => root, "ask"],
    // O stash é comum às worktrees: apagar pergunta em qualquer lugar.
    ["stash drop na worktree", () => "git stash drop", () => wt, "ask"],
    // Segredo continua negado.
    ["segredo", () => "git add .env", () => wt, "deny"],
  ];

  it.each(cases)("%s", async (_name, command, cwd, expected) => {
    expect(await decisions(command(), cwd())).toEqual([expected, expected, expected]);
  });

  it("workdir do Codex e do OpenCode decide o diretório", async () => {
    const codexAt = (workdir: string) => judge({ tool_name: "Bash", tool_input: { command: "git reset --hard", workdir }, cwd: wt }, CODEX_RULES, { root, home });
    expect(codexAt(root).decision).not.toBe("allow");
    expect(codexAt(wt).decision).toBe("allow");
    const plugin = await ShellGuard({ directory: wt, worktree: root });
    await expect(plugin["tool.execute.before"]({ tool: "bash" }, { args: { command: "git reset --hard", workdir: root } })).rejects.toThrow();
    await expect(plugin["tool.execute.before"]({ tool: "bash" }, { args: { command: "git reset --hard", workdir: wt } })).resolves.toBeUndefined();
  });

  it("tag local com nome de branch protegida não faz a worktree em dev virar de trabalho", () => {
    git(root, "tag", "dev");
    try {
      expect(claude("git reset --hard", wtDev)).toBe("ask");
    } finally {
      git(root, "tag", "-d", "dev");
    }
  });

  it("remoto legado em .git/remotes torna o push inseguro", () => {
    mkdirSync(join(root, ".git/remotes"), { recursive: true });
    writeFileSync(join(root, ".git/remotes/up"), "URL: x\nPush: refs/heads/dev:refs/heads/dev\n");
    try {
      expect(resolveGitTarget("git push", { cwd: wt })?.push?.safe).toBe(false);
    } finally {
      rmSync(join(root, ".git/remotes"), { recursive: true, force: true });
    }
  });

  it("contexto de outro comando ou de outro diretório não vale", () => {
    const forged = resolveGitTarget(`git -C ${wt} push`, { cwd: root });
    expect(forged).not.toBeNull();
    expect(judgeShell("git push", CLAUDE_RULES, { root, cwd: root, home, gitTarget: forged })?.decision).toBe("ask");
    expect(judgeShell(`git -C ${wt} push`, CLAUDE_RULES, { root, cwd: wt, home, gitTarget: forged })?.decision).toBe("ask");
    expect(judgeShell(`git -C ${wt} push`, CLAUDE_RULES, { root, cwd: root, home, gitTarget: forged })).toBeNull();
  });
});

describe("o push liberado vai mesmo para o branch de trabalho", () => {
  it("git -C <wt> push atualiza origin/feat/x e não toca dev, staging nem main", async () => {
    const before = { dev: remoteRef("dev"), staging: remoteRef("staging"), main: remoteRef("main") };
    writeFileSync(join(wt, "b.txt"), "b\n");
    git(wt, "add", "b.txt");
    git(wt, "-c", "user.email=teste@example.com", "-c", "user.name=Teste", "commit", "-m", "trabalho");
    const command = `git -C ${wt} push`;
    expect(await decisions(command, root)).toEqual(["pass", "pass", "pass"]);
    git(root, "-C", wt, "push");
    expect(remoteRef("feat/x")).toBe(git(wt, "rev-parse", "HEAD"));
    expect({ dev: remoteRef("dev"), staging: remoteRef("staging"), main: remoteRef("main") }).toEqual(before);
  });
});
