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
 * Prefixo que o Codex e o OpenCode põem em todo comando (G63). No Claude Code
 * o hook global do rtk reescreve DEPOIS da decisão de permissão, então a regra
 * vê `sudo ls`; nos outros dois o comando chega como `rtk sudo ls`, e uma regra
 * ancorada no início (`sudo *`, `rm:*`) deixaria de casar.
 */
/**
 * Invólucros que executam o comando seguinte sem mudar o que ele faz. Sem
 * tirá-los, `env rm -rf src` ou `timeout -s KILL 5 rm -rf src` escapariam de
 * `rm:*`.
 */
const WRAPPERS = new Set(["env", "command", "exec", "nohup", "time", "nice", "timeout", "stdbuf", "ionice"]);

/** Opção, número/duração, sinal (`KILL`) ou atribuição logo depois de um invólucro. */
const WRAPPER_ARGUMENT = /^(?:-|\d|[A-Z]+$|[A-Za-z_][A-Za-z0-9_]*=)/;

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Tira, até estabilizar, o prefixo `rtk`/`rtk proxy` (G63: no Claude Code o
 * hook do rtk reescreve DEPOIS da decisão, então a regra vê `sudo ls`),
 * atribuição de variável, invólucro com suas opções e o diretório do
 * executável (`/bin/rm` → `rm`).
 */
function unwrap(segment: string): string {
  const tokens = segment.split(/\s+/).filter((token) => token !== "");
  for (let changed = true; changed && tokens.length > 0; ) {
    changed = true;
    const head = tokens[0]!;
    if (head === "rtk") {
      tokens.shift();
      if (tokens[0] === "proxy") tokens.shift();
    } else if (ASSIGNMENT.test(head)) {
      tokens.shift();
    } else if (WRAPPERS.has(head)) {
      tokens.shift();
      while (tokens.length > 1 && WRAPPER_ARGUMENT.test(tokens[0]!)) tokens.shift();
    } else if (head.startsWith("/") && head.lastIndexOf("/") < head.length - 1) {
      tokens[0] = head.slice(head.lastIndexOf("/") + 1);
    } else {
      changed = false;
    }
  }
  return tokens.join(" ");
}

/**
 * Esconde o conteúdo de aspas simples (fora de aspas duplas), onde o shell não
 * interpreta nada: cortar ali faria de uma mensagem de commit um comando.
 * Aspas simples sem fechar devolvem o texto intacto — na dúvida, julga tudo.
 */
function maskSingleQuoted(text: string): string {
  let out = "";
  let state: "none" | "single" | "double" = "none";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (state === "single") {
      if (char === "'") state = "none";
      out += char === "'" ? char : " ";
    } else if (char === "\\" && index + 1 < text.length) {
      out += char + text[++index]!;
    } else if (state === "double") {
      if (char === '"') state = "none";
      out += char;
    } else {
      if (char === "'") state = "single";
      else if (char === '"') state = "double";
      out += char;
    }
  }
  return state === "single" ? text : out;
}

/** O que um shell aninhado vai rodar: `sh -ec 'rm -rf src'` → `rm -rf src`. */
const NESTED_SHELL = /(?:^|\s)(?:ba|z|da|k)?sh\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*c[A-Za-z]*\s+(['"])([\s\S]*?)\1/g;

/**
 * O comando inteiro e cada trecho dele: `cd x && git push origin main` precisa
 * cair na regra de `git push` mesmo sem começar por ela. Além de `&&`, `||`,
 * `;` e `|`, corta em `&`, subshell, chaves, `$(`, crase e substituição de
 * processo — fora de aspas simples, onde o shell não interpreta nada e cortar
 * faria de uma mensagem de commit um comando. Cada trecho vale também sem
 * `rtk`, sem invólucro e sem o caminho do executável, e o corpo de `sh -c`
 * entra como comando próprio. Trecho a mais só acrescenta decisão mais forte.
 */
export function commandSegments(command: string, depth = 0): string[] {
  const whole = command.trim();
  const parts = maskSingleQuoted(whole)
    .split(/&&|\|\||\$\(|[<>]\(|[;|&\n(){}`]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const segments = [whole, ...parts];
  const nested =
    depth < 2 ? [...whole.matchAll(NESTED_SHELL)].flatMap((match) => commandSegments(match[2]!, depth + 1)) : [];
  return [...new Set([...segments, ...segments.map(unwrap), ...nested])];
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

/** Ferramentas cujo especificador é caminho de arquivo, no estilo gitignore. */
const PATH_TOOLS = new Set(["Read", "Edit", "Write"]);

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
  for (const tool of new Set(Object.values(OPENCODE_TOOL).flat())) bucket(tool);

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
          const pattern = openCodeBashPattern(rule.specifier);
          place(entry, pattern, decision);
          // O OpenCode recebe `rtk sudo ls` (G63); restrição ancorada no
          // início precisa valer também depois do prefixo. Allow não ganha a
          // variante: alargar o que é liberado não é tradução.
          if (decision !== "allow" && !pattern.startsWith("*")) {
            place(entry, `rtk ${pattern}`, decision);
            place(entry, `rtk proxy ${pattern}`, decision);
          }
        } else if (PATH_TOOLS.has(rule.tool)) {
          for (const pattern of openCodePathPatterns(rule.specifier)) place(entry, pattern, decision);
        } else {
          // `WebFetch(domain:x)` não é caminho: traduzido como tal, o deny
          // viraria um padrão que nunca casa com a URL e sumiria em silêncio.
          throw new Error(`regra ${rule.tool}(${rule.specifier}) sem tradução para o OpenCode (scripts/harness/permissions.ts)`);
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
