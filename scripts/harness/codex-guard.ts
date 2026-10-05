// Hook PreToolUse do Codex: aplica ao Codex a lista de `.claude/settings.json`
// (G85). Registrado em `.codex/hooks.json`, que o `pnpm harness:sync` gera.
//
// O Codex não tem lista de permissões por padrão de texto, e o hook dele não
// sabe PERGUNTAR (`permissionDecision: "ask"` é recebido e ignorado, o comando
// segue). Por isso `ask` vira bloqueio com o motivo: o que no Claude Code
// espera a pessoa aprovar, no Codex espera a pessoa rodar. Falha fecha —
// entrada ilegível ou política ausente bloqueiam aqui; o processo que nem
// chega a responder bloqueia pelo `|| exit 2` do comando em `.codex/hooks.json`.
//
// Shell (#461): a mesma política do hook do Claude Code e do plugin do
// OpenCode (`.claude/hooks/shell-policy.mjs`) — composto recusado com a mesma
// mensagem, e o risco do classificador somado à lista pela decisão mais forte.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { blockMessage, judgeShell } from "../../.claude/hooks/shell-policy.mjs";
import { bashRules, decideCommand, decidePath, parseRules, type Decision, type Rule } from "./permissions.ts";

export type HookInput = {
  tool_name?: unknown;
  tool_input?: { command?: unknown } | null;
  cwd?: unknown;
};

/** `message` vem da política de shell (composto ou classificador) e substitui o texto da lista. */
export type Verdict = { decision: Decision | null; target: string; message?: string };

const STRENGTH: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };

/** Caminhos que um patch do Codex cria, altera, apaga ou para onde move. */
export function patchPaths(patch: string): string[] {
  const paths: string[] = [];
  for (const match of patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) {
    paths.push(match[1]!.trim());
  }
  return paths;
}

export function judge(input: HookInput, rules: readonly Rule[], context: { root: string; home: string }): Verdict {
  const command = input.tool_input?.command;
  if (typeof command !== "string") return { decision: "deny", target: "entrada do hook sem tool_input.command" };
  const cwd = typeof input.cwd === "string" && isAbsolute(input.cwd) ? input.cwd : context.root;

  if (input.tool_name === "apply_patch") {
    let worst: Decision | null = null;
    let target = "";
    for (const path of patchPaths(command)) {
      const absolute = isAbsolute(path) ? path : resolve(cwd, path);
      const decision = decidePath(rules, "Edit", absolute, context);
      if (decision === "deny" || (decision === "ask" && worst !== "deny")) {
        worst = decision;
        target = path;
      }
    }
    return { decision: worst, target };
  }
  const shell = judgeShell(command, bashRules(rules), { root: context.root, cwd, home: context.home });
  if (shell?.kind === "compound") return { decision: "deny", target: command, message: blockMessage(shell, "Codex") };
  const listed = decideCommand(rules, command);
  if (shell && STRENGTH[shell.decision] > STRENGTH[listed]) {
    return { decision: shell.decision, target: command, message: blockMessage(shell, "Codex") };
  }
  return { decision: listed, target: command };
}

export function hookResponse(verdict: Verdict): string | null {
  if (verdict.decision !== "deny" && verdict.decision !== "ask") return null;
  const why =
    verdict.decision === "deny"
      ? "proibido pela política do projeto (.claude/settings.json → deny)"
      : "exige aprovação humana no projeto (.claude/settings.json → ask); o hook do Codex não sabe perguntar, então peça à pessoa para rodar";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: verdict.message ? `${verdict.message} Comando: ${verdict.target}` : `${why}: ${verdict.target}`,
    },
  });
}

export function run(stdin: string, root: string, home: string): string | null {
  let input: HookInput;
  let rules: Rule[];
  try {
    const parsed: unknown = JSON.parse(stdin);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("entrada não é objeto");
    input = parsed as HookInput;
    const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8")) as {
      permissions?: Parameters<typeof parseRules>[0];
    };
    if (!settings.permissions) throw new Error("sem permissions");
    rules = parseRules(settings.permissions);
  } catch (error) {
    return hookResponse({ decision: "deny", target: `guarda sem política legível (${(error as Error).message})` });
  }
  try {
    return hookResponse(judge(input, rules, { root, home }));
  } catch (error) {
    // Falha fecha também na decisão: a guarda que cai deixaria o comando passar.
    return hookResponse({ decision: "deny", target: `guarda não conseguiu julgar o comando (${(error as Error).message})` });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = resolve(import.meta.dirname, "../..");
  const output = run(readFileSync(0, "utf8"), root, homedir());
  if (output) process.stdout.write(`${output}\n`);
}
