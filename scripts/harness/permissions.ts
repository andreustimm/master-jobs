// Política de permissões dos três harnesses a partir de UMA fonte (G85).
//
// `.claude/settings.json` é a lista autoral de allow/ask/deny. O OpenCode
// recebe a tradução gerada em `opencode.json`; o Codex, que não tem lista de
// permissões por padrão de texto, aplica a mesma lista por hook
// (`codex-guard.ts`). Duas listas escritas à mão divergiriam no primeiro
// comando novo; uma lista e dois tradutores só divergem se o tradutor quebrar,
// e isso o teste vê.
//
// Funções puras: sem disco, sem rede, sem relógio.

export type Decision = "allow" | "ask" | "deny";

export type ClaudePermissions = {
  allow?: readonly string[];
  ask?: readonly string[];
  deny?: readonly string[];
};

export type Rule = { tool: string; specifier: string | null; decision: Decision };

const DECISIONS: readonly Decision[] = ["allow", "ask", "deny"];
const RULE = /^([A-Za-z]+)(?:\((.*)\))?$/s;

export function parseRules(permissions: ClaudePermissions): Rule[] {
  const rules: Rule[] = [];
  for (const decision of DECISIONS) {
    for (const entry of permissions[decision] ?? []) {
      const match = RULE.exec(entry);
      if (!match) throw new Error(`regra de permissão ilegível: ${entry}`);
      rules.push({ tool: match[1]!, specifier: match[2] ?? null, decision });
    }
  }
  return rules;
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\/-]/g, "\\$&");
}

/** `Bash(prefixo:*)`, `Bash(com * curinga)` ou `Bash(exato)`, como o Claude Code lê. */
export function bashSpecifierMatches(specifier: string, command: string): boolean {
  if (specifier.endsWith(":*")) {
    const prefix = specifier.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  if (specifier.includes("*")) {
    const pattern = specifier.split("*").map(escapeRegex).join(".*");
    return new RegExp(`^${pattern}$`, "s").test(command);
  }
  return command === specifier;
}

/**
 * O comando inteiro e cada trecho de um comando composto: `cd x && git push
 * origin main` precisa cair na regra de `git push` mesmo sem começar por ela.
 */
export function commandSegments(command: string): string[] {
  const whole = command.trim();
  const parts = whole
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return [...new Set([whole, ...parts])];
}

/**
 * Decisão mais restritiva entre as regras de `Bash` que casam: deny vence ask,
 * que vence allow — a mesma precedência do Claude Code. `null` quando nenhuma
 * regra casa (o harness aplica o próprio padrão).
 */
export function decideCommand(rules: readonly Rule[], command: string): Decision | null {
  const segments = commandSegments(command);
  let found: Decision | null = null;
  for (const rule of rules) {
    if (rule.tool !== "Bash") continue;
    const matches =
      rule.specifier === null || segments.some((segment) => bashSpecifierMatches(rule.specifier!, segment));
    if (matches && strength(rule.decision) > strength(found)) found = rule.decision;
  }
  return found;
}

function strength(decision: Decision | null): number {
  return decision === null ? -1 : DECISIONS.indexOf(decision);
}

/** Padrão de arquivo no estilo gitignore do Claude Code (`**`, `*`, `?`). */
export function globToRegex(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`, "s");
}

export type PathContext = { root: string; home: string };

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/**
 * `./x` é relativo à raiz do projeto, `~/x` ao diretório pessoal e o padrão sem
 * âncora casa em qualquer profundidade — como no gitignore. `path` é absoluto.
 */
export function pathSpecifierMatches(specifier: string, absolutePath: string, context: PathContext): boolean {
  const path = normalize(absolutePath);
  const within = (base: string): string | null => {
    const prefix = `${normalize(base)}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : null;
  };
  if (specifier.startsWith("./")) {
    const relative = within(context.root);
    return relative !== null && globToRegex(specifier.slice(2)).test(relative);
  }
  if (specifier.startsWith("~/")) {
    const relative = within(context.home);
    return relative !== null && globToRegex(specifier.slice(2)).test(relative);
  }
  if (specifier.startsWith("//")) return globToRegex(specifier.slice(1)).test(path);
  return globToRegex(`**/${specifier}`).test(path);
}

export function decidePath(
  rules: readonly Rule[],
  tool: "Read" | "Edit",
  absolutePath: string,
  context: PathContext,
): Decision | null {
  let found: Decision | null = null;
  for (const rule of rules) {
    if (rule.tool !== tool) continue;
    const matches = rule.specifier === null || pathSpecifierMatches(rule.specifier, absolutePath, context);
    if (matches && strength(rule.decision) > strength(found)) found = rule.decision;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Tradução para o OpenCode

/**
 * Ferramenta do Claude Code → permissão do OpenCode. Ferramenta sem tradução
 * reprova a geração: ignorá-la deixaria o OpenCode mais permissivo em silêncio.
 */
export const OPENCODE_TOOL: Readonly<Record<string, readonly string[]>> = {
  Bash: ["bash"],
  Read: ["read"],
  Edit: ["edit"],
  Write: ["edit"],
  Glob: ["glob", "list"],
  Grep: ["grep"],
  WebFetch: ["webfetch"],
  WebSearch: ["websearch"],
};

/** Ferramentas que o Claude Code pergunta antes de usar quando nada as libera. */
const ASK_BY_DEFAULT = new Set(["bash", "edit", "webfetch", "websearch"]);

/**
 * Padrão de arquivo do Claude → padrões do OpenCode. No OpenCode `*` casa
 * qualquer caractere, inclusive `/`, e não há âncora de raiz: cada padrão
 * ancorado vira a forma relativa e a forma "em qualquer diretório". O
 * resultado nunca é mais estreito que o original — para `deny` e `ask`, errar
 * para o lado largo é o único erro aceitável.
 */
export function openCodePathPatterns(specifier: string): string[] {
  if (specifier.startsWith("~/")) return [specifier.replace(/\*\*/g, "*")];
  let rest = specifier.startsWith("./") ? specifier.slice(2) : specifier.replace(/^\/+/, "");
  if (rest.startsWith("**/")) rest = rest.slice(3);
  rest = rest.replace(/\*\*/g, "*");
  return rest.startsWith("*") ? [rest] : [rest, `*/${rest}`];
}

/** `Bash(git:*)` → `git *`; curinga e comando exato passam como estão. */
export function openCodeBashPattern(specifier: string): string {
  return specifier.endsWith(":*") ? `${specifier.slice(0, -2)} *` : specifier;
}

type OpenCodeRules = Record<string, Decision>;
export type OpenCodePermission = Record<string, Decision | OpenCodeRules>;

/** No OpenCode vence a ÚLTIMA regra que casa; reinsere para mover ao fim. */
function place(rules: OpenCodeRules, pattern: string, decision: Decision): void {
  delete rules[pattern];
  rules[pattern] = decision;
}

/**
 * Gera `permission` do `opencode.json`. A ordem reproduz a precedência do
 * Claude Code (deny > ask > allow) dentro da regra do OpenCode (a última que
 * casa vence): padrão da ferramenta, depois allow, ask e deny.
 */
export function toOpenCodePermission(permissions: ClaudePermissions): OpenCodePermission {
  const rules = parseRules(permissions);
  const tools = new Map<string, OpenCodeRules>();
  const bucket = (tool: string): OpenCodeRules => {
    let entry = tools.get(tool);
    if (!entry) {
      entry = { "*": ASK_BY_DEFAULT.has(tool) ? "ask" : "allow" };
      tools.set(tool, entry);
    }
    return entry;
  };
  for (const tool of ["read", "edit", "glob", "list", "grep", "webfetch", "websearch", "bash"]) bucket(tool);

  for (const decision of DECISIONS) {
    for (const rule of rules) {
      if (rule.decision !== decision) continue;
      const targets = OPENCODE_TOOL[rule.tool];
      if (!targets) throw new Error(`ferramenta ${rule.tool} sem tradução para o OpenCode (scripts/harness/permissions.ts)`);
      for (const tool of targets) {
        const entry = bucket(tool);
        if (rule.specifier === null) {
          for (const pattern of Object.keys(entry)) delete entry[pattern];
          entry["*"] = decision;
        } else if (tool === "bash") {
          place(entry, openCodeBashPattern(rule.specifier), decision);
        } else {
          for (const pattern of openCodePathPatterns(rule.specifier)) place(entry, pattern, decision);
        }
      }
    }
  }

  const permission: OpenCodePermission = {};
  for (const [tool, entry] of tools) {
    const patterns = Object.keys(entry);
    permission[tool] = patterns.length === 1 && patterns[0] === "*" ? entry["*"]! : entry;
  }
  // Fora da árvore do projeto o Claude Code pergunta; o OpenCode também.
  permission.external_directory = "ask";
  return permission;
}
