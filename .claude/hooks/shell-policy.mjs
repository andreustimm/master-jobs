// Política de shell dos três harnesses (#461; G63, G85): UMA implementação,
// três chamadores — o hook do Claude Code (`.claude/hooks/no-compound-bash.mjs`),
// a guarda do Codex (`scripts/harness/codex-guard.ts`) e o plugin do OpenCode
// (`.opencode/plugins/shell-guard.js`).
//
// JavaScript puro, sem dependência: o hook do Claude roda em `node` sem
// strip-types, a guarda do Codex importa daqui e o plugin roda no Bun do
// OpenCode.
//
// - `findCompound`: um comando por chamada. Pipe só quando todo estágio lê;
//   laço `for`/`while`/`until`/`if`/`case` aceita `;` e quebra de linha, e o
//   corpo continua julgado comando a comando.
// - `classifyRisk`: o que pergunta (`ask`) ou é negado (`deny`), julgado por
//   token — a fonte de verdade do risco de shell. `.claude/settings.json` não
//   repete esta lista em `ask`; guarda só o `deny` ancorado de reserva.
// - `judgeShell`: as duas coisas e, em laço, cada comando do corpo contra a
//   lista `allow` do `.claude/settings.json`.

/** @typedef {"ask" | "deny"} RiskDecision */
/** @typedef {{ decision: RiskDecision, reason: string }} Risk */
/** @typedef {{ decision: RiskDecision, reason: string, kind: "compound" | "risk" | "body" }} ShellVerdict */
/** @typedef {{ allow: (string | null)[], ask: (string | null)[], deny: (string | null)[] }} BashRules */

// ---------------------------------------------------------------------------
// Leitura do shell: palavras, operadores, redirecionamentos e heredoc

const BLANK = new Set([" ", "\t", "\r"]);
const ANSI_ESCAPES = { a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", t: "\t", r: "\r", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };

/**
 * Um escape de `$'…'` a partir da barra em `text[at]`, como o bash decodifica:
 * `\x6d`, `\155`, `m` e `\cM` também viram o caractere — `$'\x6dain'` é
 * `main`. Devolve o texto e o índice do último caractere consumido.
 */
function ansiEscape(text, at) {
  const c = text[at + 1];
  const digits = (pattern, max, from) => {
    let end = from;
    while (end < text.length && end - from < max && pattern.test(text[end])) end++;
    return end;
  };
  if (/[0-7]/.test(c)) {
    const end = digits(/[0-7]/, 3, at + 1);
    return { value: String.fromCharCode(parseInt(text.slice(at + 1, end), 8) & 0xff), last: end - 1 };
  }
  const hex = { x: 2, u: 4, U: 8 }[c];
  if (hex) {
    const end = digits(/[0-9A-Fa-f]/, hex, at + 2);
    if (end === at + 2) return { value: `\\${c}`, last: at + 1 };
    return { value: String.fromCodePoint(Math.min(parseInt(text.slice(at + 2, end), 16), 0x10ffff)), last: end - 1 };
  }
  if (c === "c" && at + 2 < text.length) return { value: String.fromCharCode(text.charCodeAt(at + 2) & 0x1f), last: at + 2 };
  return { value: ANSI_ESCAPES[c] ?? `\\${c}`, last: at + 1 };
}
const SUBST = "$(...) (substituição de comando)";
const BACKTICK = "crase (substituição de comando)";
const PROCESS = "<(...) (substituição de processo)";

function closeBacktick(text, open) {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "`") return i;
  }
  return text.length;
}

function closeDouble(text, open) {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
    else if (text[i] === "$" && text[i + 1] === "(") i = closeParen(text, i + 1);
    else if (text[i] === "`") i = closeBacktick(text, i);
  }
  return text.length;
}

/** Índice do `)` que fecha o `(` em `open`, respeitando aspas e aninhamento. */
function closeParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) return text.length;
      i = end;
    } else if (c === '"') i = closeDouble(text, i);
    else if (c === "`") i = closeBacktick(text, i);
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return text.length;
}

/** `$(…)` e crase no corpo de heredoc sem aspas no delimitador: o shell executa. */
function bodySubstitutions(body) {
  const found = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") i++;
    else if (body[i] === "$" && body[i + 1] === "(") {
      const end = closeParen(body, i + 1);
      found.push({ kind: SUBST, inner: body.slice(i + 2, end) });
      i = end;
    } else if (body[i] === "`") {
      const end = closeBacktick(body, i);
      found.push({ kind: BACKTICK, inner: body.slice(i + 1, end) });
      i = end;
    }
  }
  return found;
}

/**
 * Tokens do comando, como o shell os vê: palavras já sem aspas (com o texto
 * de `$(…)`, crase e `<(…)` guardado em `subs`), operadores de controle,
 * redirecionamentos e heredocs (com o corpo). Comentário `#` no início de
 * palavra vai até o fim da linha.
 */
export function lex(text) {
  const tokens = [];
  /** @type {string[]} */
  const substitutions = [];
  const pending = [];
  let heredoc = false;
  let word = null;
  const begin = () => (word ??= { type: "word", value: "", subs: [] });
  const flush = () => {
    if (word) tokens.push(word);
    word = null;
  };
  const substitute = (kind, inner) => {
    substitutions.push(kind);
    begin().subs.push(inner);
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "\\") {
      if (next !== "\n") begin().value += next ?? "";
      i += 2;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      begin().value += text.slice(i + 1, stop);
      i = stop + 1;
    } else if (c === "$" && next === "'") {
      begin();
      let j = i + 2;
      for (; j < text.length && text[j] !== "'"; j++) {
        if (text[j] === "\\" && j + 1 < text.length) {
          const escape = ansiEscape(text, j);
          word.value += escape.value;
          j = escape.last;
        } else word.value += text[j];
      }
      i = j + 1;
    } else if (c === '"') {
      begin();
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        const d = text[j];
        if (d === "\\" && j + 1 < text.length) {
          const e = text[j + 1];
          if (e !== "\n") word.value += '"\\$`'.includes(e) ? e : d + e;
          j += 2;
        } else if (d === "$" && text[j + 1] === "(") {
          const end = closeParen(text, j + 1);
          substitute(SUBST, text.slice(j + 2, end));
          word.value += text.slice(j, end + 1);
          j = end + 1;
        } else if (d === "`") {
          const end = closeBacktick(text, j);
          substitute(BACKTICK, text.slice(j + 1, end));
          word.value += text.slice(j, end + 1);
          j = end + 1;
        } else {
          word.value += d;
          j++;
        }
      }
      i = j + 1;
    } else if (c === "$" && next === "(") {
      const end = closeParen(text, i + 1);
      substitute(SUBST, text.slice(i + 2, end));
      word.value += text.slice(i, end + 1);
      i = end + 1;
    } else if (c === "`") {
      const end = closeBacktick(text, i);
      substitute(BACKTICK, text.slice(i + 1, end));
      word.value += text.slice(i, end + 1);
      i = end + 1;
    } else if ((c === "<" || c === ">") && next === "(") {
      const end = closeParen(text, i + 1);
      substitute(PROCESS, text.slice(i + 2, end));
      word.value += text.slice(i, end + 1);
      i = end + 1;
    } else if (c === "#" && word === null) {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (BLANK.has(c)) {
      flush();
      i++;
    } else if (c === "\n") {
      flush();
      tokens.push({ type: "op", value: "\n" });
      i = readHeredocBodies(text, i + 1, pending, substitutions);
    } else if (c === ";") {
      flush();
      const op = next === ";" ? ";;" : ";";
      tokens.push({ type: "op", value: op });
      i += op.length;
    } else if (c === "&") {
      flush();
      if (next === "&") {
        tokens.push({ type: "op", value: "&&" });
        i += 2;
      } else if (next === ">") {
        const op = text[i + 2] === ">" ? "&>>" : "&>";
        tokens.push({ type: "redir", value: op });
        i += op.length;
      } else {
        tokens.push({ type: "op", value: "&" });
        i++;
      }
    } else if (c === "|") {
      flush();
      const op = next === "|" ? "||" : next === "&" ? "|&" : "|";
      tokens.push({ type: "op", value: op });
      i += op.length;
    } else if (c === "(" || c === ")") {
      flush();
      tokens.push({ type: "op", value: c });
      i++;
    } else if (c === "<" || c === ">") {
      // `2>` e `2>&1`: o número colado é o descritor, não argumento.
      if (word && /^\d+$/.test(word.value) && word.subs.length === 0) word = null;
      else flush();
      const op = ["<<<", "<<-", "<<", ">>", ">&", "<&", ">|", "<>"].find((candidate) => text.startsWith(candidate, i)) ?? c;
      i += op.length;
      if (op === "<<" || op === "<<-") {
        heredoc = true;
        while (BLANK.has(text[i])) i++;
        let delimiter = "";
        let quoted = false;
        while (i < text.length && !BLANK.has(text[i]) && !"\n;|&<>()".includes(text[i])) {
          const d = text[i];
          if (d === "'" || d === '"') {
            quoted = true;
            const end = text.indexOf(d, i + 1);
            const stop = end === -1 ? text.length : end;
            delimiter += text.slice(i + 1, stop);
            i = stop + 1;
          } else if (d === "\\") {
            quoted = true;
            delimiter += text[i + 1] ?? "";
            i += 2;
          } else {
            delimiter += d;
            i++;
          }
        }
        const token = { type: "heredoc", quoted, strip: op === "<<-", delimiter, body: "", subs: [] };
        tokens.push(token);
        pending.push(token);
      } else {
        tokens.push({ type: "redir", value: op });
      }
    } else {
      // Curinga fora de aspas: o shell expande (`.en?` pode virar `.env`).
      if (c === "*" || c === "?" || c === "[") begin().glob = true;
      begin().value += c;
      i++;
    }
  }
  flush();
  return { tokens, substitutions, heredoc };
}

function readHeredocBodies(text, start, pending, substitutions) {
  let i = start;
  while (pending.length > 0) {
    const token = pending.shift();
    const lines = [];
    while (i < text.length) {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      const line = text.slice(i, stop);
      i = stop + 1;
      if ((token.strip ? line.replace(/^\t+/, "") : line) === token.delimiter) break;
      lines.push(line);
    }
    token.body = lines.join("\n");
    if (!token.quoted) {
      for (const found of bodySubstitutions(token.body)) {
        substitutions.push(found.kind);
        token.subs.push(found.inner);
      }
    }
  }
  return Math.min(i, text.length);
}

// ---------------------------------------------------------------------------
// Comandos simples e palavras reservadas

const PREFIX_WORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{"]);
const CLOSER_WORDS = new Set(["done", "fi", "esac", "}"]);
const OPENER_WORDS = new Set(["for", "select", "while", "until", "if", "case"]);
const HEADER_WORDS = new Set(["for", "select", "case"]);

function leadingReserved(raw) {
  let k = 0;
  while (k < raw.length && (PREFIX_WORDS.has(raw[k]) || CLOSER_WORDS.has(raw[k]))) k++;
  return k;
}

/**
 * O comando que o shell roda numa linha de laço: sem palavras reservadas à
 * esquerda (`do`, `then`, `while`…); `done`/`fi` e o cabeçalho de
 * `for`/`select`/`case` não são comando.
 */
export function commandWords(raw) {
  const rest = raw.slice(leadingReserved(raw));
  return HEADER_WORDS.has(rest[0]) ? [] : rest;
}

/** Quanto a linha abre (`for`, `if`…) ou fecha (`done`, `fi`, `esac`) de laço. */
function depthDelta(raw) {
  let delta = 0;
  for (const word of raw) {
    if (OPENER_WORDS.has(word)) {
      delta++;
      if (HEADER_WORDS.has(word)) break;
    } else if (CLOSER_WORDS.has(word) && word !== "}") delta--;
    else if (!PREFIX_WORDS.has(word)) break;
  }
  return delta;
}

/**
 * Comandos simples na ordem, cada um com o operador que veio antes dele
 * (`before`): `|` diz que ele recebe a saída do anterior. Padrão de `case`
 * (`a|b)`) não vira comando.
 */
function splitSimple(tokens) {
  const commands = [];
  let paren = false;
  let casePattern = false;
  const fresh = (before) => ({ raw: [], redirects: [], heredocs: [], subs: [], globs: [], before });
  let current = fresh(null);
  const close = (op) => {
    if (current.raw.length + current.redirects.length + current.heredocs.length + current.subs.length > 0) commands.push(current);
    current = fresh(op);
  };
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (casePattern) {
      if (token.type === "op" && token.value === ")") casePattern = false;
      else if (token.type === "word" && token.value === "esac") {
        casePattern = false;
        current.raw.push("esac");
      } else if (token.type === "word") current.subs.push(...token.subs);
      continue;
    }
    if (token.type === "op") {
      if (token.value === "(" || token.value === ")") paren = true;
      close(token.value);
      if (token.value === ";;") casePattern = true;
    } else if (token.type === "redir") {
      const target = tokens[k + 1]?.type === "word" ? tokens[++k] : null;
      current.redirects.push({ op: token.value, target: target ? target.value : "" });
      if (target) current.subs.push(...target.subs);
      if (target?.glob) current.globs.push(target.value);
    } else if (token.type === "heredoc") {
      current.heredocs.push(token);
      current.subs.push(...token.subs);
    } else {
      current.raw.push(token.value);
      current.subs.push(...token.subs);
      if (token.glob) current.globs.push(token.value);
      const lead = leadingReserved(current.raw);
      if (current.raw[lead] === "case" && current.raw.length === lead + 3 && token.value === "in") {
        close(null);
        casePattern = true;
      }
    }
  }
  close(null);
  return { commands, paren };
}

// ---------------------------------------------------------------------------
// Um comando por chamada

/**
 * Primeiro separador fora de aspas que não seja pipe, ou a lista de posições
 * dos pipes quando eles são os únicos separadores.
 */
function scan(command) {
  let single = false;
  let double = false;
  const pipes = [];
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (single) {
      if (c === "'") single = false;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`") return { reason: BACKTICK };
    if (c === "$" && next === "(") return { reason: SUBST };
    if (double) {
      if (c === '"') double = false;
      continue;
    }
    if ((c === "<" || c === ">") && next === "(") return { reason: PROCESS };
    if (c === "'") {
      single = true;
      continue;
    }
    if (c === '"') {
      double = true;
      continue;
    }
    if (c === "&" && next === "&") return { reason: "&&" };
    if (c === "|" && next === "|") return { reason: "||" };
    if (c === "|") {
      pipes.push(i);
      continue;
    }
    if (c === ";") return { reason: ";" };
    if (c === "\n") return { reason: "quebra de linha (vários comandos)" };
    if (c === "&") {
      const prev = command[i - 1];
      // `2>&1`, `>&2` e `&>` são redirecionamento, não segundo plano.
      if (prev === ">" || next === ">") continue;
      return { reason: "& (segundo plano)" };
    }
  }
  return pipes.length > 0 ? { reason: "| (pipe)", pipes } : null;
}

const LOOP_START = /^(?:for|while|until|if|case)\s/;
const PIPE_STAGE = "| (pipe) com estágio fora da leitura";

/**
 * Motivo da recusa, ou `null` para comando único. Separadores dentro de
 * aspas não contam (`--jq ".[] | .name"`), exceto substituição de comando,
 * que o shell expande também entre aspas duplas.
 */
export function findCompound(command) {
  const text = command.trim();
  if (LOOP_START.test(text)) return loopVerdict(text);
  const verdict = scan(text);
  if (verdict?.reason !== "| (pipe)") return verdict?.reason ?? null;
  const stages = [];
  let start = 0;
  for (const cut of verdict.pipes) {
    stages.push(text.slice(start, cut));
    start = cut + 1;
  }
  stages.push(text.slice(start));
  return stages.every(isReadOnlyStage) ? null : PIPE_STAGE;
}

/**
 * Laço é UM comando para o shell: `;` e quebra de linha entre `do` e `done`
 * são aceitos, mas `&&`, `||`, `&`, subshell, heredoc, substituição, pipe de
 * escrita e qualquer coisa depois do fechamento continuam recusados.
 */
function loopVerdict(text) {
  const lexed = lex(text);
  if (lexed.substitutions.length > 0) return lexed.substitutions[0];
  if (lexed.heredoc) return "heredoc";
  for (const token of lexed.tokens) {
    if (token.type !== "op") continue;
    if (token.value === "&&" || token.value === "||") return token.value;
    if (token.value === "&" || token.value === "|&") return "& (segundo plano)";
  }
  const { commands, paren } = splitSimple(lexed.tokens);
  if (paren) return "( ) (subshell)";
  let depth = 0;
  let end = -1;
  for (let k = 0; k < commands.length; k++) {
    depth += depthDelta(commands[k].raw);
    if (depth <= 0) {
      end = k;
      break;
    }
  }
  if (end === -1) return "; (laço sem fechamento)";
  // Depois do fechamento, só pipe de leitura: `for …; done | grep a`.
  const tail = commands.slice(end + 1);
  if (tail.some((command) => command.before !== "|")) return "; (comando depois do laço)";
  if (tail.some((command) => !readOnlyWords(command.raw, command.redirects))) return PIPE_STAGE;
  for (let k = 0; k < end; k++) {
    const piped = commands[k].before === "|" || commands[k + 1].before === "|";
    if (piped && !readOnlyWords(commandWords(commands[k].raw), commands[k].redirects)) return PIPE_STAGE;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Estágio de pipe só de leitura

const READ_ONLY = new Set(["cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "cut", "tr", "column", "nl", "ls", "jq"]);
/** Executável com caminho só conta como leitura se vier do sistema. */
const TRUSTED_BIN = new Set(["/bin", "/usr/bin", "/opt/homebrew/bin"]);
const READ_ONLY_REDIRECT = new Set(["<", "<<<"]);
const WRITE_REDIRECT = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);

function stripRtk(words) {
  const out = words.slice();
  if (out[0] === "rtk") {
    out.shift();
    if (out[0] === "proxy") out.shift();
  }
  return out;
}

/** `-abc` contém a letra `letter` entre as opções curtas agrupadas. */
function shortCluster(arg, letter) {
  return /^-[A-Za-z]+$/.test(arg) && arg.slice(1).includes(letter);
}

/**
 * Estágio de pipe que só lê: casado pelo nome do executável, nunca por
 * substring (`catamaran` não é `cat`), sem atribuição, sem redirecionamento de
 * escrita e sem a opção que faz o programa escrever arquivo ou rodar outro
 * (`sort -o`, `rg --pre`, `git diff --output/--ext-diff/--textconv`, `git -c`).
 */
export function isReadOnlyStage(stage) {
  const lexed = lex(stage);
  if (lexed.substitutions.length > 0 || lexed.heredoc) return false;
  if (lexed.tokens.some((token) => token.type === "op")) return false;
  const { commands } = splitSimple(lexed.tokens);
  return commands.length === 1 && readOnlyWords(commands[0].raw, commands[0].redirects);
}

function readOnlyWords(input, redirects) {
  for (const redirect of redirects) {
    if (READ_ONLY_REDIRECT.has(redirect.op)) continue;
    if ((redirect.op === ">&" || redirect.op === "<&") && /^(?:\d+|-)$/.test(redirect.target)) continue;
    if (WRITE_REDIRECT.has(redirect.op) && redirect.target === "/dev/null") continue;
    return false;
  }
  const words = stripRtk(input);
  if (words.length === 0) return false;
  let name = words[0];
  if (name.includes("/")) {
    const slash = name.lastIndexOf("/");
    if (!TRUSTED_BIN.has(name.slice(0, slash))) return false;
    name = name.slice(slash + 1);
  }
  const args = words.slice(1);
  if (READ_ONLY.has(name)) return true;
  if (name === "rg") return !args.some((arg) => /^--(?:pre|hostname-bin)(?:=|$)/.test(arg));
  if (name === "sort") {
    return !args.some((arg) => /^--(?:output|compress-program)(?:=|$)/.test(arg) || shortCluster(arg, "o"));
  }
  if (name === "uniq") {
    // `uniq entrada saída` grava o segundo argumento.
    let positional = 0;
    for (let k = 0; k < args.length; k++) {
      if (/^-[fsw]$/.test(args[k])) k++;
      else if (args[k] === "-" || !args[k].startsWith("-")) positional++;
    }
    return positional <= 1;
  }
  if (name === "git") return readOnlyGit(args);
  return false;
}

const GIT_READ_GLOBAL_VALUE = new Set(["-C", "--git-dir", "--work-tree", "--namespace"]);
const GIT_READ_GLOBAL_FLAG = new Set(["--no-pager", "-P", "--bare", "--no-optional-locks", "--literal-pathspecs"]);

function readOnlyGit(args) {
  let k = 0;
  while (k < args.length && args[k].startsWith("-")) {
    const arg = args[k];
    if (GIT_READ_GLOBAL_VALUE.has(arg)) k += 2;
    else if (GIT_READ_GLOBAL_FLAG.has(arg) || /^--(?:git-dir|work-tree|namespace)=/.test(arg)) k++;
    // `-c` pode apontar `core.fsmonitor`, `core.pager` ou alias para um programa.
    else return false;
  }
  const sub = args[k];
  const rest = args.slice(k + 1);
  if (rest.some((arg) => /^--(?:output|ext-diff|textconv)(?:=|$)/.test(arg))) return false;
  switch (sub) {
    case "status":
    case "diff":
    case "log":
    case "show":
    case "rev-parse":
    case "ls-files":
      return true;
    case "worktree":
      return rest[0] === "list";
    case "branch":
      return readOnlyBranch(rest);
    default:
      return false;
  }
}

const BRANCH_VALUE = new Set(["--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--sort", "--format"]);

/** `git branch` lista; com `-d/-D/-m/-M/-c/-C/-f/-u` ou nome novo, escreve. */
function readOnlyBranch(rest) {
  let listing = false;
  let positional = 0;
  for (let k = 0; k < rest.length; k++) {
    const arg = rest[k];
    if (arg === "--list" || arg === "-l") listing = true;
    else if (arg === "--show-current") continue;
    else if (/^--(?:delete|move|copy|force|set-upstream-to|unset-upstream|edit-description|track|no-track|create-reflog)/.test(arg)) return false;
    else if (/^-[A-Za-z]+$/.test(arg) && /[dDmMcCfut]/.test(arg.slice(1))) return false;
    else if (BRANCH_VALUE.has(arg)) k++;
    else if (!arg.startsWith("-")) positional++;
  }
  return positional === 0 || listing;
}

// ---------------------------------------------------------------------------
// Classificador de risco

/** Níveis de comando carregado por outro (`sh -c`, `xargs`, `find -exec`, lançador). */
const MAX_DEPTH = 4;
/** Teto de tamanho do comando julgado; acima dele, pergunta. */
export const MAX_COMMAND = 100_000;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PROTECTED_BRANCHES = new Set(["main", "staging", "dev"]);

/** @returns {Risk} */
const ask = (reason) => ({ decision: "ask", reason });
/** @returns {Risk} */
const deny = (reason) => ({ decision: "deny", reason });

/** @template {Risk | null} T @param {T} a @param {Risk | null} b */
function stronger(a, b) {
  if (!b) return a;
  if (!a) return b;
  if (a.decision === "deny") return a;
  return b.decision === "deny" ? b : a;
}

/**
 * Invólucros que rodam o comando seguinte sem mudar o que ele faz, com as
 * opções que consomem valor. `timeout` consome ainda a duração.
 */
const WRAPPERS = {
  // `env -` é `env -i`: o `-` sozinho é opção, não o comando.
  env: { value: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string", "-P"], split: ["-S", "--split-string"], dash: true },
  command: {},
  builtin: {},
  exec: { value: ["-a"] },
  nohup: {},
  time: { value: ["-o", "--output", "-f", "--format"] },
  nice: { value: ["-n", "--adjustment"] },
  timeout: { value: ["-s", "--signal", "-k", "--kill-after"], positional: 1 },
  stdbuf: { value: ["-i", "-o", "-e", "--input", "--output", "--error"] },
  ionice: { value: ["-c", "--class", "-n", "--classdata", "-p", "--pid", "-P", "--pgid", "-u", "--uid"] },
  caffeinate: { value: ["-t", "-w"] },
};

const XARGS = { value: ["-n", "-L", "-P", "-s", "-I", "-J", "-E", "-d", "-a", "-R", "-S", "--max-args", "--max-lines", "--max-procs", "--max-chars", "--eof", "--delimiter", "--arg-file", "--process-slot-var"] };
const WATCH = { value: ["-n", "--interval"] };

/** Pula as opções de `spec` e devolve o comando que vem depois. */
function skipOptions(rest, spec) {
  const value = new Set(spec.value ?? []);
  const split = new Set(spec.split ?? []);
  const injected = [];
  let k = 0;
  while (k < rest.length) {
    const arg = rest[k];
    if (arg === "--") {
      k++;
      break;
    }
    if (arg === "-" && spec.dash) {
      k++;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") break;
    const long = arg.startsWith("--");
    const flag = long ? arg.split("=")[0] : arg.slice(0, 2);
    let attached = long ? (arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined) : arg.length > 2 ? arg.slice(2) : undefined;
    if (value.has(flag) && attached === undefined) {
      attached = rest[k + 1];
      k++;
    }
    if (split.has(flag) && attached !== undefined) injected.push(...attached.split(/\s+/).filter(Boolean));
    k++;
  }
  k += spec.positional ?? 0;
  return [...injected, ...rest.slice(k)];
}

/** Primeiro argumento que não é opção, pulando o valor das opções de `value`. */
function firstPositional(args, value) {
  for (let k = 0; k < args.length; k++) {
    const arg = args[k];
    if (arg === "--") return { sub: args[k + 1], rest: args.slice(k + 2) };
    if (!arg.startsWith("-")) return { sub: arg, rest: args.slice(k + 1) };
    if (value.has(arg)) k++;
  }
  return { sub: undefined, rest: [] };
}

/** `vercel@latest` → `vercel`; `@escopo/pacote@1` → `pacote`. */
function packageBin(spec) {
  let name = spec;
  if (name.startsWith("@")) name = name.slice(name.indexOf("/") + 1);
  const at = name.indexOf("@");
  return at > 0 ? name.slice(0, at) : name;
}

// Arquivo de segredo: `.env`, `.env.*`, `.env*` e o token do LinkedIn, inclusive
// como `@.env` (curl), `campo=@.env`, `--env-file=.env`, `host:.env` e URL.
function isSecretWord(word) {
  if (!word || /\s/.test(word)) return false;
  if (word.includes(".linkedin.token.json")) return true;
  const tail = word.split(/[=@<:]/).pop() ?? "";
  return /^\.env(?:[.*]|$)/.test(tail.slice(tail.lastIndexOf("/") + 1));
}

const SECRET_NAMES = [".env", ".env.local", ".env.production", ".linkedin.token.json"];

/** Curinga do shell (`*`, `?`, `[…]`) como regex de um nome de arquivo. */
function shellGlobRegex(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "[" && glob.indexOf("]", i + 2) !== -1) {
      const end = glob.indexOf("]", i + 2);
      let body = glob.slice(i + 1, end);
      if (body.startsWith("!") || body.startsWith("^")) body = `^${body.slice(1)}`;
      source += `[${body.replace(/\\/g, "\\\\")}]`;
      i = end;
    } else source += c.replace(/[.+?^${}()|[\]\\/-]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "s");
}

/**
 * Palavra com curinga fora de aspas que o shell pode expandir para `.env`
 * (`.en?`, `.en*`, `./.en[v]`, `.e*`). Sem `.` literal no início o bash não
 * casa arquivo oculto, então `*.ts` não conta.
 */
function globMayBeSecret(word) {
  const tail = word.split(/[=@<:]/).pop() ?? "";
  const base = tail.slice(tail.lastIndexOf("/") + 1);
  if (!base.startsWith(".")) return false;
  try {
    const pattern = shellGlobRegex(base);
    return SECRET_NAMES.some((name) => pattern.test(name));
  } catch {
    return true;
  }
}

/** A política de permissões: editar pela shell também pergunta. */
const POLICY_PATH = /(?:^|\/)(?:\.claude\/settings\.json$|\.claude\/hooks(?:\/|$)|scripts\/harness(?:\/|$)|opencode\.json$|\.codex(?:\/|$)|\.opencode\/plugins(?:\/|$))/;
const POLICY_WRITE = "altera a política de permissões (.claude/settings.json, hooks, scripts/harness, opencode.json, .codex, .opencode/plugins)";

function isPolicyPath(word) {
  return POLICY_PATH.test(word.replace(/^\.\//, ""));
}

/**
 * Onde o comando roda (#461): `root` é a árvore do projeto (o worktree fica
 * dentro dela), `cwd` resolve caminho relativo e `home` resolve `~`/`$HOME`.
 * Vem do chamador — a política continua pura. Sem `root`, todo caminho
 * absoluto fora do temporário pergunta.
 * @typedef {{ root?: string, cwd?: string, home?: string }} ShellEnv
 */
/** @type {ShellEnv} */
const NO_ENV = {};

/** `/a/./b/../c` → `/a/c`; relativo continua relativo, com `..` que sobra à esquerda. */
function normalizePath(path) {
  const absolute = path.startsWith("/");
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else if (part === ".." && absolute) continue;
    else parts.push(part);
  }
  return absolute ? `/${parts.join("/")}` : parts.join("/");
}

const within = (path, base) => path === base || path.startsWith(base === "/" ? "/" : `${base}/`);

/** Temporário (`/tmp`, `$TMPDIR` do macOS em `/var/folders`, o scratchpad) e saída padrão. */
const SCRATCH_DIRS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
const SAFE_DEVICE = /^\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)$/;
/** Configuração pessoal: arquivo oculto direto no `~` e os diretórios de ferramenta. */
const PERSONAL_CONFIG = /^(?:\.[^/]+$|\.(?:ssh|claude|codex|config)(?:\/|$))/;

/**
 * `ask` quando o caminho gravado fica fora da árvore do projeto ou é
 * configuração pessoal (`~/.zshrc`, `~/.ssh/**`, `~/.claude/**`, `/etc`);
 * temporário passa.
 * @param {string} target
 * @param {ShellEnv} env
 */
function outsideWrite(target, env) {
  if (!target) return null;
  const outside = ask(`escreve fora do projeto (${target})`);
  if (/^\$\{?TMPDIR\}?(?:\/|$)/.test(target)) return null;
  let path = target;
  const home = /^(?:~|\$\{?HOME\}?)(?=\/|$)/.exec(path);
  if (home) {
    if (!env.home) return outside;
    path = env.home + path.slice(home[0].length);
  } else if (path.startsWith("~") || path.startsWith("$")) return outside;
  else if (!path.startsWith("/")) {
    const base = env.cwd ?? env.root;
    if (!base) return normalizePath(path).startsWith("..") ? outside : null;
    path = `${base}/${path}`;
  }
  path = normalizePath(path);
  if (SAFE_DEVICE.test(path) || SCRATCH_DIRS.some((dir) => within(path, dir))) return null;
  if (env.home && within(path, normalizePath(env.home))) {
    const relative = path.slice(normalizePath(env.home).length + 1);
    if (PERSONAL_CONFIG.test(relative)) return ask(`escreve na configuração pessoal (${target})`);
  }
  return env.root && within(path, normalizePath(env.root)) ? null : outside;
}

/** O que `tee`, `cp`, `mv`, `ln`, `install`, `dd` e `truncate` gravam. */
function writtenPaths(name, args) {
  const operands = args.filter((arg) => !arg.startsWith("-"));
  const targetDir = [];
  for (let k = 0; k < args.length; k++) {
    if (args[k] === "-t" || args[k] === "--target-directory") targetDir.push(args[k + 1] ?? "");
    else if (args[k].startsWith("--target-directory=")) targetDir.push(args[k].slice("--target-directory=".length));
  }
  switch (name) {
    case "tee":
    case "mv":
    case "truncate":
      return operands;
    case "cp":
    case "ln":
    case "install":
      return targetDir.length > 0 ? targetDir : operands.slice(-1);
    case "dd":
      return args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3));
    default:
      return [];
  }
}

/**
 * Scripts que escrevem em produção ou agem nela com sessão (#461). Conferido
 * contra o `package.json` por `tests/shell-policy.test.ts`.
 */
export const PRODUCTION_SCRIPTS = [/^db:import-production(?::|$)/, /^perf:producao(?::|$)/];
export const PRODUCTION_FILES = [/(?:^|\/)scripts\/migration\/production\.ts$/, /(?:^|\/)scripts\/perf\/medir-producao\.ts$/];

function scriptRisk(script) {
  return script && PRODUCTION_SCRIPTS.some((pattern) => pattern.test(script)) ? ask(`produção: script ${script}`) : null;
}

const PNPM_VALUE = new Set(["--filter", "-F", "-C", "--dir", "--reporter", "--loglevel", "--resume-from", "--workspace-concurrency"]);
const NPM_VALUE = new Set(["--prefix", "-w", "--workspace", "-C"]);
const LAUNCHER_VALUE = new Set(["-p", "--package", "-w", "--workspace", "--filter", "-F", "--node-options", "-C", "--dir", "--resume-from", "--reporter", "--allow-build"]);
const LAUNCHER_SHELL = new Set(["-c", "--call", "--shell-mode"]);
const PNPM_BUILTINS = new Set([
  "add", "install", "i", "remove", "rm", "uninstall", "un", "update", "up", "upgrade", "link", "ln", "unlink", "import",
  "rebuild", "rb", "prune", "fetch", "patch", "patch-commit", "audit", "list", "ls", "la", "ll", "outdated", "why",
  "licenses", "publish", "pack", "recursive", "server", "store", "root", "bin", "setup", "init", "env", "config", "c",
  "get", "set", "test", "t", "start", "create", "deploy", "doctor", "help", "info", "cache", "dedupe", "workspaces",
  "workspace", "plugin", "version", "npm", "node", "explain", "constraints",
]);

/**
 * Lançador de pacote (`npx [-y]`, `npm exec [--]`, `pnpm exec`, `pnpm dlx`,
 * `bunx`): julga o binário que ele roda. `-c`/`--call`/`--shell-mode` rodam
 * texto como shell, que é julgado inteiro.
 */
function judgeLaunched(args, context) {
  let k = 0;
  while (k < args.length) {
    const arg = args[k];
    if (arg === "--") {
      k++;
      break;
    }
    if (!arg.startsWith("-")) break;
    const flag = arg.split("=")[0];
    if (LAUNCHER_SHELL.has(flag)) {
      const payload = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args.slice(k + 1).join(" ");
      return riskOf(payload, context.depth + 1, false, context.env);
    }
    if (LAUNCHER_VALUE.has(flag) && !arg.includes("=")) k++;
    k++;
  }
  const rest = args.slice(k);
  return rest.length === 0 ? null : judgeWords([packageBin(rest[0]), ...rest.slice(1)], deeper(context));
}

function judgeNpm(args, context) {
  const { sub, rest } = firstPositional(args, NPM_VALUE);
  if (sub === "exec" || sub === "x") return judgeLaunched(rest, context);
  if (sub === "run" || sub === "run-script" || sub === "rum" || sub === "urn") return scriptRisk(firstPositional(rest, NPM_VALUE).sub);
  return null;
}

/** `pnpm`/`yarn`: exec e dlx lançam; o que não é comando embutido é script ou binário. */
function judgePnpm(args, context) {
  const { sub, rest } = firstPositional(args, PNPM_VALUE);
  if (!sub) return null;
  if (sub === "exec" || sub === "dlx") return judgeLaunched(rest, context);
  if (sub === "run" || sub === "run-script") return scriptRisk(firstPositional(rest, PNPM_VALUE).sub);
  // `pnpm node <arquivo>` é o `node` do pnpm: arquivo, `--run` e `node_modules/.bin` julgados igual.
  if (sub === "node") return judgeNode(rest, deeper(context));
  if (PNPM_BUILTINS.has(sub)) return null;
  return stronger(scriptRisk(sub), judgeWords([sub, ...rest], deeper(context)));
}

function judgeBun(args, context) {
  const { sub, rest } = firstPositional(args, new Set());
  if (sub === "x") return judgeLaunched(rest, context);
  if (sub === "run") return stronger(scriptRisk(rest[0]), productionFile(rest));
  return stronger(scriptRisk(sub), productionFile(args));
}

function productionFile(args) {
  const file = args.find((arg) => PRODUCTION_FILES.some((pattern) => pattern.test(arg)));
  return file ? ask(`produção: ${file}`) : null;
}

const NODE_VALUE = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions", "--input-type", "--title", "--env-file", "--env-file-if-exists", "--watch-path", "--inspect-port", "--test-name-pattern"]);
const NODE_BIN = /(?:^|\/)node_modules\/\.bin\/([^/]+)$/;
const NODE_PACKAGE = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\/(?:.*\/)?([^/]+)$/;

/**
 * `node`: `--run <script>` é `pnpm <script>`; `node node_modules/.bin/vercel`
 * e `node node_modules/supabase/bin/supabase` são o próprio pacote.
 */
function judgeNode(args, context) {
  let worst = productionFile(args);
  for (let k = 0; k < args.length; k++) {
    const arg = args[k];
    if (arg === "--run") return stronger(worst, scriptRisk(args[k + 1]));
    if (arg.startsWith("--run=")) return stronger(worst, scriptRisk(arg.slice("--run=".length)));
    if (arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print" || arg === "--") break;
    if (NODE_VALUE.has(arg)) k++;
    else if (!arg.startsWith("-")) {
      const rest = args.slice(k + 1);
      const bin = NODE_BIN.exec(arg);
      if (bin) return stronger(worst, judgeWords([bin[1], ...rest], deeper(context)));
      const pkg = NODE_PACKAGE.exec(arg);
      if (pkg) {
        const file = pkg[2].replace(/\.[cm]?js$/, "");
        worst = stronger(worst, judgeWords([packageBin(pkg[1]), ...rest], deeper(context)));
        return stronger(worst, judgeWords([file, ...rest], deeper(context)));
      }
      return worst;
    }
  }
  return worst;
}

/**
 * `script [-q] arquivo comando…` (BSD/macOS) e `script -c 'comando' arquivo`
 * (util-linux) rodam o comando gravando a sessão.
 */
function judgeScript(args, context) {
  for (let k = 0; k < args.length; k++) {
    const arg = args[k];
    if (arg === "-c" || arg === "--command") return riskOf(args[k + 1] ?? "", context.depth + 1, false, context.env);
    if (arg.startsWith("--command=")) return riskOf(arg.slice("--command=".length), context.depth + 1, false, context.env);
    if (arg === "--") return judgeWords(args.slice(k + 2), deeper(context));
    // macOS: só `-t` e `-T` levam valor; util-linux: `-I`, `-O`, `-B`, `-E`, `-m`.
    if (arg === "-t" || arg === "-T" || arg === "-I" || arg === "-O" || arg === "-B" || arg === "-E" || arg === "-m") k++;
    else if (!arg.startsWith("-")) return judgeWords(args.slice(k + 1), deeper(context));
  }
  return null;
}

/** O mesmo contexto, um nível mais fundo (comando carregado por outro). */
function deeper(context, extra = {}) {
  return { ...context, ...extra, depth: context.depth + 1 };
}

/**
 * `sh -c '…'` e afins: o texto é julgado como comando; sem `-c`, a entrada
 * (heredoc, `<<<`). Com `-s`, o que vem depois são argumentos do texto lido
 * da entrada, não um arquivo de script.
 */
function judgeShellInvocation(args, context) {
  let stdin = false;
  for (let k = 0; k < args.length; k++) {
    const arg = args[k];
    if (arg === "-o" || arg === "+o" || arg === "-O" || arg === "+O" || arg === "--rcfile" || arg === "--init-file") k++;
    else if (/^-[A-Za-z]*c[A-Za-z]*$/.test(arg) || arg === "--command") return riskOf(args[k + 1] ?? "", context.depth + 1, false, context.env);
    else if (/^-[A-Za-z]*s[A-Za-z]*$/.test(arg)) stdin = true;
    else if (arg === "--") {
      if (!stdin && k + 1 < args.length) return null;
      break;
    } else if (!arg.startsWith("-") && !arg.startsWith("+")) {
      if (!stdin) return null;
      break;
    }
  }
  let worst = null;
  for (const body of context.stdin) worst = stronger(worst, riskOf(body, context.depth + 1, false, context.env));
  return worst;
}

function judgeFind(args, context) {
  let worst = null;
  for (let k = 0; k < args.length; k++) {
    const arg = args[k];
    if (arg === "-delete") worst = stronger(worst, ask("find -delete apaga em massa"));
    if (arg === "-exec" || arg === "-execdir" || arg === "-ok" || arg === "-okdir") {
      let end = k + 1;
      while (end < args.length && args[end] !== ";" && args[end] !== "+") end++;
      worst = stronger(worst, judgeWords(args.slice(k + 1, end), deeper(context, { bulk: true })));
      k = end;
    }
  }
  return worst;
}

const ROOTISH = /^(?:\/+\.?|\/\*|~\/?|~\/\*|\$\{?HOME\}?\/?|\$\{?HOME\}?\/\*)$/;
/** Diretório de sistema de primeiro nível (`/usr`, `/etc/`, `/Users/*`); `/tmp/cache` não é. */
const SYSTEM_DIR =
  /^\/+(?:bin|sbin|usr|etc|var|lib|opt|tmp|dev|home|root|boot|private|System|Library|Applications|Users|Volumes)\/*(?:\*)?$/;

function judgeRm(args, context) {
  let recursive = false;
  let options = true;
  const targets = [];
  for (const arg of args) {
    if (options && arg === "--") options = false;
    else if (options && arg === "--no-preserve-root") return deny("rm --no-preserve-root");
    else if (options && arg === "--recursive") recursive = true;
    else if (options && arg.startsWith("--")) continue;
    else if (options && /^-[A-Za-z]+$/.test(arg)) recursive ||= /[rR]/.test(arg);
    else targets.push(arg);
  }
  const home = context.env?.home ? normalizePath(context.env.home) : null;
  const rootish = (target) => ROOTISH.test(target) || SYSTEM_DIR.test(target) || (home !== null && target.startsWith("/") && normalizePath(target) === home);
  if (recursive && targets.some(rootish)) return deny("rm recursivo na raiz, num diretório de sistema ou no diretório pessoal");
  let worst = targets.some(isPolicyPath) ? ask(POLICY_WRITE) : null;
  if (context.bulk) worst = stronger(worst, ask("rm em massa (xargs, find -exec ou comando repetido pelo git)"));
  if (recursive) worst = stronger(worst, ask("rm recursivo"));
  return worst;
}

/** Modo que deixa o arquivo gravável por todos: `777`, `0666`, `a+rwx`, `o+w`. */
function worldWritable(mode) {
  if (/^[0-7]{3,4}$/.test(mode)) return "2367".includes(mode[mode.length - 1]);
  return mode.split(",").some((clause) => {
    const who = /^[ugoa]*/.exec(clause)[0];
    return /[ao]/.test(who) && /[+=][^-+=]*w/.test(clause.slice(who.length));
  });
}

function judgeChmod(args) {
  for (const arg of args) {
    if (arg.startsWith("-") && !/^-[rwxXst]+$/.test(arg)) continue;
    return worldWritable(arg) ? deny(`chmod deixa gravável por todos (${arg})`) : null;
  }
  return null;
}

const GIT_GLOBAL_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix", "--list-cmds"]);

/**
 * `git`: tira as opções globais (`-C dir`, `-c k=v`, `--git-dir`,
 * `--no-pager`…) antes de olhar o subcomando — `git -c x=y push origin main`
 * é push para `main`.
 */
function judgeGit(args, context) {
  let k = 0;
  const configs = [];
  while (k < args.length && args[k].startsWith("-")) {
    const arg = args[k];
    if (GIT_GLOBAL_VALUE.has(arg)) {
      if (arg === "-c" || arg === "--config-env") configs.push(args[k + 1] ?? "");
      k += 2;
      continue;
    }
    if (/^-c./.test(arg)) configs.push(arg.slice(2));
    if (arg.startsWith("--config-env=")) configs.push(arg.slice("--config-env=".length));
    k++;
  }
  let worst = null;
  for (const entry of configs) {
    const eq = entry.indexOf("=");
    const key = (eq === -1 ? entry : entry.slice(0, eq)).toLowerCase();
    const value = eq === -1 ? "" : entry.slice(eq + 1);
    if (GIT_EXEC_KEY.test(key)) worst = stronger(worst, ask(`git -c ${key} executa programa ou desliga os hooks`));
    if (key.startsWith("alias.") && value.trimStart().startsWith("!")) worst = stronger(worst, ask("alias do git que roda shell"));
  }
  return stronger(worst, judgeGitSubcommand(args[k], args.slice(k + 1), context));
}

/**
 * Chaves de configuração do git cujo valor é um programa que ele executa (ou
 * que desligam os hooks): `-c` e `git config` com elas perguntam.
 */
const GIT_EXEC_KEY =
  /^(?:core\.(?:pager|editor|sshcommand|fsmonitor|hookspath|askpass)|diff\.external|sequence\.editor|credential\.helper|credential\..+\.helper|gpg\.program|gpg\.[^.]+\.program|.+\.textconv|diff\..+\.command|merge\..+\.driver|filter\..+\.(?:clean|smudge|process)|pager\..+|uploadpack\.packobjectshook)$/;

const has = (args, ...flags) => args.some((arg) => flags.includes(arg));

/**
 * Texto que o git entrega ao shell (`rebase -x`, `submodule foreach`,
 * `bisect run`): um argumento é linha de shell; vários, o primeiro ainda passa
 * pelo shell e o resto são argumentos. Roda a cada commit ou submódulo: em massa.
 */
function gitShellPayload(args, context) {
  if (args.length === 0) return null;
  const line = riskOf(args[0], context.depth + 1, true, context.env);
  return args.length === 1 ? line : stronger(line, judgeWords(args, deeper(context, { bulk: true })));
}

/** Valor de `-x <cmd>`, `-x<cmd>`, `-ix <cmd>`, `--exec <cmd>` e `--exec=<cmd>`. */
function optionPayloads(rest, short, long) {
  const found = [];
  for (let k = 0; k < rest.length; k++) {
    const arg = rest[k];
    if (arg === "--") break;
    if (arg === long || new RegExp(`^-[A-Za-z]*${short}$`).test(arg)) found.push(rest[++k] ?? "");
    else if (arg.startsWith(`${long}=`)) found.push(arg.slice(long.length + 1));
    else if (arg.startsWith(`-${short}`) && !arg.startsWith("--")) found.push(arg.slice(2));
  }
  return found;
}

function judgeGitSubcommand(sub, rest, context) {
  switch (sub) {
    case "push":
      return judgePush(rest);
    // Encanamento do push: mesmo destino, mesma proteção. `--stdin` lê os refs da entrada.
    case "send-pack":
    case "http-push":
      return stronger(judgePush(rest), has(rest, "--stdin") ? ask(`git ${sub} --stdin lê os refs da entrada`) : null);
    case "receive-pack":
      return ask("git receive-pack atualiza refs lidos da entrada");
    case "branch":
      return judgeBranchWrite(rest);
    case "symbolic-ref": {
      const positional = rest.filter((arg) => !arg.startsWith("-"));
      return positional.length >= 2 || has(rest, "-d", "--delete") ? ask("git symbolic-ref reescreve o HEAD") : null;
    }
    // `commit --amend` e `rebase`/`rebase -i` em branch de trabalho são rotina
    // (G85): o portão de reescrita é o push forçado, que já pergunta.
    case "rebase": {
      let worst = null;
      for (const payload of optionPayloads(rest, "x", "--exec")) worst = stronger(worst, riskOf(payload, context.depth + 1, true, context.env));
      return worst;
    }
    case "difftool": {
      let worst = null;
      for (const payload of optionPayloads(rest, "x", "--extcmd")) worst = stronger(worst, riskOf(payload, context.depth + 1, true, context.env));
      return worst;
    }
    case "submodule": {
      const at = rest.indexOf("foreach");
      if (at === -1) return null;
      let k = at + 1;
      while (k < rest.length && rest[k].startsWith("-")) k++;
      return gitShellPayload(rest.slice(k), context);
    }
    case "bisect":
      return rest[0] === "run" ? gitShellPayload(rest.slice(1), context) : null;
    case "config":
      return judgeGitConfig(rest);
    case "commit":
      return judgeCommit(rest);
    case "reset":
      return has(rest, "--hard", "--merge") ? ask("git reset --hard/--merge descarta mudanças") : null;
    case "clean":
      return has(rest, "-n", "--dry-run") || rest.some((arg) => shortCluster(arg, "n")) ? null : ask("git clean apaga arquivo não versionado");
    case "checkout":
      return judgeCheckout(rest);
    case "switch":
      return has(rest, "-f", "--force", "--discard-changes", "-C", "--force-create") || rest.some((arg) => shortCluster(arg, "f"))
        ? ask("git switch descarta mudanças ou recria o branch")
        : null;
    case "restore": {
      const staged = has(rest, "--staged", "-S") || rest.some((arg) => shortCluster(arg, "S"));
      const worktree = has(rest, "--worktree", "-W") || rest.some((arg) => shortCluster(arg, "W"));
      return staged && !worktree ? null : ask("git restore sobrescreve arquivo do working tree");
    }
    case "stash":
      return rest[0] === "drop" || rest[0] === "clear" ? ask(`git stash ${rest[0]} apaga stash`) : null;
    case "worktree":
      return rest[0] === "remove" && (has(rest, "--force", "-f") || rest.some((arg) => shortCluster(arg, "f")))
        ? ask("git worktree remove --force descarta mudanças")
        : null;
    case "filter-branch":
    case "filter-repo":
      return ask(`git ${sub} reescreve histórico`);
    case "update-ref": {
      if (has(rest, "-d", "--stdin")) return ask("git update-ref apaga referência");
      const ref = rest.find((arg) => !arg.startsWith("-"));
      return ref && (ref === "HEAD" || PROTECTED_BRANCHES.has(pushDestination(ref))) ? ask(`git update-ref reescreve ${ref}`) : null;
    }
    case "reflog":
      return rest[0] === "expire" || rest[0] === "delete" ? ask(`git reflog ${rest[0]} apaga histórico de referência`) : null;
    case "gc":
      return rest.some((arg) => arg.startsWith("--prune")) ? ask("git gc --prune descarta objetos") : null;
    case "prune":
      return ask("git prune descarta objetos");
    case "rm": {
      if (rest.includes("--cached")) return null;
      const recursive = rest.some((arg) => arg === "-r" || shortCluster(arg, "r"));
      const force = rest.some((arg) => arg === "-f" || arg === "--force" || shortCluster(arg, "f"));
      return recursive || force ? ask("git rm -r/-f apaga arquivos") : null;
    }
    default:
      return null;
  }
}

const CONFIG_READ = new Set(["--get", "--get-all", "--get-regexp", "--get-urlmatch", "--get-color", "--get-colorbool", "-l", "--list", "--show-origin", "--show-scope", "--name-only"]);
const CONFIG_VALUE = new Set(["-f", "--file", "--blob", "--type", "--default", "--comment", "--value"]);
const CONFIG_WRITE = new Set(["--add", "--replace-all", "--unset", "--unset-all", "--rename-section", "--remove-section"]);

/**
 * `git config` que grava chave que executa programa (`core.pager`,
 * `core.hooksPath`…) ou qualquer `alias.*`: o efeito persiste depois da
 * chamada. Leitura (`--get`, `--list`, `get`, `list`) não pergunta.
 */
function judgeGitConfig(rest) {
  const positional = [];
  let write = false;
  for (let k = 0; k < rest.length; k++) {
    const arg = rest[k];
    if (arg === "-e" || arg === "--edit") return ask("git config --edit grava qualquer chave");
    if (CONFIG_READ.has(arg)) return null;
    if (CONFIG_WRITE.has(arg)) write = true;
    else if (CONFIG_VALUE.has(arg)) k++;
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  if (positional[0] === "get" || positional[0] === "list") return null;
  if (positional[0] === "edit") return ask("git config edit grava qualquer chave");
  const subcommand = ["set", "unset", "rename-section", "remove-section"].includes(positional[0]);
  const key = (subcommand ? positional[1] : positional[0])?.toLowerCase();
  // `git config chave` sozinho lê.
  if (!key || !(write || subcommand || positional.length >= 2)) return null;
  if (GIT_EXEC_KEY.test(key)) return ask(`git config ${key} executa programa ou desliga os hooks`);
  if (key.startsWith("alias.") || key === "alias") return ask("git config alias.* cria comando do git");
  return null;
}

const COMMIT_VALUE = "mFcCt";

/** `git commit --no-verify` e `-n` pulam os hooks pre-commit e commit-msg. */
function judgeCommit(rest) {
  for (let k = 0; k < rest.length; k++) {
    const arg = rest[k];
    if (arg === "--") break;
    if (arg === "--no-verify") return ask("git commit --no-verify pula os hooks do projeto");
    if (/^--(?:message|file|reuse-message|reedit-message|template|author|date|fixup|squash|trailer|cleanup)$/.test(arg)) k++;
    else if (/^-[A-Za-z]+$/.test(arg)) {
      for (let i = 1; i < arg.length; i++) {
        if (arg[i] === "n") return ask("git commit -n pula os hooks do projeto");
        if (COMMIT_VALUE.includes(arg[i])) {
          if (i === arg.length - 1) k++;
          break;
        }
      }
    }
  }
  return null;
}

/** Branch passado por nome que parece arquivo (`src/a.ts`): checkout de caminho. */
const FILE_LIKE = /\.[A-Za-z][A-Za-z0-9]{0,5}$/;
/**
 * Nome que nenhum ref do git aceita (termina em `/`, começa por `.` ou `:`):
 * só pode ser caminho. Arquivo sem extensão (`Makefile`) que não é ref
 * exigiria olhar o disco, e a política é pura — resíduo documentado.
 */
const PATH_ONLY = /(?:\/$|^\.|^:)/;

function judgeCheckout(rest) {
  const positional = [];
  for (let k = 0; k < rest.length; k++) {
    const arg = rest[k];
    if (arg === "--") return rest.length > k + 1 ? ask("git checkout -- <caminho> sobrescreve arquivo") : null;
    if (arg === "-f" || arg === "--force" || shortCluster(arg, "f")) return ask("git checkout -f descarta mudanças");
    if (arg === "-B") return ask("git checkout -B recria o branch");
    if (arg.startsWith("--pathspec-from-file")) return ask("git checkout de caminhos sobrescreve arquivo");
    if (arg === "-b" || arg === "--orphan") k++;
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  if (positional.includes(".")) return ask("git checkout . sobrescreve o working tree");
  if (positional.length >= 2) return ask("git checkout <ref> <caminho> sobrescreve arquivo");
  if (positional.length === 1 && (FILE_LIKE.test(positional[0]) || PATH_ONLY.test(positional[0]))) {
    return ask("git checkout <caminho> sobrescreve arquivo");
  }
  return null;
}

const PUSH_VALUE = new Set(["--repo", "--receive-pack", "--exec", "--push-option"]);

/**
 * Push: `main`, `staging` e `dev` por qualquer refspec (`HEAD:main`,
 * `refs/heads/main`, `:main`) são negados; forçado, `--all`/`--mirror`,
 * `--prune`, `--no-verify`, refspec com variável e push sem refspec
 * explícito perguntam.
 */
function judgePush(rest) {
  let worst = null;
  let everything = false;
  let deleting = false;
  const positional = [];
  for (let k = 0; k < rest.length; k++) {
    const arg = rest[k];
    if (arg === "--") {
      positional.push(...rest.slice(k + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const flag = arg.split("=")[0];
      if (flag === "--force" || flag === "--force-with-lease" || flag === "--force-if-includes") worst = stronger(worst, ask("push forçado"));
      else if (flag === "--mirror" || flag === "--all" || flag === "--branches") {
        everything = true;
        worst = stronger(worst, ask(`git push ${flag} empurra todos os branches`));
      } else if (flag === "--prune") worst = stronger(worst, ask("git push --prune apaga branch remoto"));
      else if (flag === "--no-verify") worst = stronger(worst, ask("git push --no-verify pula o hook pre-push"));
      else if (flag === "--delete") deleting = true;
      else if (PUSH_VALUE.has(flag) && !arg.includes("=")) k++;
      continue;
    }
    if (/^-[A-Za-z0-9]+$/.test(arg)) {
      if (arg.includes("f")) worst = stronger(worst, ask("push forçado"));
      if (arg.includes("d")) deleting = true;
      if (arg.endsWith("o")) k++;
      continue;
    }
    positional.push(arg);
  }
  const refspecs = positional.slice(1);
  if (refspecs.length === 0 && !everything) worst = stronger(worst, ask("git push sem refspec explícito pode ir para branch protegida"));
  for (const spec of refspecs) {
    const bare = spec.replace(/^\+/, "");
    if (bare !== spec) worst = stronger(worst, ask("push forçado (+refspec)"));
    const colon = bare.indexOf(":");
    const target = pushDestination(colon === -1 ? bare : bare.slice(colon + 1));
    if (PROTECTED_BRANCHES.has(target)) return deny(`push direto para ${target}`);
    // `$VAR`, curinga e o `{}` de `find -exec`/`xargs -I`: o destino só aparece na hora.
    if (/[$`*{]/.test(bare)) worst = stronger(worst, ask("refspec com variável ou curinga"));
    if (target === "HEAD") worst = stronger(worst, ask("git push HEAD sem destino explícito"));
    // Apagar ref remoto (`:x` ou `--delete x`): branch de trabalho `<tipo>/<slug>`
    // passa; tag (regra 22: toda tag SemVer tem Release) e nome sem `/` perguntam.
    if ((deleting || (colon === 0 && bare.length > 1)) && (target.startsWith("tags/") || !target.includes("/"))) {
      worst = stronger(worst, ask(`git push apaga ref remoto que pode ser tag (${target})`));
    }
  }
  return worst;
}

/**
 * `git branch -f/-M/-D/-m/-d/-C/--force/--delete/--move` sobre `main`,
 * `staging` ou `dev` reescreve ou apaga a branch protegida local.
 */
function judgeBranchWrite(rest) {
  const writes = rest.some(
    (arg) => /^--(?:force|delete|move)$/.test(arg) || (/^-[A-Za-z]+$/.test(arg) && /[dDmMfC]/.test(arg.slice(1))),
  );
  if (!writes) return null;
  const target = rest.find((arg) => !arg.startsWith("-") && PROTECTED_BRANCHES.has(pushDestination(arg)));
  return target ? ask(`git branch reescreve a branch protegida ${target}`) : null;
}

/**
 * Destino do refspec como o git o resolve: `@` é `HEAD`; `refs/heads/main`,
 * `heads/main` e `refs/main` são `main`; `refs/tags/v1` vira `tags/v1`.
 */
function pushDestination(ref) {
  if (ref === "@") return "HEAD";
  let out = ref.replace(/^refs\//, "");
  out = out.replace(/^heads\//, "");
  return out;
}

const VERCEL_VALUE = new Set(["--scope", "-S", "--token", "-t", "--cwd", "--local-config", "-A", "--global-config", "-Q", "--team", "-T", "--env", "-e", "--build-env", "-b", "--meta", "-m", "--regions", "--archive"]);
const VERCEL_PRODUCTION = new Set(["promote", "rollback", "remove", "rm", "alias", "aliases", "domains", "domain", "dns", "certs", "cert", "redeploy"]);

function judgeVercel(args) {
  const positional = [];
  let production = false;
  for (let k = 0; k < args.length; k++) {
    const arg = args[k];
    // `--prod=false` também pergunta: o valor que a CLI aceita não é conferido aqui.
    if (/^--prod(?:uction)?(?:=|$)/.test(arg)) production = true;
    else if (arg === "--target") production ||= args[++k]?.toLowerCase() === "production";
    else if (arg.startsWith("--target=")) production ||= arg.slice("--target=".length).toLowerCase() === "production";
    else if (VERCEL_VALUE.has(arg)) k++;
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  if (production) return ask("produção: vercel --prod");
  const [sub, action] = positional;
  if (VERCEL_PRODUCTION.has(sub)) return ask(`produção: vercel ${sub}`);
  if (sub === "env" && ["add", "rm", "remove", "update"].includes(action)) return ask(`produção: vercel env ${action}`);
  if ((sub === "project" || sub === "projects") && (action === "rm" || action === "remove")) return ask(`produção: vercel ${sub} ${action}`);
  if (sub === "blob" && ["del", "delete", "rm", "remove"].includes(action)) return ask(`produção: vercel blob ${action}`);
  return null;
}

const SUPABASE_VALUE = new Set(["--workdir", "--profile", "-o", "--output", "--network-id", "--dns-resolver", "--db-url", "-p", "--password", "--project-ref", "-s", "--schema", "-f", "--file"]);

function judgeSupabase(args) {
  const positional = [];
  let remote = false;
  for (let k = 0; k < args.length; k++) {
    const arg = args[k];
    if (arg === "--linked" || arg.startsWith("--db-url")) remote = true;
    if (SUPABASE_VALUE.has(arg)) k++;
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  const [group, action] = positional;
  const key = `${group} ${action}`;
  if (key === "db push" || key === "db reset" || key === "migration repair") return ask(`produção: supabase ${key}`);
  if ((key === "db query" || key === "migration up") && remote) return ask(`produção: supabase ${key} remoto`);
  if (group === "secrets") return ask("produção: supabase secrets");
  if (key === "functions deploy" || key === "functions delete" || key === "projects delete") return ask(`produção: supabase ${key}`);
  if (key === "storage rm" || key === "branches delete") return ask(`produção: supabase ${key}`);
  return null;
}

/** `tee`, `cp`, `mv`, `ln`, `sed -i`… apontando para a política. */
function policyWrite(name, args) {
  const operands = args.filter((arg) => !arg.startsWith("-"));
  switch (name) {
    case "tee":
    case "mv":
    case "ln":
    case "truncate":
      return operands.some(isPolicyPath) ? ask(POLICY_WRITE) : null;
    case "cp":
    case "install":
    case "rsync":
      return operands.length > 0 && isPolicyPath(operands[operands.length - 1]) ? ask(POLICY_WRITE) : null;
    case "sed":
    case "perl":
      return args.some((arg) => arg === "--in-place" || arg.startsWith("--in-place=") || shortCluster(arg, "i") || /^-i/.test(arg)) &&
        operands.some(isPolicyPath)
        ? ask(POLICY_WRITE)
        : null;
    default:
      return null;
  }
}

/**
 * Decide um comando já em palavras: tira atribuição, `rtk`/`rtk proxy`,
 * caminho do executável, invólucro e lançador, e olha o que sobra.
 * `context.bulk` marca o payload de `xargs` e `find -exec`.
 */
function judgeWords(input, context) {
  if (context.depth > MAX_DEPTH) return ask("comando aninhado demais para julgar");
  let words = input.slice();
  for (let guard = 0; guard < 64 && words.length > 0; guard++) {
    const head = words[0];
    if (ASSIGNMENT.test(head)) words.shift();
    else if (head === "rtk") {
      words.shift();
      if (words[0] === "proxy") words.shift();
    } else if (head.includes("/") && !head.endsWith("/")) words[0] = head.slice(head.lastIndexOf("/") + 1);
    else if (Object.hasOwn(WRAPPERS, head)) {
      if (head === "command" && words.slice(1).some((arg) => arg === "-v" || arg === "-V")) return null;
      words = skipOptions(words.slice(1), WRAPPERS[head]);
    } else break;
  }
  if (words.length === 0) return null;
  const [name, ...args] = words;
  let write = policyWrite(name, args);
  for (const path of writtenPaths(name, args)) write = stronger(write, outsideWrite(path, context.env ?? NO_ENV));
  switch (name) {
    case "sudo":
    case "doas":
    case "su":
    case "pkexec":
      return deny(`elevação de privilégio (${name})`);
    case "git":
      return judgeGit(args, context);
    case "rm":
      return judgeRm(args, context);
    case "chmod":
      return judgeChmod(args);
    case "chown":
    case "chgrp":
      return ask(`${name} muda o dono do arquivo`);
    case "ssh":
    case "scp":
    case "sftp":
      return ask(`${name} acessa outra máquina`);
    case "rsync":
      return stronger(write, ask("rsync copia para fora do projeto"));
    case "brew":
      return ask("brew altera pacotes do sistema");
    case "vercel":
      return judgeVercel(args);
    case "supabase":
      return judgeSupabase(args);
    case "npx":
    case "pnpx":
    case "bunx":
      return judgeLaunched(args, context);
    case "npm":
      return judgeNpm(args, context);
    case "pnpm":
    case "yarn":
      return judgePnpm(args, context);
    case "bun":
      return judgeBun(args, context);
    case "node":
      return judgeNode(args, context);
    case "tsx":
    case "ts-node":
    case "deno":
      return productionFile(args);
    case "script":
      return judgeScript(args, context);
    case "xargs": {
      const payload = skipOptions(args, XARGS);
      return judgeWords(payload.length > 0 ? payload : ["echo"], deeper(context, { bulk: true }));
    }
    case "find":
      return judgeFind(args, context);
    case "watch": {
      const payload = skipOptions(args, WATCH);
      return payload.length === 1 ? riskOf(payload[0], context.depth + 1, false, context.env) : judgeWords(payload, context);
    }
    case "eval":
      return riskOf(args.join(" "), context.depth + 1, false, context.env);
    case "sh":
    case "bash":
    case "zsh":
    case "dash":
    case "ksh":
    case "fish":
      return judgeShellInvocation(args, context);
    default:
      return write;
  }
}

/** @param {ShellEnv} env */
function riskOf(text, depth, bulk = false, env = NO_ENV) {
  if (depth > MAX_DEPTH) return ask("comando aninhado demais para julgar");
  const { commands } = splitSimple(lex(text).tokens);
  let worst = null;
  for (const command of commands) {
    for (const word of [...command.raw, ...command.redirects.map((redirect) => redirect.target)]) {
      if (isSecretWord(word)) return deny(`arquivo de segredo (${word})`);
    }
    for (const word of command.globs) {
      if (globMayBeSecret(word)) return deny(`curinga que pode abrir arquivo de segredo (${word})`);
    }
    for (const redirect of command.redirects) {
      // `>& arquivo` também grava; `>&2` e `>&-` só duplicam descritor.
      const writes = WRITE_REDIRECT.has(redirect.op) || (redirect.op === ">&" && !/^(?:\d+|-)$/.test(redirect.target));
      if (!writes) continue;
      if (isPolicyPath(redirect.target)) worst = stronger(worst, ask(POLICY_WRITE));
      worst = stronger(worst, outsideWrite(redirect.target, env));
    }
    for (const inner of command.subs) worst = stronger(worst, riskOf(inner, depth + 1, false, env));
    const words = commandWords(command.raw);
    if (words.length > 0) {
      const stdin = [
        ...command.heredocs.map((heredoc) => heredoc.body),
        ...command.redirects.filter((redirect) => redirect.op === "<<<").map((redirect) => redirect.target),
      ];
      worst = stronger(worst, judgeWords(words, { depth, bulk, stdin, env }));
    }
    if (worst?.decision === "deny") return worst;
  }
  return worst;
}

/**
 * Risco do comando, por token: corta em todo separador fora de aspas
 * (inclusive corpo de laço, `$(...)`, crase, `sh -c '…'`, `xargs` e
 * `find -exec`) e julga cada comando. `null` é "nada a perguntar".
 * @param {string} command
 * @param {ShellEnv} [env] onde o comando roda; sem ele, caminho absoluto fora do temporário pergunta
 * @returns {Risk | null}
 */
export function classifyRisk(command, env = NO_ENV) {
  return riskOf(command, 0, false, env);
}

// ---------------------------------------------------------------------------
// Lista do Claude Code e decisão combinada

/** Escapa texto literal para regex. */
export function escapeRegex(text) {
  return text.replace(/[.+?^${}()|[\]\\/-]/g, "\\$&");
}

/**
 * `Bash(prefixo:*)`, `Bash(com * curinga)` ou `Bash(exato)`, como o Claude Code lê.
 * @param {string} specifier
 * @param {string} command
 * @returns {boolean}
 */
export function bashSpecifierMatches(specifier, command) {
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
 * Regras `Bash(...)` de `.claude/settings.json` (`null` é `Bash` sem padrão).
 * @returns {BashRules | null}
 */
export function bashRulesFromSettings(settings) {
  const permissions = settings?.permissions;
  if (!permissions || typeof permissions !== "object") return null;
  /** @type {BashRules} */
  const rules = { allow: [], ask: [], deny: [] };
  for (const decision of /** @type {const} */ (["allow", "ask", "deny"])) {
    for (const entry of permissions[decision] ?? []) {
      const match = /^Bash(?:\((.*)\))?$/s.exec(entry);
      if (match) rules[decision].push(match[1] ?? null);
    }
  }
  return rules;
}

/**
 * Um comando simples contra a lista, com a precedência do Claude Code
 * (deny > ask > allow); `null` quando nenhuma regra o libera.
 * @param {BashRules} rules
 * @param {string} text
 * @returns {"allow" | "ask" | "deny" | null}
 */
export function decideByRules(rules, text) {
  const candidates = [text, text.replace(/^rtk\s+(?:proxy\s+)?/, "")];
  const hit = (list) => list.some((spec) => spec === null || candidates.some((candidate) => bashSpecifierMatches(spec, candidate)));
  if (hit(rules.deny)) return "deny";
  if (hit(rules.ask)) return "ask";
  if (candidates[1].split(/\s+/)[0] === "cd") return "allow";
  return hit(rules.allow) ? "allow" : null;
}

/**
 * Embutidos do shell que só testam, leem a entrada ou controlam o laço: no
 * corpo de laço passam sem regra `allow` (o classificador continua julgando).
 */
export const LOOP_BUILTINS = new Set(["[", "[[", ":", "true", "false", "read", "test", "break", "continue"]);

/** O texto começa por `for`/`while`/`until`/`if`/`case`. */
export function isLoop(command) {
  return LOOP_START.test(command.trim());
}

/**
 * Texto de um comando simples para conferir a lista `allow`: executável de
 * `/bin`, `/usr/bin` ou `/opt/homebrew/bin` vale pelo nome (`/bin/cat` é `cat`).
 * @param {string[]} words
 */
export function listText(words) {
  const [head, ...rest] = words;
  const slash = head.lastIndexOf("/");
  const name = slash > 0 && TRUSTED_BIN.has(head.slice(0, slash)) ? head.slice(slash + 1) : head;
  return [name, ...rest].join(" ");
}

/**
 * Os comandos simples que o shell roda, como a política os lê: sem palavra
 * reservada, sem padrão de `case` e sem cabeçalho de laço, com o de dentro de
 * `$(…)`, crase e `<(…)` também. É o que a guarda do Codex confere contra a
 * lista `allow` — a estrutura já foi julgada por `judgeShell` (#461).
 * @param {string} command
 * @returns {string[][]}
 */
export function simpleCommands(command) {
  /** @type {string[][]} */
  const found = [];
  const visit = (text, depth) => {
    for (const simple of splitSimple(lex(text).tokens).commands) {
      const words = commandWords(simple.raw);
      if (words.length > 0) found.push(words);
      // Fundo demais: o próprio texto entra, e nenhuma regra `allow` o libera.
      for (const inner of simple.subs) {
        if (depth < MAX_DEPTH) visit(inner, depth + 1);
        else found.push([inner]);
      }
    }
  };
  visit(command, 0);
  return found;
}

/**
 * Cada comando de um laço contra a lista, como se rodasse sozinho: o
 * `Bash(for:*)` libera a forma, não o corpo.
 * @param {BashRules | null} rules
 * @returns {ShellVerdict | null}
 */
function judgeLoopBody(command, rules) {
  if (!rules) return { decision: "ask", reason: "laço sem lista de permissões legível", kind: "body" };
  let worst = null;
  for (const simple of splitSimple(lex(command).tokens).commands) {
    const words = commandWords(simple.raw);
    if (words.length === 0 || LOOP_BUILTINS.has(words[0])) continue;
    const text = listText(words);
    const decision = decideByRules(rules, text);
    if (decision === "deny") return { decision: "deny", reason: `comando do laço negado pela lista: ${text}`, kind: "body" };
    if (decision !== "allow") worst ??= { decision: "ask", reason: `comando do laço fora da lista allow: ${text}`, kind: "body" };
  }
  return worst;
}

/**
 * A decisão da política de shell para os três harnesses: composto recusado
 * (`kind: "compound"`), risco do classificador e, em laço, o corpo contra a
 * lista. `null` deixa a decisão com a lista de cada harness.
 * @param {string} command
 * @param {BashRules | null} rules
 * @param {ShellEnv} [env] raiz do projeto, diretório atual e pessoal, para julgar escrita fora do projeto
 * @returns {ShellVerdict | null}
 */
export function judgeShell(command, rules, env = NO_ENV) {
  if (command.length > MAX_COMMAND) {
    return { decision: "ask", reason: `comando com mais de ${MAX_COMMAND} caracteres, grande demais para julgar`, kind: "risk" };
  }
  // Falha fecha: entrada que quebra a leitura (pilha, regex) pergunta em vez
  // de derrubar o hook — hook que cai deixa o comando passar.
  try {
    const text = command.trim();
    const compound = findCompound(text);
    if (compound) return { decision: "deny", reason: compound, kind: "compound" };
    const risk = classifyRisk(text, env);
    /** @type {ShellVerdict | null} */
    const verdict = risk ? { ...risk, kind: "risk" } : null;
    if (verdict?.decision === "deny" || !LOOP_START.test(text)) return verdict;
    const body = judgeLoopBody(text, rules);
    if (!verdict) return body;
    return body?.decision === "deny" ? body : verdict;
  } catch (error) {
    return { decision: "ask", reason: `a política de shell não conseguiu julgar o comando (${error?.message ?? error})`, kind: "risk" };
  }
}

// ---------------------------------------------------------------------------
// Mensagens

/**
 * Heredoc e `$(...)` continuam recusados de propósito, mesmo em mensagem de
 * commit: uma recusa custa uma nova tentativa, um prompt de aprovação trava
 * o dono. Só esses motivos ganham a sugestão de `git commit -F <arquivo>`.
 */
const SUGGESTS_COMMIT_FILE = new Set(["quebra de linha (vários comandos)", SUBST, "heredoc"]);

/** @param {string} found */
export function compoundMessage(found) {
  const suggestion = SUGGESTS_COMMIT_FILE.has(found)
    ? " Mensagem de commit com corpo ou heredoc: escreva com a ferramenta de arquivo e rode " +
      "`git commit -F <arquivo>`, ou use vários `-m`."
    : "";
  return (
    `Comando composto recusado (${found}). Regra: um comando por chamada de shell — ` +
    "sem &&, ||, ;, &, $(...), crase ou várias linhas fora de aspas; pipe só quando todo " +
    "estágio é leitura (cat, head, tail, grep, rg, jq, sort, wc, ls, git status/diff/log/show); " +
    "laço for/while/until/if/case aceito, com cada comando do corpo julgado. " +
    "Divida em chamadas separadas (independentes podem ir em paralelo na mesma resposta); " +
    "para filtrar saída use a opção do próprio comando (--jq, --json, grep com arquivo) ou um script em arquivo." +
    suggestion
  );
}

/**
 * Texto do bloqueio nos harnesses cujo hook não sabe perguntar (Codex e
 * OpenCode): o que no Claude Code espera aprovação, ali espera a pessoa rodar.
 * @param {ShellVerdict} verdict
 * @param {string} harness
 */
export function blockMessage(verdict, harness) {
  if (verdict.kind === "compound") return compoundMessage(verdict.reason);
  return verdict.decision === "deny"
    ? `Proibido pela política do projeto (deny): ${verdict.reason}.`
    : `Exige aprovação humana pela política do projeto (ask): ${verdict.reason}. ` +
        `O hook do ${harness} não sabe perguntar, então peça à pessoa para rodar o comando.`;
}
