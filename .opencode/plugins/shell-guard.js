// Plugin do OpenCode (#461, G63, G85): aplica a política de shell compartilhada
// (`.claude/hooks/shell-policy.mjs`) — a mesma do hook do Claude Code e da
// guarda do Codex — antes de cada `bash`.
//
// O OpenCode carrega `.opencode/plugins/*.js` do projeto; em
// `tool.execute.before`, lançar `Error` bloqueia a chamada e a mensagem volta
// ao agente. O hook não sabe perguntar: comando composto, `deny` e `ask` do
// classificador viram bloqueio com o motivo, como no Codex — o que no Claude
// Code espera aprovação, aqui espera a pessoa rodar. As regras simples
// (`allow`/`ask`/`deny` por padrão) seguem em `opencode.json > permission`,
// gerado pelo `pnpm harness:sync`.
//
// Este módulo exporta só o plugin: o OpenCode trata cada função exportada
// como um plugin.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { bashRulesFromSettings, blockMessage, judgeShell } from "../../.claude/hooks/shell-policy.mjs";

const SETTINGS = new URL("../../.claude/settings.json", import.meta.url);

// `worktree` é a raiz do projeto e `directory` o diretório da sessão: escrita
// fora da árvore pergunta (vira bloqueio).
export const ShellGuard = async ({ directory, worktree } = {}) => ({
  "tool.execute.before": async (input, output) => {
    if (input?.tool !== "bash") return;
    const command = output?.args?.command;
    if (typeof command !== "string") return;
    // Lida a cada chamada: editar a política vale sem reiniciar. Ilegível,
    // o laço pergunta (vira bloqueio) e composto e risco seguem julgados.
    let rules = null;
    try {
      rules = bashRulesFromSettings(JSON.parse(readFileSync(SETTINGS, "utf8")));
    } catch {
      rules = null;
    }
    // Fora de repositório git o OpenCode dá `worktree` "/": aí a raiz é o diretório.
    const root = worktree && worktree !== "/" ? worktree : directory;
    const verdict = judgeShell(command, rules, { root, cwd: directory, home: homedir() });
    if (verdict) throw new Error(blockMessage(verdict, "OpenCode"));
  },
});
