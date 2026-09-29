// Suite: gate de comando composto do Claude Code (#380, G63)
// Invariant: `findCompound` aceita comando único, inclusive com separador
//   dentro de aspas ou redirecionamento com `&`, e recusa todo comando
//   composto fora de aspas — a lista de permissão casa pelo prefixo e um
//   composto liberado em parte cai em aprovação manual, travando o terminal.
// Boundary IN: `.claude/hooks/no-compound-bash.mjs`, versionado e citado em
//   `.claude/settings.json` (hooks.PreToolUse, matcher Bash)
// Boundary OUT: o comportamento do próprio Claude Code ao rodar o hook — o
//   teste prova a função pura que decide, não o processo do harness
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findCompound } from "../.claude/hooks/no-compound-bash.mjs";

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
    ["git add . && git commit", "&&"],
    ["a || b", "||"],
    ["cat x | grep y", "| (pipe)"],
    ["cd x; ls", ";"],
    ["gh run watch $(gh run list)", "$(...) (substituição de comando)"],
    ['echo "$(date)"', "$(...) (substituição de comando)"],
    ["echo `date`", "crase (substituição de comando)"],
    ["sleep 10 &", "& (segundo plano)"],
    ["ls\nls", "quebra de linha (vários comandos)"],
  ])("%s -> %s", (command, expected) => {
    expect(findCompound(command)).toBe(expected);
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
