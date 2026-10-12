// Suite: git liberado em worktree de trabalho, com o contexto real (#476)
// Invariant: o comando `git` simples numa worktree registrada diferente da
//   checkout principal, fora de branch protegida, passa sem pergunta — push
//   sem refspec, forçado, `--delete` de branch de trabalho, `reset --hard`,
//   `clean`, `checkout` com descarte. Continuam negando: push cujo destino real
//   é `main`/`staging`/`dev` (destino não resolvido nega), descarte na checkout
//   principal (G44, com a instrução de rodar numa worktree) e segredo. Os quatro
//   Critical da primeira versão (diretório comum sob `.claude/worktrees/`,
//   `--git-dir`/`GIT_DIR=`, `-c push.*`/`remote.*`, `env -C`/`sh -c`)
//   negam: desde 11/10/2026 o push nunca pergunta, passa ou nega, e o que o
//   texto não resolve nega com a instrução de explicitar o destino. O git não
//   pergunta: passa ou nega. Gravar a configuração que desvia o push (#505)
//   passa, e o push que a usar nega. Os três chamadores dão a mesma decisão.
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
/** Worktree em `feat/novo`, criada sem upstream: o primeiro push ainda não aconteceu. */
let wtNew = "";
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
  wtNew = join(root, ".claude/worktrees/feat-novo");
  git(root, "worktree", "add", "--no-track", "-b", "feat/novo", wtNew, "origin/dev");
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
      // #505: o remoto de push trocado por configuração, e a URL de push reescrita.
      ["remote.pushDefault", "fork"],
      ["branch.feat/x.pushRemote", "fork"],
      ["url.https://x.test/.pushInsteadOf", "https://y.test/"],
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
    // Juiz da #502: refspec sem `:` desviado por `-c`/`--config-env`.
    expect(dryRun(wtUp, ["-c", "remote.origin.push=refs/heads/feat/up:refs/heads/dev", "push", "--dry-run", "--porcelain", "origin", "feat/up"])).toContain("refs/heads/feat/up:refs/heads/dev");
    expect(dryRun(wt, ["-c", "remote.origin.push=refs/heads/feat/x:refs/heads/main", "push", "--dry-run", "--porcelain", "origin", "feat/x"])).toContain("refs/heads/feat/x:refs/heads/main");
    expect(dryRun(wtUp, ["-c", "push.default=upstream", "push", "--dry-run", "--porcelain", "origin", "feat/up"])).toContain("refs/heads/feat/up:refs/heads/dev");
    expect(dryRun(wtUp, ["--config-env=push.default=PD", "push", "--dry-run", "--porcelain", "origin", "feat/up"], { PD: "upstream" })).toContain("refs/heads/feat/up:refs/heads/dev");
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
    // #475: o prefixo único de opção longa vale como a opção completa, com o
    // contexto real do git: passa onde a forma completa passa, nega onde ela nega.
    ["push --force-with abreviado com refspec de trabalho", () => "git push --force-with origin feat/x", () => wt, "pass"],
    ["push --no-veri abreviado", () => "git push --no-veri", () => wt, "pass"],
    ["push --delet abreviado de branch de trabalho", () => "git push origin --delet feat/velha", () => wt, "pass"],
    ["reset --har abreviado", () => `git -C ${wt} reset --har origin/dev`, () => root, "pass"],
    ["checkout --forc abreviado", () => "git checkout --forc", () => wt, "pass"],
    ["switch --discard abreviado", () => "git switch --discard feat/x", () => wt, "pass"],
    ["push --force-with abreviado de outro branch a partir da principal", () => "git push --force-with origin feat/x", () => root, "pass"],
    ["push --follow abreviado forçado", () => "git push --follow --force-with origin feat/x", () => wt, "deny"],
    ["push --mirro abreviado", () => "git push --mirro", () => wt, "deny"],
    ["push --al abreviado", () => "git push --al", () => wt, "deny"],
    ["push --prun abreviado", () => "git push --prun origin feat/x", () => wt, "pass"],
    ["reset --har abreviado na principal", () => "git reset --har", () => root, "deny"],
    ["reset --har abreviado por -C na principal", () => `git -C ${root} reset --har`, () => wt, "deny"],
    ["clean --dr -fd (dry-run abreviado) na principal", () => "git clean --dr -fd", () => root, "pass"],
    ["clean -fd na principal", () => "git clean -fd", () => root, "deny"],
    ["checkout --forc abreviado na principal", () => "git checkout --forc", () => root, "deny"],
    ["switch --discard abreviado na principal", () => "git switch --discard feat/x", () => root, "deny"],
    ["restore --staged --work abreviado na principal", () => "git restore --staged --work a.txt", () => root, "deny"],
    ["rm --forc abreviado na principal", () => "git rm --forc a.txt", () => root, "deny"],
    ["worktree remove --forc abreviado de fora", () => `git worktree remove --forc ${base}/fora`, () => root, "deny"],
    ["worktree remove --forc abreviado de worktree de trabalho", () => "git worktree remove --forc .claude/worktrees/feat-x", () => root, "pass"],
    // O pedido do dono (11/10/2026): `git -C <worktree> push` resolve o destino real do branch do
    // diretório de `-C`; branch de trabalho com upstream do mesmo nome passa, sem upstream nega
    // com a instrução de explicitar o destino, e o explícito passa.
    ["-C worktree de trabalho com upstream do mesmo nome", () => `git -C ${wt} push`, () => root, "pass"],
    ["-C worktree de trabalho com upstream do mesmo nome, com rtk", () => `rtk git -C ${wt} push`, () => root, "pass"],
    ["-C worktree de trabalho sem upstream nega", () => `git -C ${wtNew} push`, () => root, "deny"],
    ["-C worktree de trabalho sem upstream, push -u explícito", () => `git -C ${wtNew} push -u origin feat/novo`, () => root, "pass"],
    ["-C worktree de trabalho sem upstream, destino explícito", () => `git -C ${wtNew} push origin feat/novo:feat/novo`, () => root, "pass"],
    // #505: o `git push -u origin <tipo>/<slug>` da rotina continua passando.
    ["push -u de rotina com upstream origin/dev", () => "git push -u origin feat/up", () => wtUp, "pass"],
    ["push -u de rotina com upstream próprio", () => "git push -u origin feat/x", () => wt, "pass"],
    ["push --set-upstream de rotina", () => "git push --set-upstream origin feat/up", () => wtUp, "pass"],
    ["leitura da configuração do push", () => "git config --get remote.origin.push", () => wt, "pass"],
    ["leitura de push.default", () => "git config --get push.default", () => wt, "pass"],
    // #505: gravar a configuração que desvia o destino do push passa (o push
    // seguinte é provado com o git de verdade no bloco abaixo).
    ["config remote.origin.push com destino dev", () => "git config remote.origin.push refs/heads/feat/up:refs/heads/dev", () => wtUp, "pass"],
    ["config push.default upstream", () => "git config push.default upstream", () => wtUp, "pass"],
    ["config branch.<b>.merge", () => "git config branch.feat/x.merge refs/heads/dev", () => wt, "pass"],
    ["config branch.<b>.pushRemote", () => "git config branch.feat/x.pushRemote fork", () => wt, "pass"],
    ["config remote.pushDefault", () => "git config remote.pushDefault fork", () => wt, "pass"],
    ["config url.*.pushInsteadOf", () => "git config url.https://x.test/.pushInsteadOf https://y.test/", () => wt, "pass"],
    ["config --unset de remote.origin.push", () => "git config --unset remote.origin.push", () => wt, "pass"],
    ["config --file do projeto com remote.origin.push", () => `git config --file ${root}/.git/config remote.origin.push HEAD:main`, () => wt, "pass"],
    // Refspec sem `:` que não é o branch atual: o git o resolve localmente
    // (ref simbólica, upstream), então o destino forçado não é conhecido.
    ["push forçado de outro branch a partir da principal", () => "git push --force origin feat/x", () => root, "pass"],
    // Rodada 1 da L2: ref simbólica, link com `..`, tag forçada, worktree alheia.
    ["push forçado de main-worktree/HEAD", () => "git push -f origin main-worktree/HEAD", () => wt, "deny"],
    ["push de worktrees/<n>/HEAD", () => "git push origin worktrees/em-dev/HEAD", () => wt, "deny"],
    ["reset --hard por -C com link e ..", () => `git -C ${link}/sub/.. reset --hard`, () => wt, "deny"],
    ["push -f --tags", () => "git push -f --tags", () => wt, "deny"],
    ["push -f de tag por nome", () => "git push -f origin tag v1.0.0", () => wt, "deny"],
    ["push -f de refs/tags", () => "git push -f origin refs/tags/v1.0.0", () => wt, "deny"],
    ["switch --ignore-other-worktrees para dev", () => "git switch --ignore-other-worktrees dev", () => wt, "deny"],
    // Destino real protegido: nega.
    ["push forçado para dev", () => "git push --force origin dev", () => wt, "deny"],
    ["push HEAD:main", () => "git push origin HEAD:main", () => wt, "deny"],
    ["push HEAD numa worktree em dev", () => "git push origin HEAD", () => wtDev, "deny"],
    ["push sem refspec na checkout principal (dev)", () => "git push", () => root, "deny"],
    ["push sem refspec numa worktree em dev", () => `git -C ${wtDev} push`, () => root, "deny"],
    ["push forçado sem refspec numa worktree em dev", () => `git -C ${wtDev} push --force`, () => root, "deny"],
    ["push sem refspec com upstream origin/dev", () => "git push", () => wtUp, "deny"],
    ["push --all", () => "git push --all", () => wt, "deny"],
    ["push --mirror", () => "git push --mirror", () => wt, "deny"],
    ["push --prune", () => "git push --prune origin feat/x", () => wt, "pass"],
    ["push matching (:)", () => "git push origin :", () => wt, "deny"],
    ["push matching forçado (+:)", () => "git push origin +:", () => wt, "deny"],
    ["push matching na principal", () => "git push origin :", () => root, "deny"],
    ["push apaga tag",() => "git push origin :refs/tags/v1.0.0", () => wt, "deny"],
    ["push para outro remoto escrito", () => "git push upstream", () => wt, "deny"],
    // Critical 1: diretório comum sob `.claude/worktrees/` e atalhos para a principal.
    ["push em diretório comum sob .claude/worktrees", () => `git -C ${plainDir} push`, () => root, "deny"],
    ["push pelo link simbólico para a principal", () => `git -C ${link} push`, () => root, "deny"],
    ["push com .. até a principal", () => `git -C ${wt}/../../.. push`, () => root, "deny"],
    // Critical 2: `--git-dir` e `GIT_DIR=` apontando a principal.
    ["--git-dir para a principal", () => `git --git-dir=${root}/.git push`, () => wt, "deny"],
    ["--git-dir separado para a principal", () => `git --git-dir ${root}/.git -C ${wt} push`, () => root, "deny"],
    ["GIT_DIR= para a principal", () => `GIT_DIR=${root}/.git git push`, () => wt, "deny"],
    // Critical 3: configuração na linha de comando.
    ["-c push.default=upstream com upstream origin/dev", () => `git -c push.default=upstream -C ${wtUp} push`, () => root, "deny"],
    ["-c remote.origin.push=HEAD:main", () => `git -c remote.origin.push=HEAD:main -C ${wt} push`, () => root, "deny"],
    // Juiz da #502 (C1): `-c`/`--config-env` que desvia o refspec sem `:`.
    ["-c remote.origin.push leva feat/up para dev", () => "git -c remote.origin.push=refs/heads/feat/up:refs/heads/dev push origin feat/up", () => wtUp, "deny"],
    ["-c remote.origin.push leva feat/x para main", () => "git -c remote.origin.push=refs/heads/feat/x:refs/heads/main push origin feat/x", () => wt, "deny"],
    ["-c push.default=upstream com refspec", () => "git -c push.default=upstream push origin feat/up", () => wtUp, "deny"],
    ["--config-env push.default com refspec", () => "PD=upstream git --config-env=push.default=PD push origin feat/up", () => wtUp, "deny"],
    ["--config-env",() => `git --config-env=push.default=X -C ${wt} push`, () => root, "deny"],
    // Critical 4: diretório trocado por invólucro ou shell aninhado.
    ["env -C para a principal", () => `env -C ${root} git push`, () => wt, "deny"],
    ["env --chdir para a principal", () => `env --chdir=${root} git push`, () => wt, "deny"],
    ["sh -c com cd para a principal", () => `sh -c "cd ${root} && git push"`, () => wt, "deny"],
    ["bash -c com git -C", () => `bash -c "git -C ${root} push"`, () => wt, "deny"],
    ["find -exec", () => `find . -maxdepth 0 -exec git -C ${wt} push \\;`, () => wt, "deny"],
    // Descarte na checkout principal (G44) e em worktree em dev.
    ["reset --hard na principal", () => "git reset --hard", () => root, "deny"],
    ["reset --hard na principal por -C", () => `git -C ${root} reset --hard`, () => wt, "deny"],
    ["reset --hard no diretório comum sob .claude/worktrees", () => `git -C ${plainDir} reset --hard`, () => root, "deny"],
    ["clean na principal", () => "git clean -fd", () => root, "deny"],
    ["checkout -- caminho na principal", () => "git checkout -- a.txt", () => root, "deny"],
    ["checkout -f na principal", () => "git checkout -f", () => root, "deny"],
    ["reset --hard numa worktree em dev", () => "git reset --hard", () => wtDev, "deny"],
    ["reset --hard por sh -c", () => `sh -c "git -C ${wt} reset --hard"`, () => root, "deny"],
    // O stash é descartável: apagar passa em qualquer lugar (11/10/2026).
    ["stash drop na worktree", () => "git stash drop", () => wt, "pass"],
    // Segredo continua negado.
    ["segredo", () => "git add .env", () => wt, "deny"],
  ];

  it.each(cases)("%s", async (_name, command, cwd, expected) => {
    expect(await decisions(command(), cwd())).toEqual([expected, expected, expected]);
  });

  it("o bloqueio do push sem upstream pede o destino explícito e não pergunta", () => {
    const outcome = hookOutcome(`git -C ${wtNew} push`, CLAUDE_RULES, { root, cwd: root, home });
    const output = JSON.parse(outcome.stdout!).hookSpecificOutput;
    expect(output.permissionDecision).toBe("deny");
    expect(output.permissionDecisionReason).toContain("git push origin <branch>");
    expect(output.permissionDecisionReason).not.toContain("(ask)");
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
      expect(claude("git reset --hard", wtDev)).toBe("deny");
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
    expect(judgeShell("git push", CLAUDE_RULES, { root, cwd: root, home, gitTarget: forged })?.decision).toBe("deny");
    expect(judgeShell(`git -C ${wt} push`, CLAUDE_RULES, { root, cwd: wt, home, gitTarget: forged })?.decision).toBe("deny");
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

describe("configuração persistida que desvia o push (#505)", () => {
  let fork = "";

  beforeAll(() => {
    // Outro remoto, para o `remote.pushDefault` e o `pushRemote` terem para onde ir.
    fork = join(base, "fork.git");
    git(base, "init", "--bare", "-b", "main", fork);
    git(root, "remote", "add", "fork", fork);
  });

  afterAll(() => {
    git(root, "remote", "remove", "fork");
  });

  /**
   * Os dois passos do achado: gravar a configuração (passa) e, com ela
   * persistida, empurrar (nega, porque o push não pergunta). O git de verdade,
   * em `--dry-run`, diz para onde o push iria — nos três primeiros, `dev`.
   */
  const persisted: Array<{
    name: string;
    settings: () => Array<[key: string, value: string]>;
    cwd: () => string;
    push: string;
    dryRun: string[];
    reaches: () => string;
    branch: string;
  }> = [
    {
      name: "remote.<r>.push leva feat/up para dev",
      settings: () => [["remote.origin.push", "refs/heads/feat/up:refs/heads/dev"]],
      cwd: () => wtUp,
      push: "git push origin feat/up",
      dryRun: ["push", "--dry-run", "--porcelain", "origin", "feat/up"],
      reaches: () => "refs/heads/feat/up:refs/heads/dev",
      branch: "feat/up",
    },
    {
      name: "push.default=upstream com upstream origin/dev",
      settings: () => [["push.default", "upstream"]],
      cwd: () => wtUp,
      push: "git push origin feat/up",
      dryRun: ["push", "--dry-run", "--porcelain", "origin", "feat/up"],
      reaches: () => "refs/heads/feat/up:refs/heads/dev",
      branch: "feat/up",
    },
    {
      name: "branch.<b>.merge para dev e push.default=upstream",
      settings: () => [
        ["branch.feat/x.merge", "refs/heads/dev"],
        ["push.default", "upstream"],
      ],
      cwd: () => wt,
      push: "git push origin feat/x",
      dryRun: ["push", "--dry-run", "--porcelain", "origin", "feat/x"],
      reaches: () => "refs/heads/feat/x:refs/heads/dev",
      branch: "feat/x",
    },
    {
      name: "remote.pushDefault leva o push sem remoto para outro repositório",
      settings: () => [["remote.pushDefault", "fork"]],
      cwd: () => wt,
      push: "git push",
      dryRun: ["push", "--dry-run", "--porcelain"],
      reaches: () => fork,
      branch: "feat/x",
    },
    {
      name: "branch.<b>.pushRemote leva o push sem remoto para outro repositório",
      settings: () => [["branch.feat/x.pushRemote", "fork"]],
      cwd: () => wt,
      push: "git push",
      dryRun: ["push", "--dry-run", "--porcelain"],
      reaches: () => fork,
      branch: "feat/x",
    },
    {
      name: "url.*.pushInsteadOf leva o remoto escrito para outro repositório",
      settings: () => [[`url.${fork}.pushInsteadOf`, remote]],
      cwd: () => wt,
      push: "git push origin feat/x",
      dryRun: ["push", "--dry-run", "--porcelain", "origin", "feat/x"],
      reaches: () => fork,
      branch: "feat/x",
    },
  ];

  /** Grava a chave como o git a gravaria e devolve quem a restaura (o valor anterior, se havia). */
  function persist(key: string, value: string): () => void {
    const before = spawnSync("git", ["-C", root, "config", "--get-all", key], { encoding: "utf8" });
    const previous = before.status === 0 ? before.stdout.split("\n").filter((line) => line !== "") : [];
    git(root, "config", "--replace-all", key, value);
    return () => {
      git(root, "config", "--unset-all", key);
      for (const old of previous) git(root, "config", "--add", key, old);
    };
  }

  it.each(persisted.map((entry) => [entry.name, entry] as const))("%s", async (_name, entry) => {
    const cwd = entry.cwd();
    // Passo 1: gravar a chave passa nos três harnesses.
    for (const [key, value] of entry.settings()) {
      const write = `git config ${key} ${value}`;
      expect(await decisions(write, cwd), write).toEqual(["pass", "pass", "pass"]);
    }
    // Sem a configuração, o push da rotina passa.
    expect(await decisions(entry.push, cwd), entry.push).toEqual(["pass", "pass", "pass"]);
    expect(dryRun(cwd, entry.dryRun)).not.toContain(entry.reaches());
    // Passo 2: com ela persistida (gravada direto, fora da guarda), o push nega
    // — não pergunta — e a mensagem manda explicitar o destino com `:`.
    const restores = entry.settings().map(([key, value]) => persist(key, value));
    try {
      expect(dryRun(cwd, entry.dryRun), `o git de verdade leva o push para ${entry.reaches()}`).toContain(entry.reaches());
      expect(await decisions(entry.push, cwd), entry.push).toEqual(["deny", "deny", "deny"]);
      const blocked = hookOutcome(entry.push, CLAUDE_RULES, { root, cwd, home });
      const reason = JSON.parse(blocked.stdout!).hookSpecificOutput.permissionDecisionReason as string;
      expect(reason).toContain("explicite o destino");
      expect(reason).toContain("git push origin <branch>:<branch>");
      // O que a mensagem manda fazer passa nos três, e o git de verdade o leva para o branch escrito.
      const explicit = `git push origin ${entry.branch}:${entry.branch}`;
      expect(await decisions(explicit, cwd), explicit).toEqual(["pass", "pass", "pass"]);
      const dry = dryRun(cwd, ["push", "--dry-run", "--porcelain", "origin", `${entry.branch}:${entry.branch}`]);
      expect(dry).toContain(`refs/heads/${entry.branch}:refs/heads/${entry.branch}`);
      expect(dry).not.toContain("refs/heads/dev");
    } finally {
      for (const restore of restores.reverse()) restore();
    }
    expect(await decisions(entry.push, cwd), entry.push).toEqual(["pass", "pass", "pass"]);
  });

  it("a rotina continua passando com a configuração do dia a dia", async () => {
    // Descrição e `rebase` do branch e `insteadOf` (reescreve fetch e push do mesmo jeito) não desviam o destino.
    const restores = [
      persist("branch.feat/x.description", "trabalho"),
      persist("branch.feat/x.rebase", "true"),
      persist(`url.${fork}.insteadOf`, "https://exemplo.invalid/"),
    ];
    try {
      expect(await decisions("git push -u origin feat/x", wt)).toEqual(["pass", "pass", "pass"]);
      expect(await decisions("git push", wt)).toEqual(["pass", "pass", "pass"]);
      expect(await decisions(`git -C ${wt} push`, root)).toEqual(["pass", "pass", "pass"]);
      expect(resolveGitTarget("git push", { cwd: wt })?.push?.safe).toBe(true);
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  });
});
