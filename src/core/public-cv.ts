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
 * - piso: a linha que contém um rótulo de pretensão salarial (`piso:`,
 *   `pretensão:`, `pretensão salarial`, `faixa salarial`, `valor hora`,
 *   `salário:`, `salary expectation`, `rate:`…) sai inteira, com o resto do
 *   BLOCO: as linhas seguintes até a próxima linha em branco — o parágrafo, o
 *   item ou a tabela em que o valor mora, antes ou depois do rótulo. Num título Markdown,
 *   sai a seção inteira até o próximo título de mesmo nível ou acima. Um valor
 *   sem rótulo não é reconhecido, e o bloco inteiro some mesmo quando só uma
 *   parte dele era o piso: diante da dúvida, esconde-se.
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
 * deixaria "Piso: USD/ano" à vista — por isso sai a linha inteira.
 */
const SALARY_LABEL = new RegExp(
  [
    // `piso` sozinho é chão de fábrica; só conta com o que o faz salarial.
    "\\bpiso\\s*(?::|salarial|m[íi]nimo|de\\s+(?:remunera|sal[áa]rio))",
    // "sem pretensões comerciais" é currículo; o rótulo tem dois-pontos ou
    // o adjetivo salarial.
    "pretens(?:[ãa]o|[õo]es)\\s*(?::|salaria|de\\s+(?:remunera|sal[áa]rio))",
    "expectativa\\s+(?:salarial|de\\s+remunera)",
    "faixa\\s+salarial",
    "valor\\s+(?:da\\s+)?hora",
    "remunera[çc][ãa]o\\s*(?::|desejada|pretendida|m[íi]nima|esperada)",
    "sal[áa]rio\\s*(?::|desejado|pretendido|m[íi]nimo|esperado)",
    "salary\\s*(?::|floor|expectations?|requirements?|minimum|range\\s*:)",
    "(?:minimum|desired|expected|target)\\s+(?:salary|compensation|rate|pay)",
    "compensation\\s*(?::|floor|expectations?|requirements?)",
    // `rate:` só como rótulo no começo da linha (recuada ou não), de item,
    // de lista numerada ou de célula:
    // "Success rate: 99%" no meio de uma frase é currículo, não pretensão.
    "(?:^|[|·•*-]|\\d+[.)])\\s*(?:(?:hourly|daily|day)\\s+)?rate\\s*(?::|floor)",
  ].join("|"),
  "iu",
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HEADING = /^(#{1,6})\s/;

export function publicCvText(content: string, known: { email?: string | null } = {}): string {
  const out: string[] = [];
  // Enquanto não nulo, as linhas pertencem ao bloco do rótulo e saem.
  // `paragraph` termina na linha em branco; um número termina na seção cujo
  // título tinha aquele nível.
  let skipping: "paragraph" | number | null = null;
  // NFC: um "ã" digitado como "a" + til combinante não casaria com o rótulo.
  for (const line of content.normalize("NFC").split("\n")) {
    const heading = HEADING.exec(line);
    if (skipping === "paragraph" && line.trim() === "") skipping = null;
    if (typeof skipping === "number" && heading && heading[1]!.length <= skipping) skipping = null;
    if (skipping !== null) continue;

    const label = SALARY_LABEL.exec(line);
    if (!label) {
      out.push(line);
      continue;
    }
    if (heading) {
      skipping = heading[1]!.length;
      continue;
    }
    // A linha do rótulo sai inteira: o valor pode vir ANTES dele
    // (`| R$ 30.000 | Pretensão salarial |`), e guardar o começo da linha
    // publicaria justamente o número.
    skipping = "paragraph";
  }

  let text = out.join("\n");
  const email = known.email?.trim();
  if (email) text = text.replace(new RegExp(escapeRegExp(email), "giu"), REDACTED);
  text = text.replace(EMAIL, REDACTED);
  text = redactInternationalPhones(text);
  return text.replace(LOCAL_PHONE, REDACTED);
}
