// Suite: hook de shell do Claude Code (#380, #461, G63)
// Invariant: `findCompound` aceita comando único, inclusive com separador
//   dentro de aspas ou redirecionamento com `&`, pipe em que todo estágio é
//   leitura conhecida e laço com corpo julgado (#461); recusa todo outro
//   composto fora de aspas — a lista de permissão casa pelo prefixo e um
//   composto liberado em parte cai em aprovação manual, travando o terminal.
//   Risco do classificador sai como JSON de PreToolUse (`ask`/`deny`).
// Boundary IN: `.claude/hooks/no-compound-bash.mjs` (sobre
//   `.claude/hooks/shell-policy.mjs`), versionado e citado em
//   `.claude/settings.json` (hooks.PreToolUse, matcher Bash)
// Boundary OUT: o comportamento do próprio Claude Code ao rodar o hook — o
//   teste prova a função pura que decide, não o processo do harness
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findCompound } from "../.claude/hooks/no-compound-bash.mjs";

const HOOK_PATH = ".claude/hooks/no-compound-bash.mjs";

describe("findCompound: um comando de shell por chamada", () => {
  it.each<[string, string | null]>([
    ["git status", null],
    ['gh pr list --jq ".[] | {n: .number}"', null],
    ["gh api graphql -f query='mutation { a; b }'", null],
    ["pnpm test 2>&1", null],
    ["ls > out.txt 2>/dev/null", null],
    ["find . -name x -exec rm {} \\;", null],
    ['git commit -m "fix: a && b"', null],
    ["cmd &> log", null],
    ["echo 'a\nb'", null],
    // Pipe em que todo estágio só lê: passa (#461).
    ["cat x | grep y", null],
    ["git log --oneline | head -20", null],
    ["git -C /repo diff --stat | tail -5", null],
    ["rtk git status --short | wc -l", null],
    ["rg -n foo src | sort | uniq -c", null],
    ["/usr/bin/grep -r x . | head", null],
    // Algum estágio executa, escreve ou não é leitura conhecida: recusa.
    ["head -1 f | sh", "| (pipe) com estágio fora da leitura"],
    ["cat x | xargs rm", "| (pipe) com estágio fora da leitura"],
    ["git log | tee out.txt", "| (pipe) com estágio fora da leitura"],
    ["git push origin x | cat", "| (pipe) com estágio fora da leitura"],
    ["git log --output=/tmp/x | head", "| (pipe) com estágio fora da leitura"],
    ["catamaran x | head", "| (pipe) com estágio fora da leitura"],
    ["cat x | grep y && rm z", "&&"],
    ["cat x | grep y; rm z", ";"],
    ["cat x |& grep y", "& (segundo plano)"],
    ["git add . && git commit", "&&"],
    ["a || b", "||"],
    ["cd x; ls", ";"],
    ["gh run watch $(gh run list)", "$(...) (substituição de comando)"],
    ['echo "$(date)"', "$(...) (substituição de comando)"],
    ["echo `date`", "crase (substituição de comando)"],
    ["sleep 10 &", "& (segundo plano)"],
    ["ls\nls", "quebra de linha (vários comandos)"],
    // Heredoc é recusado de propósito, mesmo em mensagem de commit: o motivo
    // continua sendo o que o hook vê primeiro (o `$(` da substituição ou a
    // quebra de linha do corpo), nunca liberado por estar "dentro" do heredoc.
    [
      "git commit -m \"$(cat <<'EOF'\nfix(x): trata (a) e b; c | d\n\nCo-Authored-By: X\nEOF\n)\"",
      "$(...) (substituição de comando)",
    ],
    ["cat > f <<'X'\nconteúdo\nX", "quebra de linha (vários comandos)"],
    // Laço é um comando só (#461); o corpo é julgado pelo classificador e pela lista.
    ["for f in a b; do echo $f; done", null],
    ["while true; do sleep 1; done", null],
    ["for f in a; do echo; done; rm -rf x", "; (comando depois do laço)"],
    ["for f in a; do git add $f && git commit; done", "&&"],
    // Nits: `ls`, `git branch` só listando e `rtk proxy` contam como leitura.
    ["ls -la | head", null],
    ["git branch -a | grep fix", null],
    ["rtk proxy git log | head", null],
    ["./grep x | head", "| (pipe) com estágio fora da leitura"],
  ])("%s -> %s", (command, expected) => {
    expect(findCompound(command)).toBe(expected);
  });
});

describe("processo real do hook: bloqueia composto, libera simples", () => {
  const run = (input: string) => spawnSync(process.execPath, [HOOK_PATH], { input, encoding: "utf8" });

  it("comando simples sai com 0 e sem stderr", () => {
    const result = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("comando composto sai com 2 e explica o motivo no stderr", () => {
    const result = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git add . && git commit" } }));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Comando composto recusado (&&)");
    expect(result.stderr).not.toContain("git commit -F");
  });

  it("heredoc e `$(...)` sugerem `git commit -F <arquivo>` ou vários `-m`", () => {
    const heredocCommit = "git commit -m \"$(cat <<'EOF'\nfix: x\nEOF\n)\"";
    const result = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: heredocCommit } }));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git commit -F <arquivo>");
  });

  // #461: risco sai em JSON de PreToolUse (saída 0), com ou sem `rtk`.
  it.each([
    ["rtk git push --force", "ask"],
    ["git push --force origin fix/x", "ask"],
    ["npx -y vercel --prod", "ask"],
    ["for f in a; do docker rm $f; done", "ask"],
    ["rtk git push origin main", "deny"],
    ["git -c x=y push origin main", "deny"],
  ])("risco devolve permissionDecision: %s -> %s", (command, decision) => {
    const result = run(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { hookSpecificOutput: Record<string, string> };
    expect(output.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: decision });
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("Política de shell do projeto");
  });

  it("rotina e laço com corpo liberado saem com 0 e sem saída", () => {
    for (const command of ["git push -u origin fix/x", "for f in a b; do echo $f; done", "git log | head", "gh secret set X"]) {
      const result = run(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
      expect(result.status, command).toBe(0);
      expect(result.stdout, command).toBe("");
    }
  });

  it("stdin ilegível ou sem `tool_input.command` não bloqueia — falha aberta na leitura, não na decisão", () => {
    expect(run("não é json").status).toBe(0);
    expect(run("").status).toBe(0);
    expect(run(JSON.stringify({ tool_name: "Bash", tool_input: {} })).status).toBe(0);
  });
});

describe("gate ligado ao harness real", () => {
  it("`.claude/settings.json` registra o hook por caminho relativo ao projeto", () => {
    const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8")) as {
      hooks?: { PreToolUse?: { matcher: string; hooks: { type: string; command: string }[] }[] };
    };
    const preToolUse = settings.hooks?.PreToolUse ?? [];
    const bash = preToolUse.find((entry) => entry.matcher === "Bash");
    expect(bash, "hooks.PreToolUse com matcher Bash").toBeDefined();
    const command = bash!.hooks[0]!.command;
    expect(command).toContain("$CLAUDE_PROJECT_DIR/.claude/hooks/no-compound-bash.mjs");
  });
});
