/**
 * Mini-avaliador de expressões do GitHub Actions (3ª revisão L2 da PR #376,
 * minor 1). NÃO é um motor de expressões genérico — cobre só o subconjunto
 * que `runs-on:` usa hoje: literais de string, acesso a caminho com ponto
 * (`github.event_name`, `vars.CI_RUNS_ON`), `==`/`!=`, `&&`/`||` com
 * curto-circuito (semântica igual à do próprio motor do Actions: o operador
 * devolve o OPERANDO, não um booleano forçado) e uma chamada de função de um
 * argumento (`fromJSON(...)`). Existe para provar equivalência avaliando a
 * STRING DE VERDADE de `CANONICAL_RUNS_ON` — não para reimplementar a
 * decisão em TypeScript e comparar duas implementações que poderiam divergir
 * do texto do YAML sem que nenhum teste percebesse.
 */

type Token =
  | { type: "string"; value: string }
  | { type: "ident"; value: string }
  | { type: "op"; value: "&&" | "||" | "==" | "!=" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < source.length && source[j] !== "'") {
        value += source[j];
        j += 1;
      }
      if (source[j] !== "'") throw new Error(`string sem fechamento em: ${source.slice(i)}`);
      tokens.push({ type: "string", value });
      i = j + 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma" });
      i += 1;
      continue;
    }
    if (source.startsWith("&&", i)) {
      tokens.push({ type: "op", value: "&&" });
      i += 2;
      continue;
    }
    if (source.startsWith("||", i)) {
      tokens.push({ type: "op", value: "||" });
      i += 2;
      continue;
    }
    if (source.startsWith("==", i)) {
      tokens.push({ type: "op", value: "==" });
      i += 2;
      continue;
    }
    if (source.startsWith("!=", i)) {
      tokens.push({ type: "op", value: "!=" });
      i += 2;
      continue;
    }
    if (/[A-Za-z0-9_.]/.test(ch)) {
      let j = i;
      let value = "";
      while (j < source.length && /[A-Za-z0-9_.]/.test(source[j]!)) {
        value += source[j];
        j += 1;
      }
      tokens.push({ type: "ident", value });
      i = j;
      continue;
    }
    throw new Error(`token inesperado em expressão de runs-on, perto de: ${source.slice(i, i + 12)}`);
  }
  return tokens;
}

/** Segue um caminho com ponto num objeto de contexto, sem lançar em nível ausente. */
function resolvePath(context: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, context);
}

class Parser {
  private readonly tokens: Token[];
  private readonly context: Record<string, unknown>;
  private position = 0;

  constructor(tokens: Token[], context: Record<string, unknown>) {
    this.tokens = tokens;
    this.context = context;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private consume(): Token {
    const token = this.tokens[this.position];
    if (!token) throw new Error("fim inesperado da expressão");
    this.position += 1;
    return token;
  }

  parseExpression(): unknown {
    return this.parseOr();
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.peek()?.type === "op" && (this.peek() as { value: string }).value === "||") {
      this.consume();
      // Curto-circuito: só USA o valor da direita se a esquerda for falsy
      // (mesma regra do `||` do Actions/JS) — decisivo aqui porque usar
      // `fromJSON` de um valor ausente incondicionalmente mascararia um bug
      // de precedência entre a guarda de fork e o fallback hospedado. Ainda
      // assim é preciso CONSUMIR os tokens da direita quando descartados —
      // sem isso o parser fica fora de sincronia com o resto da expressão
      // (por exemplo, o `)` que fecha um `fromJSON(...)` ao redor).
      if (left) {
        this.parseAnd();
        continue;
      }
      left = this.parseAnd();
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseComparison();
    while (this.peek()?.type === "op" && (this.peek() as { value: string }).value === "&&") {
      this.consume();
      if (!left) {
        // Ainda precisa consumir o operando da direita para o parser
        // continuar em sincronia, mesmo descartando o resultado.
        this.parseComparison();
        continue;
      }
      left = this.parseComparison();
    }
    return left;
  }

  private parseComparison(): unknown {
    const left = this.parsePrimary();
    const next = this.peek();
    if (next?.type === "op" && (next.value === "==" || next.value === "!=")) {
      this.consume();
      const right = this.parsePrimary();
      return next.value === "==" ? left === right : left !== right;
    }
    return left;
  }

  private parsePrimary(): unknown {
    const token = this.consume();
    if (token.type === "string") return token.value;
    if (token.type === "lparen") {
      const value = this.parseExpression();
      if (this.peek()?.type !== "rparen") throw new Error("parêntese sem fechamento");
      this.consume();
      return value;
    }
    if (token.type === "ident") {
      if (this.peek()?.type === "lparen") {
        this.consume();
        const arg = this.parseExpression();
        if (this.peek()?.type !== "rparen") throw new Error(`chamada de ${token.value} sem fechamento`);
        this.consume();
        return this.callFunction(token.value, arg);
      }
      return resolvePath(this.context, token.value);
    }
    throw new Error(`token inesperado no lugar de um valor: ${JSON.stringify(token)}`);
  }

  private callFunction(name: string, arg: unknown): unknown {
    if (name === "fromJSON") {
      if (typeof arg !== "string") throw new Error("fromJSON recebeu algo que não é string");
      return JSON.parse(arg);
    }
    throw new Error(`função não suportada pelo mini-avaliador: ${name}`);
  }
}

/**
 * Avalia uma expressão do GitHub Actions (sem os delimitadores `${{ }}`)
 * contra um contexto simulado. Lança se a expressão usar sintaxe fora do
 * subconjunto suportado — de propósito: silenciar um erro de parse
 * esconderia exatamente a divergência que este avaliador existe para achar.
 */
export function evaluateGithubActionsExpression(expression: string, context: Record<string, unknown>): unknown {
  const trimmed = expression.trim().replace(/^\$\{\{/, "").replace(/\}\}$/, "").trim();
  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens, context);
  return parser.parseExpression();
}
