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
 * - piso: da frase que contém um rótulo de pretensão salarial (`piso:`,
 *   `pretensão`, `faixa salarial`, `valor hora`, `salário:`, `salary
 *   expectation`, `rate:`…) até o fim da
 *   linha; se o rótulo não traz número na própria linha, como num título, a
 *   linha seguinte com número também sai. Um valor sem rótulo não é
 *   reconhecido.
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
const PHONE_GROUP = /^[ \t.-]?\(?(\d{1,5})\)?/;
const LOCAL_PHONE = /\(\d{2,3}\)[ \t]?(?:9[ \t.-]?)?\d{4}[ \t.-]?\d{4}/g;

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
 * Rótulos de pretensão salarial em português e inglês. O valor pode estar
 * antes ou depois do rótulo, em qualquer moeda e período, e cortar só o número
 * deixaria "Piso: USD/ano" à vista — por isso sai a frase inteira até o fim
 * da linha.
 */
const SALARY_LABEL = new RegExp(
  [
    // `piso` sozinho é chão de fábrica; só conta com o que o faz salarial.
    "\\bpiso\\s*(?::|salarial|m[íi]nimo|de\\s+(?:remunera|sal[áa]rio))",
    "pretens(?:[ãa]o|[õo]es)\\b",
    "expectativa\\s+(?:salarial|de\\s+remunera)",
    "faixa\\s+salarial",
    "valor\\s+(?:da\\s+)?hora",
    "remunera[çc][ãa]o\\s*(?::|desejada|pretendida|m[íi]nima|esperada)",
    "sal[áa]rio\\s*(?::|desejado|pretendido|m[íi]nimo|esperado)",
    "salary\\s*(?::|floor|expectations?|requirements?|range|minimum)",
    "(?:minimum|desired|expected|target)\\s+(?:salary|compensation|rate|pay)",
    "compensation\\s*(?::|floor|expectations?|requirements?)",
    // `rate:` só como rótulo no começo da linha, de item ou de célula:
    // "Success rate: 99%" no meio de uma frase é currículo, não pretensão.
    "(?:^|[|·•*-]\\s*)(?:hourly\\s+)?rate\\s*(?::|floor)",
  ].join("|"),
  "iu",
);

/** Fim de frase: pontuação seguida de espaço. `30.000` não quebra. */
const SENTENCE_END = /[.!?;·|]\s/gu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** O que sobra da linha antes da frase do rótulo, ou `null` se nada sobra. */
function beforeSalarySentence(line: string, labelAt: number): string | null {
  const prefix = line.slice(0, labelAt);
  let cut = -1;
  for (const boundary of prefix.matchAll(SENTENCE_END)) cut = boundary.index + 1;
  const kept = cut === -1 ? "" : prefix.slice(0, cut).trimEnd();
  // Sobrou só pontuação de tabela ou separador: não há frase para manter.
  return /[\p{L}\p{N}]/u.test(kept) ? kept : null;
}

export function publicCvText(content: string, known: { email?: string | null } = {}): string {
  const out: string[] = [];
  let valueExpected = false;
  // NFC: um "ã" digitado como "a" + til combinante não casaria com o rótulo.
  for (const line of content.normalize("NFC").split("\n")) {
    if (valueExpected && line.trim() !== "") {
      valueExpected = false;
      // O título "Pretensão salarial" com o valor na linha de baixo.
      if (/\d/.test(line)) continue;
    }
    const label = SALARY_LABEL.exec(line);
    if (!label) {
      out.push(line);
      continue;
    }
    valueExpected = !/\d/.test(line.slice(label.index));
    const kept = beforeSalarySentence(line, label.index);
    if (kept !== null) out.push(kept);
  }

  let text = out.join("\n");
  const email = known.email?.trim();
  if (email) text = text.replace(new RegExp(escapeRegExp(email), "giu"), REDACTED);
  text = text.replace(EMAIL, REDACTED);
  text = redactInternationalPhones(text);
  return text.replace(LOCAL_PHONE, REDACTED);
}
