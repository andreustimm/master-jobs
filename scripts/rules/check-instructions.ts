// Gate estrutural da fonte canônica das instruções (#203, V09-01 e V09-02).
//
// Duas regressões que nenhum teste de produto via: um harness passar a ler uma
// CÓPIA da entrada ou das skills (trocar symlink por arquivo parece inofensivo
// e cria uma segunda autoridade que envelhece em silêncio), e um ID de regra
// ou link do roteador apontar para o vazio — a entrada diz "leia G43" e o
// leitor chega a lugar nenhum. O gate não julga o texto das regras; ele só
// garante que cada ponteiro chega ao destino que diz alcançar.
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Cada harness lê a fonte canônica por symlink — nunca por cópia (G61, G72). */
export const HARNESS_LINKS: Readonly<Record<string, string>> = {
  "CLAUDE.md": "AGENTS.md",
  ".codex/skills": "../.claude/skills",
  ".opencode/skills": "../.claude/skills",
  ".opencode/agents": "../.claude/agents",
  ".opencode/commands": "../.claude/commands",
};

/**
 * Onde um harness procuraria instruções próprias. Existir ali um arquivo que
 * não seja o symlink para `AGENTS.md` é instrução duplicada por harness.
 */
export const HARNESS_INSTRUCTION_PATHS: readonly string[] = [
  ".claude/CLAUDE.md",
  ".codex/AGENTS.md",
  ".codex/CLAUDE.md",
  ".opencode/AGENTS.md",
  ".opencode/CLAUDE.md",
];

export const ENTRY = "AGENTS.md";
export const RULES_DIRECTORY = "docs/engineering/rules";
const INVENTORY = `${RULES_DIRECTORY}/README.md`;

export const SKILLS_DIRECTORY = ".claude/skills";

/**
 * Arquivos cujos links e IDs o gate confere: a entrada, as regras por domínio
 * e o `SKILL.md` de cada skill do projeto — as skills citam a regra canônica
 * por âncora (#201), e âncora renomeada deixaria o procedimento sem política.
 */
export function checkedDocuments(root: string): string[] {
  const rules = readdirSync(join(root, RULES_DIRECTORY))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => `${RULES_DIRECTORY}/${name}`);
  const skillsRoot = join(root, SKILLS_DIRECTORY);
  const skills = existsSync(skillsRoot)
    ? readdirSync(skillsRoot)
        .sort()
        .map((name) => `${SKILLS_DIRECTORY}/${name}/SKILL.md`)
        .filter((path) => existsSync(join(root, path)))
    : [];
  return [ENTRY, ...rules, ...skills];
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function checkHarnessLinks(root: string): string[] {
  const errors: string[] = [];
  for (const [path, target] of Object.entries(HARNESS_LINKS)) {
    const absolute = join(root, path);
    if (!present(absolute)) {
      errors.push(`${path}: ausente; deve ser symlink para ${target}`);
    } else if (!isLink(absolute)) {
      errors.push(`${path}: é cópia, não symlink — substitua por \`ln -s ${target} ${path}\` e edite só a fonte canônica`);
    } else if (readlinkSync(absolute) !== target) {
      errors.push(`${path}: aponta para ${readlinkSync(absolute)}; esperado ${target}`);
    } else if (!existsSync(absolute)) {
      errors.push(`${path}: symlink quebrado — ${target} não existe`);
    }
  }
  const entry = join(root, ENTRY);
  for (const path of HARNESS_INSTRUCTION_PATHS) {
    const absolute = join(root, path);
    if (!present(absolute)) continue;
    const pointsToEntry = isLink(absolute) && existsSync(absolute) && realpathSync(absolute) === realpathSync(entry);
    if (!pointsToEntry) {
      errors.push(`${path}: instrução duplicada por harness — remova; ${ENTRY} é a única fonte autoral`);
    }
  }
  return errors;
}

/** Slug de título no formato do GitHub, que é quem resolve `arquivo.md#ancora`. */
export function headingSlug(heading: string): string {
  return heading
    .trim()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Tag HTML sai; `<tipo>` dentro de código em linha é texto e fica.
    .replace(/`([^`]*)`|<[^>]*>/g, (_, code: string | undefined) => code ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** `text` sem código em linha, para achar links; `raw` intacta, para títulos. */
type Line = { number: number; text: string; raw: string };

/** Linhas fora de bloco cercado. */
function proseLines(markdown: string): Line[] {
  const lines: Line[] = [];
  let fenced = false;
  markdown.split("\n").forEach((raw, index) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (!fenced) lines.push({ number: index + 1, text: raw.replace(/`[^`\n]*`/g, ""), raw });
  });
  return lines;
}

export function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const { text, raw } of proseLines(markdown)) {
    for (const match of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1]!);
    // O GitHub gera o slug com o texto do código em linha, sem as crases.
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (!heading) continue;
    const slug = headingSlug(heading[1]!);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

type Reference = { line: number; label: string; target: string };

export function referencesOf(markdown: string): Reference[] {
  const references: Reference[] = [];
  for (const { number, text } of proseLines(markdown)) {
    for (const match of text.matchAll(/\[([^[\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      references.push({ line: number, label: match[1]!, target: match[2]! });
    }
  }
  return references;
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;
/** Rótulo que é ID de regra: `G43`, `R24`. */
const RULE_ID = /^[GR]\d+$/;

export function checkReferences(root: string, documents: readonly string[]): string[] {
  const errors: string[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchorsAt = (absolute: string) => {
    let anchors = anchorCache.get(absolute);
    if (!anchors) {
      anchors = anchorsOf(readFileSync(absolute, "utf8"));
      anchorCache.set(absolute, anchors);
    }
    return anchors;
  };

  for (const document of documents) {
    const source = join(root, document);
    for (const { line, label, target } of referencesOf(readFileSync(source, "utf8"))) {
      if (EXTERNAL.test(target)) continue;
      const where = `${document}:${line}`;
      const [path, rawAnchor] = target.split("#", 2) as [string, string | undefined];
      const destination = path === "" ? source : resolve(dirname(source), decodeURIComponent(path));
      if (!existsSync(destination)) {
        errors.push(`${where}: link para "${target}" — ${relative(root, destination)} não existe`);
        continue;
      }
      if (rawAnchor === undefined) {
        if (RULE_ID.test(label)) errors.push(`${where}: [${label}] aponta para "${target}" sem âncora do ID`);
        continue;
      }
      const anchor = decodeURIComponent(rawAnchor);
      if (destination.endsWith(".md") && !anchorsAt(destination).has(anchor)) {
        errors.push(`${where}: âncora "#${anchor}" não existe em ${relative(root, destination)}`);
        continue;
      }
      const id = label.toLowerCase();
      if (RULE_ID.test(label) && anchor !== id && !anchor.startsWith(`${id}-`)) {
        errors.push(`${where}: [${label}] aponta para "#${anchor}" — o rótulo e a âncora precisam ser o mesmo ID`);
      }
    }
  }
  return errors;
}

/**
 * O inventário de `rules/README.md` é o mapa de equivalência: cada ID tem uma
 * linha e UM destino primário, e toda âncora de regra tem linha no inventário.
 */
export function checkInventory(root: string): string[] {
  const errors: string[] = [];
  const rows = new Map<string, number>();
  for (const { number, text } of proseLines(readFileSync(join(root, INVENTORY), "utf8"))) {
    const row = /^\|\s*(G\d+)\s*\|/.exec(text);
    if (!row) continue;
    const id = row[1]!;
    if (rows.has(id)) errors.push(`${INVENTORY}:${number}: ${id} repetido no inventário (linha ${rows.get(id)})`);
    rows.set(id, number);
    const link = /\]\([^)#\s]+#([^)\s]+)\)/.exec(text);
    if (!link || link[1] !== id.toLowerCase()) {
      errors.push(`${INVENTORY}:${number}: a linha de ${id} precisa apontar para a âncora #${id.toLowerCase()}`);
    }
  }

  const defined = new Map<string, string>();
  for (const document of checkedDocuments(root)) {
    if (document === INVENTORY || !document.startsWith(`${RULES_DIRECTORY}/`)) continue;
    for (const { number, text } of proseLines(readFileSync(join(root, document), "utf8"))) {
      for (const match of text.matchAll(/<a\s+id="(g\d+)"/g)) {
        const id = match[1]!.toUpperCase();
        const where = `${document}:${number}`;
        const previous = defined.get(id);
        if (previous) errors.push(`${where}: ${id} já é definida em ${previous} — cada obrigação tem um destino primário`);
        else defined.set(id, where);
        if (!rows.has(id)) errors.push(`${where}: ${id} não tem linha no inventário de ${INVENTORY}`);
      }
    }
  }
  return errors;
}

export function checkInstructions(root: string): string[] {
  return [
    ...checkHarnessLinks(root),
    ...checkReferences(root, checkedDocuments(root)),
    ...checkInventory(root),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const errors = checkInstructions(process.cwd());
  if (errors.length > 0) {
    console.error(`Fonte canônica das instruções com ${errors.length} problema(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Instruções: symlinks dos harnesses, links, âncoras e inventário de regras conferem.");
  }
}
