#!/usr/bin/env node
// PreToolUse (Bash): recusa comando composto. A lista de permissão do Claude
// Code casa pelo prefixo; `a && b`, `a | b`, `a; b`, `$(...)` e comandos em
// várias linhas caem em aprovação manual e travam o terminal. Um comando por
// chamada. Separadores dentro de aspas simples ou duplas não contam
// (ex.: `--jq ".[] | .name"`), exceto substituição de comando, que o shell
// expande também entre aspas duplas.
import { readFileSync } from "node:fs";

export function findCompound(command) {
  let single = false;
  let double = false;
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
    if (c === "`") return "crase (substituição de comando)";
    if (c === "$" && next === "(") return "$(...) (substituição de comando)";
    if (double) {
      if (c === '"') double = false;
      continue;
    }
    if (c === "'") { single = true; continue; }
    if (c === '"') { double = true; continue; }
    if (c === "&" && next === "&") return "&&";
    if (c === "|" && next === "|") return "||";
    if (c === "|") return "| (pipe)";
    if (c === ";") return ";";
    if (c === "\n") return "quebra de linha (vários comandos)";
    if (c === "&") {
      const prev = command[i - 1];
      // `2>&1`, `>&2` e `&>` são redirecionamento, não segundo plano.
      if (prev === ">" || next === ">") continue;
      return "& (segundo plano)";
    }
  }
  return null;
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
  const found = findCompound(command.trim());
  if (!found) process.exit(0);
  process.stderr.write(
    `Comando composto recusado (${found}). Regra: um comando por chamada de shell — ` +
      "sem &&, ||, ;, |, &, $(...), crase ou várias linhas fora de aspas. " +
      "Divida em chamadas separadas (independentes podem ir em paralelo na mesma resposta); " +
      "para filtrar saída use a opção do próprio comando (--jq, --json, grep com arquivo) ou um script em arquivo.\n",
  );
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
