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
 * - telefone: número com código de país (`+55 11 91234-5678`) ou com DDD entre
 *   parênteses (`(11) 91234-5678`) — um número solto sem essas marcas não é
 *   distinguível de um intervalo de anos ou de um valor, e fica;
 * - piso: a FRASE inteira em que aparece um rótulo de pretensão salarial
 *   (`piso`, `pretensão salarial`, `salary expectation`, `minimum rate`…),
 *   delimitada por fim de linha ou por `.`, `!`, `?`, `;`, `·` e `|` seguidos
 *   de espaço. Um valor sem rótulo não é reconhecido.
 *
 * Não é sanitização perfeita, e não se apresenta como tal: quem escreve o
 * piso sem rótulo no meio de um parágrafo o publica. O que ela garante é que
 * as formas usuais não vazem pelo consentimento dado para outra coisa.
 */

export const REDACTED = "[…]";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

/** Só formas com marca inequívoca de telefone. Ver o limite no topo. */
const PHONE = [
  /\+\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,4})?/g,
  /\(\d{2,3}\)\s?\d{4,5}[\s.-]?\d{4}/g,
];

/**
 * Rótulos de pretensão salarial em português e inglês. A frase que os contém
 * sai inteira: o valor pode estar antes ou depois do rótulo, em qualquer
 * moeda e período, e cortar só o número deixaria "Piso: USD/ano" à vista.
 */
const SALARY_LABEL = new RegExp(
  [
    "\\bpiso\\b",
    "pretens[ãa]o\\s+salarial",
    "expectativa\\s+salarial",
    "remunera[çc][ãa]o\\s+(?:desejada|pretendida|m[íi]nima|esperada)",
    "sal[áa]rio\\s+(?:desejado|pretendido|m[íi]nimo|esperado)",
    "salary\\s+(?:floor|expectations?|requirements?|range|minimum)",
    "(?:minimum|desired|expected|target)\\s+(?:salary|compensation|rate|pay)",
    "compensation\\s+(?:floor|expectations?|requirements?)",
    "rate\\s+floor",
  ].join("|"),
  "iu",
);

/** Fim de frase: pontuação seguida de espaço. `30.000` não quebra. */
const SENTENCE_END = /(?<=[.!?;·|])\s+/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function publicCvText(content: string, known: { email?: string | null } = {}): string {
  let text = content
    .split("\n")
    .flatMap((line) => {
      if (!SALARY_LABEL.test(line)) return [line];
      const kept = line
        .split(SENTENCE_END)
        .filter((sentence) => !SALARY_LABEL.test(sentence))
        .join(" ")
        .trimEnd();
      // A linha que era SÓ o piso some, em vez de virar uma linha em branco.
      return kept === "" ? [] : [kept];
    })
    .join("\n");

  const email = known.email?.trim();
  if (email) text = text.replace(new RegExp(escapeRegExp(email), "giu"), REDACTED);
  text = text.replace(EMAIL, REDACTED);
  for (const pattern of PHONE) text = text.replace(pattern, REDACTED);
  return text;
}
