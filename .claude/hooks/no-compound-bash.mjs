#!/usr/bin/env node
// PreToolUse (Bash): recusa comando composto. A lista de permissão do Claude
// Code casa pelo prefixo; `a && b`, `a | b`, `a; b`, `$(...)` e comandos em
// várias linhas caem em aprovação manual e travam o terminal. Um comando por
// chamada. Separadores dentro de aspas simples ou duplas não contam
// (ex.: `--jq ".[] | .name"`), exceto substituição de comando, que o shell
// expande também entre aspas duplas.
//
// Exceção: pipe em que TODO estágio é leitura conhecida (`git log | head`),
// casada pelo nome do executável, nunca por substring. Checar só o primeiro
// estágio não basta: `head f | sh` começa lendo e termina executando.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const READ_ONLY = new Set(["cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "jq", "sort", "uniq", "cut", "tr", "column", "nl"]);
const READ_ONLY_GIT = /^git\s+(?:-C\s+\S+\s+)?(?:status|diff|log|show|rev-parse|ls-files|branch\s+--show-current|worktree\s+list)(?:\s|$)/;
// Opção que faz o `git` escrever arquivo ou chamar programa externo.
const GIT_SIDE_EFFECT = /(?:^|\s)--(?:output|ext-diff)(?:=|\s|$)/;

/** Estágio de pipe somente leitura: `rtk` e o caminho do executável não mudam o que ele faz. */
export function isReadOnlyStage(stage) {
  const text = stage.trim().replace(/^rtk\s+/, "");
  const name = (text.split(/\s+/)[0] ?? "").split("/").pop();
  if (READ_ONLY.has(name)) return true;
  if (name !== "git") return false;
  const git = text.replace(/^\S*git/, "git");
  return READ_ONLY_GIT.test(git) && !GIT_SIDE_EFFECT.test(git);
}

export function findCompound(command) {
  const verdict = scan(command);
  if (verdict?.reason !== "| (pipe)") return verdict?.reason ?? null;
  const stages = [];
  let start = 0;
  for (const cut of verdict.pipes) {
    stages.push(command.slice(start, cut));
    start = cut + 1;
  }
  stages.push(command.slice(start));
  return stages.every(isReadOnlyStage) ? null : "| (pipe) com estágio fora da leitura";
}

/**
 * Primeiro separador fora de aspas que não seja pipe, ou a lista de posições
 * dos pipes quando eles são os únicos separadores.
 */
function scan(command) {
  let single = false;
  let double = false;
  const pipes = [];
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (single) {
      if (c === "'") single = false;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`") return { reason: "crase (substituição de comando)" };
    if (c === "$" && next === "(") return { reason: "$(...) (substituição de comando)" };
    if (double) {
      if (c === '"') double = false;
      continue;
    }
    if (c === "'") { single = true; continue; }
    if (c === '"') { double = true; continue; }
    if (c === "&" && next === "&") return { reason: "&&" };
    if (c === "|" && next === "|") return { reason: "||" };
    if (c === "|") {
      pipes.push(i);
      continue;
    }
    if (c === ";") return { reason: ";" };
    if (c === "\n") return { reason: "quebra de linha (vários comandos)" };
    if (c === "&") {
      const prev = command[i - 1];
      // `2>&1`, `>&2` e `&>` são redirecionamento, não segundo plano.
      if (prev === ">" || next === ">") continue;
      return { reason: "& (segundo plano)" };
    }
  }
  return pipes.length > 0 ? { reason: "| (pipe)", pipes } : null;
}

/**
 * Heredoc e `$(...)` continuam recusados de propósito, mesmo em mensagem de
 * commit: uma recusa custa uma nova tentativa, um prompt de aprovação trava
 * o dono. Só esses dois motivos ganham a sugestão de escrever a mensagem com
 * a ferramenta Write e usar `git commit -F <arquivo>` (ou vários `-m`).
 */
const SUGGESTS_COMMIT_FILE = new Set(["quebra de linha (vários comandos)", "$(...) (substituição de comando)"]);

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string") process.exit(0);
  const found = findCompound(command.trim());
  if (!found) process.exit(0);
  const suggestion = SUGGESTS_COMMIT_FILE.has(found)
    ? " Mensagem de commit com corpo ou heredoc: escreva com a ferramenta Write e rode " +
      "`git commit -F <arquivo>`, ou use vários `-m`."
    : "";
  process.stderr.write(
    `Comando composto recusado (${found}). Regra: um comando por chamada de shell — ` +
      "sem &&, ||, ;, &, $(...), crase ou várias linhas fora de aspas, e pipe só quando todo " +
      "estágio é leitura (cat, head, tail, grep, rg, jq, sort, wc, git status/diff/log/show). " +
      "Divida em chamadas separadas (independentes podem ir em paralelo na mesma resposta); " +
      "para filtrar saída use a opção do próprio comando (--jq, --json, grep com arquivo) ou um script em arquivo." +
      `${suggestion}\n`,
  );
  process.exit(2);
}

// `pathToFileURL` resolve `process.argv[1]` relativo ao cwd, como o `node`
// resolve o módulo: comparação por template string quebraria se o hook fosse
// chamado com caminho relativo (é sempre absoluto em produção, via
// `$CLAUDE_PROJECT_DIR`, mas o teste de integração roda os dois jeitos).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
