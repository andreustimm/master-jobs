/**
 * Termo de busca: validação, chave de equivalência e padrão de palavra inteira.
 *
 * Quatro lugares casam um termo — o filtro da tela Vagas (SQL), a atribuição
 * de vaga na captura, o filtro de relevância das trilhas aceitas e a
 * equivalência ao salvar — e os quatro precisam concordar sobre o que é uma
 * palavra. Por isso a borda é a do scorer (`TERM_BOUNDARY`), definida uma vez
 * aqui, e a mesma string de regex serve ao TypeScript e ao `~*` do PostgreSQL
 * (ADR-012).
 *
 * Função pura: sem banco, sem rede, sem relógio.
 */

/**
 * O que separa palavras: tudo que não é letra ASCII, dígito, `+` ou `#`.
 *
 * `+` e `#` ficam dentro da palavra para que `C#` e `C++` não virem `c`.
 */
export const TERM_BOUNDARY = "[^a-z0-9+#]";

export const TERM_MIN_LENGTH = 2;
export const TERM_MAX_LENGTH = 60;

export type TermError = "term_too_short" | "term_too_long" | "term_invalid_char" | "term_no_alnum";

export type ValidTerm = { term: string; key: string };

/** Letras (acentuadas inclusive), dígitos, espaço e `+ # . - /`. */
const ALLOWED_CHAR = /^[\p{L}\p{N} +#./-]$/u;
const ALNUM = /^[\p{L}\p{N}]$/u;

export function validateTerm(
  raw: string,
): { ok: true; value: ValidTerm } | { ok: false; code: TermError; char?: string } {
  const term = raw.trim().replace(/\s+/g, " ");
  const chars = [...term];
  if (chars.length < TERM_MIN_LENGTH) return { ok: false, code: "term_too_short" };
  if (chars.length > TERM_MAX_LENGTH) return { ok: false, code: "term_too_long" };
  const invalid = chars.find((char) => !ALLOWED_CHAR.test(char));
  if (invalid !== undefined) return { ok: false, code: "term_invalid_char", char: invalid };
  if (!chars.some((char) => ALNUM.test(char))) return { ok: false, code: "term_no_alnum" };
  return { ok: true, value: { term, key: termKey(term) } };
}

/**
 * Chave de equivalência: `Tech Lead`, `tech-lead` e `Techlead` são um termo só.
 *
 * Espaço e hífen somem da chave, maiúscula vira minúscula. Sinônimo não entra —
 * `Technical Lead` é outro termo; quem quer os dois põe os dois como título-alvo
 * da trilha.
 */
export function termKey(term: string): string {
  return term.trim().toLowerCase().replace(/[\s-]+/g, "");
}

function escapeRegex(char: string): string {
  return /[.*+?^${}()|[\]\\/]/.test(char) ? `\\${char}` : char;
}

/**
 * O corpo do padrão, sem as bordas.
 *
 * Um separador opcional `[ -]?` entra entre duas letras ou dígitos seguidos da
 * chave, e é isso que faz `techlead` casar `tech lead` e `tech-lead`. O preço é
 * aceitar grafias raras como `ja va` — ruído aceito na ADR-012. Não entra
 * separador ao lado de símbolo: `c++` continua `c\+\+`.
 */
export function termPattern(term: string): string {
  const chars = [...termKey(term)];
  let body = "";
  chars.forEach((char, index) => {
    const previous = chars[index - 1];
    if (previous !== undefined && ALNUM.test(previous) && ALNUM.test(char)) body += "[ -]?";
    body += escapeRegex(char);
  });
  return body;
}

/**
 * A regex completa, com a borda do scorer dos dois lados.
 *
 * Serve ao `~*` do PostgreSQL e ao `RegExp` do TypeScript sem adaptação. Vai
 * sempre como parâmetro ligado da consulta, nunca interpolada no SQL.
 */
export function termRegexSql(term: string): string {
  return `(^|${TERM_BOUNDARY})${termPattern(term)}(${TERM_BOUNDARY}|$)`;
}

/**
 * A frase entre aspas: as palavras nessa ordem, separadas por um ou mais
 * espaços, com a mesma borda do termo. Diferente do termo, não junta nem
 * separa letras — `"tech lead"` não casa "techlead" nem "tech-lead".
 *
 * O `termPrefilterLike` da frase continua condição necessária: o trecho casado
 * é a frase com espaços, e sem espaço e hífen ele é exatamente `termKey`.
 */
export function phraseRegexSql(phrase: string): string {
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const body = words.map((word) => [...word].map(escapeRegex).join("")).join(" +");
  return `(^|${TERM_BOUNDARY})${body}(${TERM_BOUNDARY}|$)`;
}

/** Chave só com ASCII minúsculo, dígito e os símbolos que `termKey` preserva. */
const PREFILTER_KEY = /^[a-z0-9+#./]+$/;
/** Sem três letras ou dígitos seguidos o pg_trgm não extrai trigrama útil. */
const TRIGRAM_RUN = /[a-z0-9]{3}/;

/**
 * O `ilike` que o índice trigrama responde, ou `null` quando o termo não o
 * aproveita e a busca segue só com o `~*`.
 *
 * É condição NECESSÁRIA do padrão, nunca suficiente: se `termRegexSql(term)`
 * casa um texto, então o texto sem espaço e sem hífen contém a chave — o trecho
 * casado é a chave com, no máximo, `[ -]` entre letras, e é exatamente isso que
 * `replace(replace(texto, ' ', ''), '-', '')` apaga. O `~*` continua na
 * consulta e decide; o pré-filtro só descarta quem nunca casaria.
 *
 * A prova vale para letras ASCII, onde `~*` e `ilike` concordam sobre caixa em
 * qualquer locale usado aqui. Acento e letra de outro alfabeto têm regras de
 * caixa que dependem da collation, e um pré-filtro que recusasse o que o `~*`
 * aceita esconderia vaga: esses termos, e os curtos demais para trigrama,
 * ficam sem pré-filtro. `%`, `_` e `\` não passam por `PREFILTER_KEY`, então o
 * padrão não precisa de escape.
 */
export function termPrefilterLike(term: string): string | null {
  const key = termKey(term);
  if (!PREFILTER_KEY.test(key) || !TRIGRAM_RUN.test(key)) return null;
  return `%${key}%`;
}

export function matchesTerm(term: string, text: string): boolean {
  if (!termKey(term)) return false;
  return new RegExp(termRegexSql(term), "i").test(text);
}
