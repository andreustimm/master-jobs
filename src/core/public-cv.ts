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
 *   sai esteja antes ou depois dele. Num título Markdown, sai a seção inteira
 *   até o próximo título de mesmo nível ou acima. Um valor sem rótulo nem
 *   palavra de remuneração não é reconhecido; um bloco com "reduzi o custo de
 *   salário em 30%" some sem ser piso — diante da dúvida, esconde-se.
 *
 * Não é sanitização perfeita, e não se apresenta como tal: quem escreve o
 * piso sem rótulo no meio de um parágrafo o publica. O que ela garante é que
 * as formas usuais não vazem pelo consentimento dado para outra coisa.
 */

export const REDACTED = "[…]";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

/**
 * Telefone internacional: `+`, código e grupos de dígitos com um separador
 * simples entre eles, nunca atravessando linha. A leitura para ao passar de
 * 15 dígitos (o teto do E.164), para que um `2015-2020` logo depois do número
 * não o torne longo demais para ser telefone — e só redige a partir de 8,
 * para que `+30%` ou `+2 anos` fiquem.
 */
const INTERNATIONAL_START = /\+(?=\d)/g;
// Separadores de telefone: espaço, ponto, hífen, traço (– —) e barra.
const PHONE_GROUP = /^[ \t.\-–—/]?\(?(\d{1,5})\)?/u;
const LOCAL_PHONE = /\(\d{2,3}\)[ \t]?(?:9[ \t.\-–—/]?)?\d{4}[ \t.\-–—/]?\d{4}/gu;

function redactInternationalPhones(text: string): string {
  let out = "";
  let from = 0;
  for (const start of text.matchAll(INTERNATIONAL_START)) {
    if (start.index < from) continue;
    let at = start.index + 1;
    let digits = 0;
    let end = at;
    for (;;) {
      const group = PHONE_GROUP.exec(text.slice(at));
      if (!group || digits + group[1]!.length > 15) break;
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
    "valor\\s+(?:da\\s+)?hora",
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
const AMOUNT = "(?:[$€£¥]|R\\$|\\b(?!(?:19|20)\\d{2}\\b)\\d)";
const PAY_NEAR_AMOUNT = new RegExp(`${PAY_WORD}.{0,60}?${AMOUNT}|${AMOUNT}.{0,60}?${PAY_WORD}`, "iu");

function isSalaryBlock(block: string): boolean {
  // Ênfase Markdown não separa rótulo de valor: `**Piso**: 180000`.
  const plain = block.replace(/[*_`~]/g, "");
  const prose = plain.replace(/\s+/g, " ");
  return SALARY_LABEL.test(plain) || SALARY_LABEL.test(prose) || PAY_NEAR_AMOUNT.test(prose);
}

/** Título que anuncia remuneração: a seção inteira é o valor. */
const PAY_HEADING = new RegExp(PAY_WORD, "iu");

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

export function publicCvText(content: string, known: { email?: string | null } = {}): string {
  const out: string[] = [];
  // Nível do título cuja seção inteira está saindo, ou nulo.
  let skippingSection: number | null = null;
  // NFC: um "ã" digitado como "a" + til combinante não casaria com o rótulo.
  for (const block of blocks(content.normalize("NFC").split("\n"))) {
    const heading = HEADING.exec(block[0]!);
    if (skippingSection !== null) {
      if (heading && heading[1]!.length <= skippingSection) skippingSection = null;
      else continue;
    }
    const text = block.join("\n");
    if (text.trim() !== "" && (isSalaryBlock(text) || (heading !== null && PAY_HEADING.test(text)))) {
      if (heading) skippingSection = heading[1]!.length;
      continue;
    }
    out.push(...block);
  }

  let text = out.join("\n");
  const email = known.email?.trim();
  if (email) text = text.replace(new RegExp(escapeRegExp(email), "giu"), REDACTED);
  text = text.replace(EMAIL, REDACTED);
  text = redactInternationalPhones(text);
  return text.replace(LOCAL_PHONE, REDACTED);
}
