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

export function matchesTerm(term: string, text: string): boolean {
  if (!termKey(term)) return false;
  return new RegExp(termRegexSql(term), "i").test(text);
}
