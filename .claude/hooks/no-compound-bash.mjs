#!/usr/bin/env node
// PreToolUse (Bash) do Claude Code: aplica a política de shell compartilhada
// (`shell-policy.mjs`, #461) — a mesma que a guarda do Codex e o plugin do
// OpenCode chamam.
//
// - Comando composto: recusa com saída 2 e o motivo no stderr. A lista de
//   permissão casa pelo prefixo; `a && b`, `a; b`, `$(...)` e várias linhas
//   cairiam em aprovação manual e travariam o terminal.
// - Risco (`classifyRisk`) e comando de laço fora da lista: imprime o JSON de
//   PreToolUse com `permissionDecision` `ask` ou `deny` e sai 0. Vale qualquer
//   que seja a forma que o Claude Code use para casar a lista — com ou sem o
//   `rtk` que o hook global acrescenta —, porque o classificador tira o
//   prefixo antes de julgar.
// - Comando `git` simples: o contexto real (checkout principal ou worktree de
//   trabalho, destino do push) vem do próprio git (`push-target.mjs`, #476).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveGitTarget } from "./push-target.mjs";
import { bashRulesFromSettings, compoundMessage, findCompound, isReadOnlyStage, judgeShell } from "./shell-policy.mjs";

export { findCompound, isReadOnlyStage };

const SETTINGS = new URL("../settings.json", import.meta.url);

/** Regras `Bash(...)` do `.claude/settings.json` ao lado do hook; ilegível → `null` (laço pergunta). */
export function loadRules(path = SETTINGS) {
  try {
    return bashRulesFromSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

/**
 * O que o hook responde para o comando: saída 2 com motivo (composto), JSON de
 * PreToolUse com `ask`/`deny` (risco) ou nada.
 * @param {string} command
 * @param {import("./shell-policy.mjs").BashRules | null} rules
 * @param {import("./shell-policy.mjs").ShellEnv} [env] raiz do projeto, cwd e diretório pessoal;
 *   sem `gitTarget`, o contexto do git é resolvido aqui a partir do `cwd`
 * @returns {{ exit: 0 | 2, stdout?: string, stderr?: string }}
 */
export function hookOutcome(command, rules, env = {}) {
  let verdict;
  try {
    const gitTarget = env.gitTarget === undefined ? resolveGitTarget(command, { cwd: env.cwd }) : env.gitTarget;
    verdict = judgeShell(command, rules, { ...env, gitTarget });
  } catch (error) {
    // Falha fecha na decisão: o hook que cai deixaria o comando passar.
    verdict = { decision: "ask", reason: `a política de shell não conseguiu julgar o comando (${error?.message ?? error})`, kind: "risk" };
  }
  if (!verdict) return { exit: 0 };
  if (verdict.kind === "compound") return { exit: 2, stderr: `${compoundMessage(verdict.reason)}\n` };
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: verdict.decision,
      permissionDecisionReason: `Política de shell do projeto (${verdict.decision}): ${verdict.reason}.`,
    },
  };
  return { exit: 0, stdout: `${JSON.stringify(output)}\n` };
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string") process.exit(0);
  // A árvore do projeto é `$CLAUDE_PROJECT_DIR` (o worktree fica dentro dela);
  // sem ele, o diretório da sessão. Escrita fora dela pergunta.
  const cwd = typeof input?.cwd === "string" && isAbsolute(input.cwd) ? input.cwd : undefined;
  const root = process.env.CLAUDE_PROJECT_DIR || cwd;
  const outcome = hookOutcome(command, loadRules(), { root, cwd, home: homedir() });
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  process.exit(outcome.exit);
}

// `pathToFileURL` resolve `process.argv[1]` relativo ao cwd, como o `node`
// resolve o módulo: comparação por template string quebraria se o hook fosse
// chamado com caminho relativo (é sempre absoluto em produção, via
// `$CLAUDE_PROJECT_DIR`, mas o teste de integração roda os dois jeitos).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
