/**
 * O grafo de módulos visto por quem só tem o texto-fonte.
 *
 * As regras de fronteira (domínio puro, adapter burro) liam `from "…"` com
 * aspas duplas, e por isso qualquer outra grafia passava: aspas simples,
 * `import("…")`, `require("…")`, `export * from`, import de efeito colateral.
 * Pior, liam só o arquivo: um domínio que importa o `index.ts` do próprio
 * contexto, que reexporta um adapter Drizzle, carregava o banco sem escrever o
 * nome dele em lugar nenhum.
 *
 * O TypeScript do projeto é o 7 (nativo), que não expõe API de compilador em
 * JavaScript. Então o leitor é léxico: tira comentários com o mesmo leitor do
 * inventário de entradas e reconhece as cinco formas de aresta. A aresta
 * de tipo (`import type`, `export type`, `{ type A }` sozinho) some antes da
 * build e não conta.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { stripComments } from "./entry-inventory.ts";

export type EdgeKind = "static" | "reexport" | "side-effect" | "dynamic" | "require";

export type ModuleEdge = {
  kind: EdgeKind;
  /** `null` quando o especificador não é literal: `import(nome)`. */
  specifier: string | null;
  typeOnly: boolean;
};

/** O que vem entre `import`/`export` e `from`, sem atravessar declarações. */
const CLAUSE = String.raw`(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)`;
const FROM = new RegExp(String.raw`\b(import|export)\s+(type\s+)?(${CLAUSE})\s*from\s*(["'])([^"'\n]+)\4`, "g");
const SIDE_EFFECT = /\bimport\s*(["'])([^"'\n]+)\1/g;
const DYNAMIC = /\bimport\s*\(\s*(?:(["'`])([^"'`\n]+)\1\s*\)|([^\s)"'`]))/g;
const REQUIRE = /\brequire\s*\(\s*(?:(["'`])([^"'`\n]+)\1\s*\)|([^\s)"'`]))/g;

function onlyTypes(clause: string): boolean {
  const braces = /^\{([^}]*)\}$/.exec(clause.trim());
  if (!braces) return false;
  const parts = braces[1]!.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^type\s/.test(part));
}

/** Toda aresta de módulo do fonte, em qualquer das grafias aceitas pelo Node. */
export function moduleEdges(source: string): ModuleEdge[] {
  const code = stripComments(source);
  const edges: ModuleEdge[] = [];
  for (const m of code.matchAll(FROM)) {
    edges.push({
      kind: m[1] === "export" ? "reexport" : "static",
      specifier: m[5]!,
      typeOnly: m[2] !== undefined || onlyTypes(m[3]!),
    });
  }
  for (const m of code.matchAll(SIDE_EFFECT)) {
    edges.push({ kind: "side-effect", specifier: m[2]!, typeOnly: false });
  }
  for (const m of code.matchAll(DYNAMIC)) {
    edges.push({ kind: "dynamic", specifier: m[2] ?? null, typeOnly: false });
  }
  for (const m of code.matchAll(REQUIRE)) {
    edges.push({ kind: "require", specifier: m[2] ?? null, typeOnly: false });
  }
  return edges;
}

/** O arquivo local que um especificador relativo ou `@/` nomeia, ou `null`. */
export function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const base = specifier.startsWith("@/") ? resolve(specifier.slice(2)) : resolve(dirname(from), specifier);
  const stripped = base.replace(/\.(ts|tsx)$/, "");
  for (const candidate of [base, `${stripped}.ts`, `${stripped}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return relative(process.cwd(), candidate);
  }
  return null;
}

/**
 * Decide se uma aresta é proibida. Recebe o especificador e, quando local, o
 * arquivo que ele resolve (relativo à raiz). Devolve o motivo ou `null`.
 */
export type ForbiddenEdge = (specifier: string | null, resolved: string | null) => string | null;

/**
 * A cadeia de imports de VALOR de `entry` até a primeira aresta proibida,
 * seguindo módulos locais. `null` quando nada proibido é alcançado.
 *
 * A cadeia termina com o motivo, para a falha dizer por onde o banco entrou:
 * `score.ts -> matching/index.ts -> infra/drizzle-profile.ts -> drizzle-orm`.
 */
export type ModuleSource = {
  read: (file: string) => string;
  resolve: (from: string, specifier: string) => string | null;
};

const DISK: ModuleSource = { read: (file) => readFileSync(file, "utf8"), resolve: resolveLocal };

export function forbiddenReach(
  entry: string,
  forbidden: ForbiddenEdge,
  source: ModuleSource = DISK,
  seen: Set<string> = new Set(),
): string[] | null {
  if (seen.has(entry)) return null;
  seen.add(entry);
  for (const edge of moduleEdges(source.read(entry))) {
    if (edge.typeOnly) continue;
    const resolved = edge.specifier === null ? null : source.resolve(entry, edge.specifier);
    const reason = forbidden(edge.specifier, resolved);
    if (reason !== null) return [entry, reason];
    if (resolved === null) continue;
    const deeper = forbiddenReach(resolved, forbidden, source, seen);
    if (deeper !== null) return [entry, ...deeper];
  }
  return null;
}

/**
 * Leituras de relógio e rede escritas no próprio módulo.
 *
 * O relógio implícito mais comum não é uma chamada no corpo: é o valor padrão
 * de parâmetro (`now = Date.now()`), que faz a mesma função devolver outra
 * coisa amanhã para quem esquece o argumento. Por isso não importa onde a
 * chamada está: dentro do domínio, ela é o domínio lendo o relógio.
 */
export function ambientReads(source: string): string[] {
  // Strings fora: o nome de uma API citado numa mensagem não é chamada.
  const code = stripComments(source).replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  const found: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/\bDate\.now\s*\(/g, "Date.now()"],
    [/\bnew\s+Date\s*\(\s*\)/g, "new Date()"],
    [/\bnew\s+Date\b(?!\s*\()/g, "new Date"],
    [/\bperformance\.now\s*\(/g, "performance.now()"],
    [/(?<![\w$.])fetch\s*\(/g, "fetch()"],
    [/\bMath\.random\s*\(/g, "Math.random()"],
  ];
  for (const [pattern, name] of patterns) {
    for (const _ of code.matchAll(pattern)) found.push(name);
  }
  return found;
}
