/**
 * A versão PUBLICÁVEL do texto do currículo. Função pura: texto entra, texto sai.
 *
 * O segundo consentimento (`publicCv`) autoriza publicar o currículo; ele não
 * revoga as regras do perfil público. E-mail, telefone e piso salarial nunca
 * saem por `/p/[slug]` — como campo ou como frase dentro do texto. Sem esta
 * camada, a lista de permissão do DTO protegia as colunas e o CV entregava as
 * mesmas coisas escritas por extenso (E15): um currículo costuma trazer o
 * endereço no cabeçalho e, às vezes, a pretensão salarial no rodapé.
 *
 * **O limite é declarado, não escondido.** A detecção é por padrão textual:
 *
 * - e-mail: qualquer endereço com `@` e domínio, e o e-mail cadastrado da
 *   pessoa, literal, mesmo em forma que o padrão geral não reconheça;
 * - telefone: número com código de país (`+55 11 91234-5678`, também em grupos
 *   soltos como `+33 1 23 45 67 89`) ou com DDD entre parênteses
 *   (`(11) 91234-5678`) — um número sem essas marcas não é distinguível de um
 *   intervalo de anos ou de um valor, e fica;
 * - piso: o BLOCO inteiro — parágrafo, item, tabela, tudo entre duas linhas
 *   em branco — em que aparece um rótulo de pretensão (`piso:`, `pretensão`,
 *   `faixa salarial`, `valor hora`, `salary expectation`, `rate:`…) ou uma
 *   palavra de remuneração (`salário`, `remuneração`, `salary`,
 *   `compensation`) a até 60 caracteres de um valor que não seja ano. O bloco é lido como texto corrido,
 *   então um rótulo quebrado em duas linhas continua sendo rótulo, e o valor
 *   sai esteja antes ou depois dele. Num bloco com títulos de seção — o CV
 *   extraído de PDF, sem linha em branco —, sai a seção do piso até o
 *   próximo nome de seção conhecido; sem título, sem valor na seção ou com
 *   resto que ainda parece piso, o bloco inteiro. Esse corte tem dois
 *   preços, ambos escolhidos: valor a três linhas ou mais da seção (ou duas
 *   seções depois), e número sem cara de dinheiro ("150") do outro lado de
 *   um nome de seção, passam; valor com cara de dinheiro a até duas linhas dela
 *   derruba o CV inteiro, e a linha com número logo acima do rótulo sai
 *   mesmo que seja um item neutro. Num título Markdown, sai a seção inteira
 *   até o próximo título de mesmo nível ou acima. Um valor sem rótulo nem
 *   palavra de remuneração não é reconhecido; um bloco com "reduzi o custo de
 *   salário em 30%" some sem ser piso — diante da dúvida, esconde-se.
 *
 * Não é sanitização perfeita, e não se apresenta como tal: quem escreve o
 * piso sem rótulo no meio de um parágrafo o publica. O que ela garante é que
 * as formas usuais não vazem pelo consentimento dado para outra coisa.
 */

import { cvTextToMarkdown, isHeading, isKnownHeading } from "./cv-markdown.ts";

export const REDACTED = "[…]";

// O lookbehind só deixa a tentativa começar no início de uma sequência de
// caracteres de endereço: sem ele, cada posição de uma palavra longa sem `@`
// reexaminava o resto dela, e o custo era quadrático (#344).
const EMAIL_BODY = String.raw`[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}`;
const EMAIL = new RegExp(String.raw`(?<![\p{L}\p{N}._%+-])${EMAIL_BODY}`, "gu");
// Sticky, para o endereço colado ao fim do anterior ("a@x.com-b@y.com"), que
// o lookbehind esconderia.
const EMAIL_HERE = new RegExp(EMAIL_BODY, "uy");

function redactEmails(text: string): string {
  let out = "";
  let from = 0;
  // `exec` a partir de `from`: um match descartado por começar antes dele
  // levaria junto o endereço que começa dentro dele ("…@c.de@f.gh@i.jk").
  for (;;) {
    EMAIL.lastIndex = from;
    const match = EMAIL.exec(text);
    if (!match) break;
    let end = match.index + match[0].length;
    out += text.slice(from, match.index) + REDACTED;
    for (;;) {
      EMAIL_HERE.lastIndex = end;
      const next = EMAIL_HERE.exec(text);
      if (!next) break;
      out += REDACTED;
      end += next[0].length;
    }
    from = end;
  }
  return out + text.slice(from);
}

/**
 * Telefone internacional: `+`, código e grupos de dígitos com um separador
 * simples entre eles, nunca atravessando linha. A leitura para ao passar de
 * 15 dígitos (o teto do E.164), para que um `2015-2020` logo depois do número
 * não o torne longo demais para ser telefone — e só redige a partir de 8,
 * para que `+30%` ou `+2 anos` fiquem.
 */
const INTERNATIONAL_START = /\+(?=\d)/g;
// Separadores de telefone: espaço, ponto, hífen, traço (– —) e barra.
// O separador pode vir cercado de espaço: `+55 11 91234 - 5678`.
// Sticky: lê a partir de `lastIndex` sem copiar o resto do texto a cada grupo.
const PHONE_GROUP = /(?:[ \t]*[.\-–—/][ \t]*|[ \t]+)?\(?(\d{1,5})\)?/uy;
const PHONE_SEP = "(?:[ \\t]*[.\\-–—/][ \\t]*|[ \\t]+)?";
// DDD brasileiro (`(11) 91234-5678`) e código de área norte-americano
// (`(415) 555-0100`).
const LOCAL_PHONE = new RegExp(
  `\\(\\d{2,3}\\)[ \\t]*(?:(?:9${PHONE_SEP})?\\d{4}|\\d{3})${PHONE_SEP}\\d{4}`,
  "gu",
);

function redactInternationalPhones(text: string): string {
  let out = "";
  let from = 0;
  for (const start of text.matchAll(INTERNATIONAL_START)) {
    if (start.index < from) continue;
    let at = start.index + 1;
    let digits = 0;
    let end = at;
    for (;;) {
      PHONE_GROUP.lastIndex = at;
      const group = PHONE_GROUP.exec(text);
      if (!group || digits + group[1]!.length > 15) break;
      // Um ano solto depois de um telefone já completo é o texto seguinte.
      if (digits >= 8 && /^\s+(?:19|20)\d{2}$/.test(group[0])) break;
      digits += group[1]!.length;
      at += group[0].length;
      end = at;
    }
    if (digits < 8) continue;
    out += text.slice(from, start.index) + REDACTED;
    from = end;
  }
  return out + text.slice(from);
}

/**
 * Rótulos de pretensão salarial em português e inglês, que valem sozinhos:
 * são inequívocos mesmo sem número no bloco (o valor pode estar numa célula
 * ao lado ou na linha de baixo).
 */
const SALARY_LABEL = new RegExp(
  [
    // `piso` sozinho é chão de fábrica; só conta com o que o faz salarial.
    "\\bpiso\\s*(?::|salarial|m[íi]nimo|de\\s+(?:remunera|sal[áa]rio))",
    // "Pretensão PJ:", "pretensões salariais"; "sem pretensões comerciais" fica.
    "pretens(?:[ãa]o|[õo]es)\\b(?!\\s+(?:comercia|art[íi]stic|liter[áa]ri|acad[êe]mic))",
    "expectativa\\s+(?:salarial|de\\s+remunera)",
    "faixa\\s+salarial",
    // Sem `\s*[\s/-]\s*`: os dois `\s*` voltavam atrás numa linha de espaços.
    "valor(?:\\s*[/-]\\s*|\\s+)(?:da\\s+)?hora",
    "salary\\s*(?:floor|expectations?|requirements?|minimum)",
    // Palavra de remuneração como RÓTULO ("Salary: 2000 EUR"): vale sem
    // olhar o número, que pode parecer um ano.
    "\\b(?:salar(?:y|ies)|sal[áa]rio|remunera[çc][ãa]o|compensation|pay)\\s*:",
    "(?:minimum|desired|expected|target)\\s+(?:salary|compensation|rate|pay)",
    "compensation\\s*(?:floor|expectations?|requirements?)",
    // `rate:` só como rótulo no começo da linha (recuada ou não), de item,
    // de lista numerada ou de célula; "Success rate: 99%" no meio da frase fica.
    // O marcador de item só conta no começo da linha: "error-rate: 0.1%" fica.
    "(?:^|\\n|\\|)\\s*(?:[·•*-]\\s*|\\d+[.)]\\s*)?(?:(?:hourly|daily|day)\\s+)?rate\\s*(?::|floor)",
  ].join("|"),
  "iu",
);

/**
 * Palavras de remuneração que só contam PERTO de um valor (60 caracteres, no
 * texto corrido do bloco): "Salário atual: R$ 25.000" é piso, "Salary range
 * benchmarking tool" seguido de "2019-2021" não é. Ano de quatro dígitos não
 * conta como valor.
 */
const PAY_WORD = "\\b(?:sal[áa]ri(?:o|os|al|ais)|remunera[çc](?:[ãa]o|[õo]es)|salar(?:y|ies)|compensation|pay\\s+rate|hourly\\s+rate)\\b";
// Ano sozinho não é valor; seguido de moeda ou de `k`, é ("2000 EUR").
const AMOUNT =
  "(?:[$€£¥]|R\\$|\\b(?:usd|eur|brl|gbp)\\s*\\d|\\b(?!(?:19|20)\\d{2}\\b)\\d|\\b(?:19|20)\\d{2}\\s*(?:k\\b|usd|eur|brl|gbp|reais|d[óo]lares|euros))";
const HAS_AMOUNT = new RegExp(AMOUNT, "iu");
// Valor com cara de dinheiro — moeda, `k`, `mil`, milhar com separador ou
// quatro dígitos que não sejam ano —, que não se confunde com "equipe de 12
// pessoas", "20+ anos" ou "99,9%".
const MONEY_LIKE =
  /[$€£¥]|R\$|\b(?:usd|eur|brl|gbp|reais|d[óo]lares|euros)\b|\d\s*k\b|\d\s*(?:mil|mi|milh[õo]es|thousand|million)\b|\d\s*\/\s*(?:h|hora|hour|dia|day|m[êe]s|month)\b|\d{1,3}(?:[.,]\d{3})+|\b(?!(?:19|20)\d{2}\b)\d{4,}/iu;
const PAY_NEAR_AMOUNT = new RegExp(`${PAY_WORD}.{0,60}?${AMOUNT}|${AMOUNT}.{0,60}?${PAY_WORD}`, "iu");

function isSalaryBlock(block: string): boolean {
  // Ênfase Markdown não separa rótulo de valor: `**Piso**: 180000`.
  const plain = block.replace(/[*_`~]/g, "");
  const prose = plain.replace(/\s+/g, " ");
  return SALARY_LABEL.test(plain) || SALARY_LABEL.test(prose) || PAY_NEAR_AMOUNT.test(prose);
}

/** Título que anuncia remuneração: a seção inteira é o valor. */
const PAY_HEADING = new RegExp(PAY_WORD, "iu");

/**
 * Título em texto puro: um bloco que é só a palavra de remuneração, com
 * dois-pontos ou sublinhado Setext (`Salário\n-------`). Promete o valor no
 * bloco seguinte, como o rótulo isolado.
 */
const PAY_ONLY = new RegExp(`^\\s*${PAY_WORD}\\s*:?\\s*$`, "iu");

function isPayTitle(block: string): boolean {
  const lines = block
    .replace(/[*_`~#]/g, "")
    .split("\n")
    .filter((line) => !/^\s*[-=]{2,}\s*$/.test(line));
  return lines.length === 1 && PAY_ONLY.test(lines[0]!);
}

/**
 * O piso dentro de um bloco de várias linhas. Texto extraído de PDF costuma
 * vir sem linha em branco, e aí o bloco é o CV inteiro: tirá-lo todo por
 * causa de uma linha de pretensão apagava o perfil (#344).
 *
 * Sai a SEÇÃO do piso, com os títulos que `cvTextToMarkdown()` reconheceria:
 * - começa no rótulo — "PRETENSÃO SALARIAL", "Pretensão Salarial" ou
 *   "Pretensão salarial: R$ 30.000" como último item da experiência —, e não
 *   no título anterior, que levaria a experiência inteira; antes do primeiro
 *   título do bloco, começa no início dele;
 * - termina antes do próximo nome de seção conhecido ("FORMAÇÃO",
 *   "Experience"). Um título qualquer em caixa alta ("PJ MENSAL") não fecha
 *   a seção: ele pode ser parte da pretensão.
 *
 * Sem título, a seção é o bloco — o comportamento de antes. Seção sem valor do
 * rótulo em diante ("a combinar") sai sozinha e, se vai até o fim do bloco,
 * promete o valor no bloco seguinte. O bloco inteiro sai quando o que sobra,
 * lido como texto corrido, ainda parece piso, ou quando há valor
 * com cara de dinheiro (`MONEY_LIKE`) nas bordas: até duas linhas de cada
 * lado e, depois de uma sequência de nomes de seção conhecidos, as duas
 * primeiras da seção vizinha. Um "Employment:" dentro da pretensão, um título
 * falso acima do rótulo ou um valor duas linhas acima dele cortariam a seção
 * antes do valor; na dúvida, fecha-se. A borda é curta de propósito: a
 * métrica de um CV de sênior ("1.200 clientes") na experiência não é piso, e
 * derrubaria o perfil inteiro.
 */
function narrowSalaryBlock(lines: string[]): { kept: string[]; valueExpected: boolean } | null {
  const isHit = (text: string) => isSalaryBlock(text) || isPayTitle(text);
  const known = (j: number) => isKnownHeading(lines[j]!.trim());
  const drop = lines.map(() => false);
  // Dinheiro numa borda, andando `step` a partir de `from`: até BORDER linhas
  // antes do nome de seção conhecido e, pulada a sequência deles
  // ("Skills\nIdiomas"), até BORDER linhas da seção vizinha. Linha já retirada
  // (outra pretensão) não conta.
  const BORDER = 2;
  // `here` vale até o nome de seção; do outro lado dele, só `MONEY_LIKE`: a
  // experiência que abre com "equipe de 12" não é pretensão.
  const moneyNear = (from: number, step: 1 | -1, here: RegExp = MONEY_LIKE): boolean => {
    let sections = 0;
    let seen = 0;
    for (let j = from; j >= 0 && j < lines.length; ) {
      if (known(j)) {
        if (++sections > 1) return false;
        seen = 0;
        while (j >= 0 && j < lines.length && known(j)) j += step;
        continue;
      }
      if (seen++ === BORDER) return false;
      if (!drop[j] && (sections === 0 ? here : MONEY_LIKE).test(lines[j]!)) return true;
      j += step;
    }
    return false;
  };
  // Antes do primeiro título o bloco não tem estrutura: o corte vai do começo.
  let structured = false;
  let valueExpected = false;
  for (let i = 0; i < lines.length; i++) {
    const title = isHeading(lines[i]!.trim());
    let last = i;
    if (!isHit(lines[i]!)) {
      const next = lines[i + 1];
      if (next === undefined || isHit(next) || !isHit(`${lines[i]}\n${next}`)) {
        structured ||= title;
        continue;
      }
      last = i + 1;
    }
    const start = title || structured ? i : 0;
    while (last + 1 < lines.length && !known(last + 1)) last++;
    // Sem valor do rótulo em diante — um número acima dele ("Equipe de 12")
    // não é a pretensão (#353) —, ela é "a combinar" ou está fora da seção:
    // qualquer número nas bordas ("150" solto) derruba o bloco, e o bloco
    // seguinte é o valor prometido.
    const valueless = !HAS_AMOUNT.test(lines.slice(i, last + 1).join("\n"));
    const near = valueless ? HAS_AMOUNT : MONEY_LIKE;
    if (moneyNear(start - 1, -1, near) || moneyNear(last + 1, 1, near)) return null;
    for (let j = start; j <= last; j++) drop[j] = true;
    // Valor sem cara de dinheiro ("90/hour", "150") logo acima do rótulo. Um
    // item neutro com número ("Mentoria de 6 engenheiros") sai junto.
    if (start > 0 && HAS_AMOUNT.test(lines[start - 1]!)) drop[start - 1] = true;
    if (valueless) valueExpected = true;
    i = last;
  }
  const kept = lines.filter((_, i) => !drop[i]);
  if (isSalaryBlock(kept.join("\n"))) return null;
  return { kept, valueExpected };
}

/**
 * O bloco do rótulo, do rótulo em diante. Um número acima dele ("Equipe de 12
 * pessoas") não é o valor prometido, e não pode cancelar a retirada do
 * parágrafo seguinte (#353). Sem linha nem par de linhas reconhecido — o
 * rótulo só aparece no texto corrido —, vale o bloco inteiro.
 */
function fromLabel(lines: string[]): string {
  const isHit = (text: string) => isSalaryBlock(text) || isPayTitle(text);
  const at = lines.findIndex((line, i) => {
    if (isHit(line)) return true;
    const next = lines[i + 1];
    // O par só conta para o rótulo quebrado, não para a linha antes do rótulo.
    return next !== undefined && !isHit(next) && isHit(`${line}\n${next}`);
  });
  return lines.slice(Math.max(at, 0)).join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HEADING = /^(#{1,6})\s/;

/** Linhas em blocos: separados por linha em branco, e um título é bloco sozinho. */
function blocks(lines: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) out.push(current);
    current = [];
  };
  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      out.push([line]);
    } else if (HEADING.test(line)) {
      flush();
      out.push([line]);
    } else {
      current.push(line);
    }
  }
  flush();
  return out;
}

/** E-mails que a instalação já sabe serem da pessoa: o do candidato e o da conta. */
export type KnownContact = { email?: string | null; emails?: readonly (string | null | undefined)[] };

function knownEmails(known: KnownContact): string[] {
  return [known.email, ...(known.emails ?? [])]
    .map((email) => email?.trim() ?? "")
    .filter((email) => email !== "");
}

/**
 * Um campo CURTO do perfil público — nome, headline, localização — que traz
 * e-mail ou telefone.
 *
 * Mesma detecção do currículo, e um caso a mais: uma sequência de dez dígitos
 * seguidos (`11912345678`). No texto corrido do currículo ela fica, porque não
 * se distingue de um número qualquer; num nome ou numa headline ninguém escreve
 * dez dígitos sem separador que não sejam um telefone. Intervalo de anos
 * (`2004-2024`) tem separador e não conta.
 *
 * Não redige: quem chama descarta o campo inteiro. Um nome com o e-mail no
 * meio, publicado com `[…]` no lugar, ainda diria de quem é o endereço.
 */
export function containsContact(text: string, known: KnownContact = {}): boolean {
  const normalized = text.normalize("NFC").replace(/[   ]/g, " ");
  const lower = normalized.toLowerCase();
  if (knownEmails(known).some((email) => lower.includes(email.toLowerCase()))) return true;
  if (redactEmails(normalized) !== normalized) return true;
  if (redactInternationalPhones(normalized) !== normalized) return true;
  if (normalized.replace(LOCAL_PHONE, REDACTED) !== normalized) return true;
  return /\d{10,}/.test(normalized);
}

/**
 * Um campo CURTO do perfil público (#327: área, idiomas) com cara de
 * pretensão salarial — a mesma régua do bloco do currículo (`isSalaryBlock`,
 * `isPayTitle`): rótulo de piso, palavra de remuneração como rótulo ou perto
 * de um valor. Mesmo limite declarado no topo deste arquivo: valor sem rótulo
 * passa — por isso o campo curto também passa pela régua de valor própria
 * (`containsShortFieldPay()`, em `candidate-public-facts.ts`). Como
 * `containsContact()`, não redige — quem chama descarta o campo.
 *
 * **Espaço colapsado antes das expressões.** A alternativa de `rate:` no começo
 * de linha (`(?:^|\n|\|)\s*…`) é quadrática numa sequência de quebras — cada
 * `\n` reabre um `\s*` sobre todas as seguintes (80 mil quebras: 3,6 s, revisão
 * L2 da #362). Com o espaço colapsado, cada `\s*` consome no máximo um
 * caractere. O preço é perder a âncora de linha de `rate:` ("Dados\nRate:
 * 150" passaria aqui); `containsShortFieldPay()` o paga contando `rate` com
 * número ou dois-pontos em qualquer posição.
 */
export function containsPay(text: string): boolean {
  const normalized = text.normalize("NFC").replace(/\s+/g, " ");
  return isSalaryBlock(normalized) || isPayTitle(normalized);
}

export function publicCvText(content: string, known: KnownContact = {}): string {
  const out: string[] = [];
  // Nível do título cuja seção inteira está saindo, ou nulo.
  let skippingSection: number | null = null;
  // Rótulo sozinho num parágrafo ("Pretensão salarial:") promete o valor no
  // bloco seguinte, que também sai.
  let valueExpected = false;
  // NFC: um "ã" digitado como "a" + til combinante não casaria com o rótulo.
  // Espaço inseparável (U+00A0, U+2007, U+202F) vira espaço comum: é como
  // editores e PDFs costumam separar os grupos de um telefone.
  const normalized = content.normalize("NFC").replace(/[\u00A0\u2007\u202F]/g, " ");
  for (const block of blocks(normalized.split("\n"))) {
    const heading = HEADING.exec(block[0]!);
    if (skippingSection !== null) {
      if (heading && heading[1]!.length <= skippingSection) skippingSection = null;
      else continue;
    }
    const text = block.join("\n");
    if (text.trim() === "") {
      for (const line of block) out.push(line);
      continue;
    }
    if (valueExpected) {
      valueExpected = false;
      // Um título seguinte — Markdown ou nome de seção conhecido — abre outra
      // seção; ele não é o valor prometido. Mas "Employment:\n150k USD" é
      // sub-rótulo de regime, não seção: dinheiro na seção que o nome abre (até
      // o próximo nome conhecido) faz do bloco o valor.
      const end = block.findIndex((line, i) => i > 0 && isKnownHeading(line.trim()));
      const opensSection =
        isKnownHeading(block[0]!.trim()) &&
        !block.slice(1, end === -1 ? block.length : end).some((line) => MONEY_LIKE.test(line));
      if (heading === null && !opensSection && HAS_AMOUNT.test(text)) {
        // O bloco consumido pode ser, ele mesmo, um rótulo sem valor
        // ("Opção 2\nPretensão PJ:"), que promete o bloco seguinte.
        if (isSalaryBlock(text) || isPayTitle(text)) valueExpected = !HAS_AMOUNT.test(fromLabel(block));
        continue;
      }
    }
    if (isSalaryBlock(text) || isPayTitle(text) || (heading !== null && PAY_HEADING.test(text))) {
      const narrowed = heading === null && block.length > 1 ? narrowSalaryBlock(block) : null;
      if (heading) skippingSection = heading[1]!.length;
      // Laço, não `push(...)`: um bloco de 130 mil linhas estoura a pilha.
      else if (narrowed) {
        for (const line of narrowed.kept) out.push(line);
        valueExpected = narrowed.valueExpected;
      }
      // Um ano no rótulo ("Pretensão salarial (2026):") não é o valor.
      else valueExpected = !HAS_AMOUNT.test(fromLabel(block));
      continue;
    }
    for (const line of block) out.push(line);
  }

  let text = out.join("\n");
  for (const email of knownEmails(known)) {
    text = text.replace(new RegExp(escapeRegExp(email), "giu"), REDACTED);
  }
  text = redactEmails(text);
  text = redactInternationalPhones(text);
  return text.replace(LOCAL_PHONE, REDACTED);
}

/**
 * O CV publicável JÁ com forma de Markdown (#325): filtro, forma, filtro.
 *
 * O primeiro passe é o de sempre, sobre o texto gravado — a normalização junta
 * e separa blocos, e nenhuma garantia que valia antes pode depender dela. O
 * segundo vê os títulos inferidos: um "COMPENSATION" em caixa alta vira seção,
 * e a seção inteira sai, inclusive o valor escrito blocos depois. Filtrar só
 * remove, então o segundo passe nunca devolve o que o primeiro tirou.
 */
export function publicCvMarkdown(content: string, known: KnownContact = {}): string {
  return publicCvText(cvTextToMarkdown(publicCvText(content, known)), known);
}
