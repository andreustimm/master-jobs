/**
 * O recorte do CI de um PR (issue #528): PR só de documentação não paga os
 * jobs pesados que nenhum Markdown alcança.
 *
 * Diagnóstico de 2026-10-12: 10 de 60 PRs mudavam só Markdown e cada um rodava a
 * suíte inteira. Mas "só Markdown" não é "sem efeito" aqui: `CHANGELOG.md` e
 * `USER_CHANGELOG.*.md` entram no build (`scripts/build-changelog.ts`),
 * `docs/prompts/` é prompt de LLM, e testes do Vitest leem `DESIGN.md`, regras
 * e skills. Por isso a decisão é uma **lista de permissão** de caminhos (G27):
 * só o que está nela pode pular algo, e o que pula é só o que nenhum desses
 * arquivos alcança — `build`, `pwa-browser` e `banco-nas-majors`. `contratos`
 * (instruções, harnesses, changelogs, tracker de QA) e o Vitest com cobertura
 * continuam rodando.
 *
 * Falha fechada: fora de `pull_request`, sem diff legível ou com qualquer
 * arquivo fora da lista, a resposta é a suíte completa.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Markdown que nenhum job pulado lê. Raiz entra, menos os changelogs do build. */
const DOC_PREFIXES = ["docs/", "changelog.d/", ".compozy/", ".claude/", ".github/"];
const RUNTIME_MARKDOWN = [/^docs\/prompts\//, /^CHANGELOG\.md$/, /^USER_CHANGELOG[^/]*\.md$/];

export function isDocumentationOnly(path: string): boolean {
  if (!path.endsWith(".md")) return false;
  if (RUNTIME_MARKDOWN.some((pattern) => pattern.test(path))) return false;
  return !path.includes("/") || DOC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** `true` = suíte completa. Lista vazia não prova nada: completa. */
export function needsFullSuite(paths: readonly string[]): boolean {
  return paths.length === 0 || !paths.every(isDocumentationOnly);
}

/**
 * Os caminhos que o PR muda: o commit de merge que o `pull_request` testa
 * contra o seu primeiro pai, que é a base. `--no-renames` lista a origem e o
 * destino de um arquivo movido, para que mover código para `docs/` não pareça
 * só documentação.
 */
export function changedPaths(git: (args: string[]) => string): string[] {
  return git(["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function scope(event: string | undefined, git: (args: string[]) => string): { completo: boolean; motivo: string } {
  if (event !== "pull_request") return { completo: true, motivo: `evento ${event ?? "ausente"}: sempre completo` };
  let paths: string[];
  try {
    paths = changedPaths(git);
  } catch (error) {
    return { completo: true, motivo: `diff ilegível (${(error as Error).message.split("\n")[0]}): completo` };
  }
  const outside = paths.filter((path) => !isDocumentationOnly(path));
  if (paths.length === 0) return { completo: true, motivo: "diff vazio: completo" };
  if (outside.length > 0) return { completo: true, motivo: `${outside.length} arquivo(s) fora da documentação, ex.: ${outside[0]}` };
  return { completo: false, motivo: `${paths.length} arquivo(s), todos documentação` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = scope(process.env.EVENTO, (args) => execFileSync("git", args, { encoding: "utf8" }));
  console.error(`escopo: ${result.motivo}`);
  console.log(`completo=${result.completo}`);
}
