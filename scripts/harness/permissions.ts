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
 * Esconde o texto literal entre aspas — simples, e duplas fora de `$(…)` e
 * crase, que o shell executa —: cortar ali faria de `git commit -m "fix(x)"`
 * um comando. Na dúvida, julga tudo: aspas sem fechar, aspas `$'…'` (onde
 * `\'` não fecha) e comentário `#` (que o shell corta até o fim da linha,
 * mudando o que conta como aspas) devolvem o texto intacto, sem máscara.
 */
function maskQuoted(text: string): string {
  let out = "";
  // `subst` é `$(…)` dentro de aspas duplas e `tick` é crase dentro delas:
  // ali o shell executa, então o texto fica visível para ser julgado.
  let state: "none" | "single" | "double" | "subst" | "tick" = "none";
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (state === "none" && char === "$" && text[index + 1] === "'") return text;
    if (state === "none" && char === "#" && (index === 0 || /[\s;&|()]/.test(text[index - 1]!))) return text;
    // Heredoc sem aspas no delimitador: o corpo não obedece às aspas da linha
    // (um apóstrofo ali abriria uma máscara que o shell não vê).
    if (state === "none" && text.startsWith("<<", index) && !/^<<(?:<|-?\s*['"])/.test(text.slice(index))) return text;
    if (state === "single") {
      if (char === "'") state = "none";
      out += char === "'" ? char : " ";
    } else if (state === "subst") {
      if (char === "(") depth++;
      if (char === ")" && --depth === 0) state = "double";
      out += char;
    } else if (state === "tick") {
      if (char === "`") state = "double";
      out += char;
    } else if (state === "double") {
      if (char === "\\" && index + 1 < text.length) {
        out += "  ";
        index++;
      } else if (char === '"') {
        state = "none";
        out += char;
      } else if (char === "$" && text[index + 1] === "(") {
        state = "subst";
        depth = 1;
        out += "$(";
        index++;
      } else if (char === "`") {
        state = "tick";
        out += char;
      } else {
        out += " ";
      }
    } else if (char === "\\" && index + 1 < text.length) {
      out += char + text[++index]!;
    } else {
      if (char === "'") state = "single";
      else if (char === '"') state = "double";
      out += char;
    }
  }
  return state === "none" ? out : text;
}

/** O que um shell aninhado vai rodar: `sh -ec 'rm -rf src'` → `rm -rf src`. */
const NESTED_SHELL = /(?:^|\s)(?:ba|z|da|k)?sh\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*c[A-Za-z]*\s+(['"])([\s\S]*?)\1/g;

/**
 * O comando inteiro e cada trecho dele: `cd x && git push origin main` precisa
 * cair na regra de `git push` mesmo sem começar por ela. Além de `&&`, `||`,
 * `;` e `|`, corta em `&`, subshell, chaves, `$(`, crase e substituição de
 * processo — fora do texto literal entre aspas e de heredoc com delimitador
 * entre aspas, onde cortar faria de uma mensagem de commit um comando. Cada
 * trecho vale também sem `rtk`, sem invólucro e sem o caminho do executável,
 * e o corpo de `sh -c` entra como comando próprio. Trecho a mais só acrescenta
 * decisão mais forte.
 */
export function commandSegments(command: string, depth = 0): string[] {
  const whole = command.trim();
  const parts = splitParts(whole);
  const segments = [whole, ...parts];
  const nested =
    depth < 2 ? [...whole.matchAll(NESTED_SHELL)].flatMap((match) => commandSegments(match[2]!, depth + 1)) : [];
  // Aspas em volta de UMA palavra e redirecionamento não mudam o alvo:
  // `git push origin 'main'` e `cat <.env` precisam cair em `* main` e
  // `* .env` como a forma nua. Texto com espaço entre aspas continua texto.
  const bare = segments.map((segment) => segment.replace(/(['"])([^\s'"]*)\1/g, "$2").replace(/[<>]/g, " "));
  return [...new Set([...segments, ...segments.map(unwrap), ...bare, ...bare.map(unwrap), ...nested])];
}

/**
 * Redirecionamento que usa `&` (`2>&1`, `>&2`, `&>`, `&>>`) não separa
 * comandos: vira espaço antes do corte em `&`.
 */
const AMPERSAND_REDIRECT = /\d*>&(?:\d+|-)|&>>?/g;

function splitParts(command: string): string[] {
  return maskQuoted(maskQuotedHeredocs(command))
    .replace(AMPERSAND_REDIRECT, " ")
    .split(/&&|\|\||\$\(|[<>]\(|[;|&\n(){}`]/)
    .map((part) => part.trim())
    // Sobra de aspas (o `"` depois de `$(…)`) não é comando.
    .filter((part) => part.replace(/['"\s]/g, "").length > 0);
}

/**
 * Esconde o corpo de heredoc com delimitador entre aspas (`<<'EOF'`), que o
 * shell não expande: é texto, como `-m "…"`. Heredoc sem aspas expande `$(…)`
 * e fica visível; delimitador sem linha de fechamento devolve o texto intacto.
 */
function maskQuotedHeredocs(text: string): string {
  const opener = /<<(-?)\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2/g;
  let out = text;
  for (const match of text.matchAll(opener)) {
    const bodyStart = out.indexOf("\n", match.index! + match[0].length);
    if (bodyStart === -1) return text;
    const lines = out.slice(bodyStart + 1).split("\n");
    const close = lines.findIndex((line) => (match[1] === "-" ? line.replace(/^\t+/, "") : line) === match[3]);
    if (close === -1) return text;
    // A linha do delimitador também sai: `EOF` sozinho não é comando.
    const body = lines.slice(0, close + 1).join("\n");
    out = out.slice(0, bodyStart + 1) + body.replace(/[^\n]/g, " ") + out.slice(bodyStart + 1 + body.length);
  }
  return out;
}

/**
 * Comando que o Claude Code libera sem lista: `cd` só muda o diretório do
 * próprio shell. Nada mais entra aqui — o resto precisa de allow escrito.
 */
const BUILTIN_ALLOWED = new Set(["cd"]);

/**
 * Decisão do Claude Code para o comando, com a precedência dele: deny vence
 * ask, que vence allow, e o comando composto só é `allow` quando TODO trecho
 * é liberado por uma regra — trecho que nenhuma regra libera é `ask`, como no
 * Claude, onde o padrão é perguntar. Isso fecha, de uma vez, toda forma de
 * esconder um comando atrás de outro (invólucro, shell, `eval`, palavra
 * reservada, aspas `$'…'`): o que a leitura não reconhece como liberado,
 * pergunta. O prefixo `rtk` sai antes de conferir o allow (G63).
 */
export function decideCommand(rules: readonly Rule[], command: string): Decision {
  const bash = rules.filter((rule) => rule.tool === "Bash");
  const segments = commandSegments(command);
  let found: Decision | null = null;
  for (const rule of bash) {
    if (rule.decision === "allow") continue;
    const matches =
      rule.specifier === null || segments.some((segment) => bashSpecifierMatches(rule.specifier!, segment));
    if (matches && strength(rule.decision) > strength(found)) found = rule.decision;
  }
  if (found !== null) return found;
  const allowed = (part: string): boolean => {
    const candidates = [part, part.replace(/^rtk\s+(?:proxy\s+)?/, "")];
    if (BUILTIN_ALLOWED.has(candidates[1]!.split(/\s+/)[0]!)) return true;
    return bash.some(
      (rule) =>
        rule.decision === "allow" &&
        (rule.specifier === null || candidates.some((candidate) => bashSpecifierMatches(rule.specifier!, candidate))),
    );
  };
  const parts = splitParts(command.trim());
  return parts.length > 0 && parts.every(allowed) ? "allow" : "ask";
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
