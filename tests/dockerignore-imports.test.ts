// Suite: contexto de build da imagem do plano B (issue #470, ADR 0030)
// Invariant: nenhum arquivo que entra no contexto do `docker build` importa
//   arquivo que o `.dockerignore` deixa de fora — `next build` checa tipos de
//   todo `**/*.ts` do contexto e reprova no primeiro import que não resolve.
//   E a exceção que deixa o import passar não leva memória, worktrees nem
//   settings do harness para a imagem.
// Boundary IN: `.dockerignore` (semântica do Docker: padrão casa o caminho ou
//   um diretório pai, `!` reinclui, a última regra que casa vence) e os
//   arquivos versionados (`git ls-files`), o mesmo conteúdo do checkout do CI.
// Boundary OUT: o `docker build` real, verificado à parte (deploy.md).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moduleEdges, resolveLocal } from "./support/module-graph.ts";

type Rule = { pattern: RegExp; exclude: boolean };

/** Glob do Docker (`filepath.Match` + `**`) para regex ancorada no caminho inteiro. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[" && glob.includes("]", i + 1)) {
      const end = glob.indexOf("]", i + 1);
      out += glob.slice(i, end + 1).replace(/^\[!/, "[^");
      i = end;
    } else if (c === "\\") out += `\\${glob[++i] ?? ""}`;
    else out += c.replace(/[.+^${}()|[\]]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

function parseDockerignore(text: string): Rule[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const exclude = !line.startsWith("!");
      const glob = (exclude ? line : line.slice(1)).replace(/^\/+/, "").replace(/^\.\//, "").replace(/\/+$/, "");
      return { pattern: globToRegExp(glob), exclude };
    });
}

/** Como o Docker decide: a última regra que casa o caminho ou um diretório pai vence. */
function isIgnored(rules: readonly Rule[], file: string): boolean {
  const parts = file.split("/");
  const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  let ignored = false;
  for (const rule of rules) {
    if (prefixes.some((prefix) => rule.pattern.test(prefix))) ignored = rule.exclude;
  }
  return ignored;
}

const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/**
 * Cada import (inclusive `import type`, que o `tsc` também resolve) de
 * arquivo do contexto que aponta para arquivo fora dele: `de -> para`.
 */
function brokenImports(
  files: readonly string[],
  rules: readonly Rule[],
  read: (file: string) => string,
  resolve: (from: string, specifier: string) => string | null,
): string[] {
  const broken: string[] = [];
  for (const file of files) {
    if (!CODE.test(file) || isIgnored(rules, file)) continue;
    for (const edge of moduleEdges(read(file))) {
      const target = edge.specifier === null ? null : resolve(file, edge.specifier);
      if (target !== null && isIgnored(rules, target)) broken.push(`${file} -> ${target}`);
    }
  }
  return broken;
}

const RULES = parseDockerignore(readFileSync(".dockerignore", "utf8"));
const TRACKED = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

describe(".dockerignore — o contexto da imagem compila sozinho", () => {
  it("nenhum arquivo do contexto importa arquivo excluído", () => {
    const read = (file: string) => readFileSync(file, "utf8");
    expect(brokenImports(TRACKED, RULES, read, resolveLocal)).toEqual([]);
  });

  it("a política de shell entra; memória, worktrees, settings, agentes e skills ficam fora", () => {
    expect(isIgnored(RULES, ".claude/hooks/shell-policy.mjs")).toBe(false);
    for (const file of [
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".claude/worktrees/fix-x/package.json",
      ".claude/projects/memoria/MEMORY.md",
      ".claude/agents/executor.md",
      ".claude/skills/deslop/SKILL.md",
    ]) {
      expect(isIgnored(RULES, file), file).toBe(true);
    }
  });

  it("de tests/ entra só o leitor do grafo de módulos que scripts/versions usa", () => {
    expect(isIgnored(RULES, "tests/support/module-graph.ts")).toBe(false);
    expect(isIgnored(RULES, "tests/support/entry-inventory.ts")).toBe(false);
    expect(isIgnored(RULES, "tests/deploy-fly.test.ts")).toBe(true);
    expect(isIgnored(RULES, "tests/support/outro.ts")).toBe(true);
  });

  it("os segredos continuam fora, inclusive dentro do diretório reincluído", () => {
    expect(isIgnored(RULES, ".env")).toBe(true);
    expect(isIgnored(RULES, ".env.local")).toBe(true);
    expect(isIgnored(RULES, ".env.example")).toBe(false);
  });
});

describe("brokenImports — contra o contexto que quebrou a imagem (#470)", () => {
  const sources: Record<string, string> = {
    "scripts/harness/permissions.ts": 'import { judgeShell } from "../../.claude/hooks/shell-policy.mjs";\n',
    "scripts/harness/tipos.ts": 'import type { Rules } from "../../.claude/hooks/shell-policy.mjs";\n',
    ".claude/hooks/shell-policy.mjs": "export const judgeShell = () => null;\n",
    "tests/fora.test.ts": 'import { judgeShell } from "../.claude/hooks/shell-policy.mjs";\n',
  };
  const files = Object.keys(sources);
  const read = (file: string) => sources[file]!;
  const resolve = (from: string, specifier: string) => {
    const dir = from.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === "..") dir.pop();
      else if (part !== ".") dir.push(part);
    }
    const target = dir.join("/");
    return target in sources ? target : null;
  };

  it("reprova o import de .claude excluído, inclusive o só de tipo", () => {
    const rules = parseDockerignore(".claude\ntests\n");
    expect(brokenImports(files, rules, read, resolve)).toEqual([
      "scripts/harness/permissions.ts -> .claude/hooks/shell-policy.mjs",
      "scripts/harness/tipos.ts -> .claude/hooks/shell-policy.mjs",
    ]);
  });

  it("aprova quando a exceção reinclui o diretório importado", () => {
    const rules = parseDockerignore(".claude\n!.claude/hooks\ntests\n");
    expect(brokenImports(files, rules, read, resolve)).toEqual([]);
  });
});

describe("isIgnored — semântica do .dockerignore", () => {
  it("padrão sem barra casa só na raiz; ** atravessa diretórios", () => {
    expect(isIgnored(parseDockerignore("*.db"), "app.db")).toBe(true);
    expect(isIgnored(parseDockerignore("*.db"), "data/app.db")).toBe(false);
    expect(isIgnored(parseDockerignore("**/*.db"), "data/app.db")).toBe(true);
  });

  it("a última regra que casa vence", () => {
    expect(isIgnored(parseDockerignore("!.claude/hooks\n.claude"), ".claude/hooks/a.mjs")).toBe(true);
    expect(isIgnored(parseDockerignore(".claude\n!.claude/hooks"), ".claude/hooks/a.mjs")).toBe(false);
  });
});
