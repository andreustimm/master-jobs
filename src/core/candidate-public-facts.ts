/**
 * Fatos do perfil público (#327, parte A) — regras puras.
 *
 * Sete fatos que um recrutador pergunta antes de chamar: modelo de trabalho,
 * nível, disponibilidade, prazo para começar, aceita mudar, área e idiomas.
 * Cada um tem o PRÓPRIO opt-in, desligado por padrão: guardar o dado aqui não
 * o publica; publicar é marcar "mostrar", campo a campo.
 *
 * Duas camadas, de propósito:
 * - `parsePublicFactsForm()` é a ENTRADA. Recusa e explica — valor fora da
 *   lista, texto longo demais, contato, pretensão salarial.
 * - `publicFactsFrom()` é a SAÍDA, a que vale para `/p/`. Não confia na
 *   entrada: uma coluna pode ser escrita por migration, CLI ou `UPDATE` à mão,
 *   e o que ela não reconhece ou o que traz contato/pretensão não sai.
 *
 * **Pretensão salarial nunca é um fato** (G21). O piso é a posição de
 * negociação; não há campo, opt-in nem rótulo para ela, e o texto livre que
 * a carrega é recusado na entrada e esvaziado na saída.
 *
 * Sem banco, sem rede, sem relógio.
 */
import { containsContact, containsPay, type KnownContact } from "./public-cv.ts";

export const WORK_MODELS = Object.freeze(["remote", "hybrid", "onsite", "b2b", "contractor", "employee"] as const);
export const EXPERIENCE_LEVELS = Object.freeze(
  ["junior", "mid", "senior", "lead", "staff", "principal", "executive"] as const,
);
export const AVAILABILITY_STATUSES = Object.freeze(["actively-looking", "open", "not-looking"] as const);
export const START_TIMEFRAMES = Object.freeze(
  ["immediate", "two-weeks", "one-month", "two-months", "three-months-plus"] as const,
);

export type WorkModel = (typeof WORK_MODELS)[number];
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export type Availability = (typeof AVAILABILITY_STATUSES)[number];
export type StartTimeframe = (typeof START_TIMEFRAMES)[number];

/** Teto do texto livre: recusa em vez de truncar, como o nome e a headline. */
export const AREA_MAX = 80;
export const LANGUAGES_MAX = 160;

/** Os sete fatos, na ordem em que a tela de edição os mostra. */
export const PUBLIC_FACT_KEYS = Object.freeze(
  ["workModel", "experienceLevel", "availability", "startTimeframe", "openToRelocation", "area", "languages"] as const,
);
export type PublicFactKey = (typeof PUBLIC_FACT_KEYS)[number];

/** A coluna do opt-in de cada fato. */
export const OPT_IN_COLUMN = Object.freeze({
  workModel: "publicWorkModel",
  experienceLevel: "publicExperienceLevel",
  availability: "publicAvailability",
  startTimeframe: "publicStartTimeframe",
  openToRelocation: "publicRelocation",
  area: "publicArea",
  languages: "publicLanguages",
} as const satisfies Record<PublicFactKey, string>);

type OptInColumn = (typeof OPT_IN_COLUMN)[PublicFactKey];

/**
 * As catorze colunas como `candidate` as guarda — mesmos nomes de propriedade
 * do schema, para que o `UPDATE` receba o objeto sem remapear. O opt-in aceita
 * nulo no banco (contrato da importação do snapshot); nulo é desligado.
 */
export type StoredFacts = {
  workModel: string[] | null;
  experienceLevel: string | null;
  availability: string | null;
  startTimeframe: string | null;
  openToRelocation: boolean | null;
  area: string | null;
  languages: string | null;
} & Record<OptInColumn, boolean | null>;

/** O que sai em `/p/`: só o que tem opt-in, valor e passa pelos filtros. */
export type PublicFacts = {
  /** Vazio quando não sai. */
  workModel: WorkModel[];
  experienceLevel: ExperienceLevel | null;
  availability: Availability | null;
  startTimeframe: StartTimeframe | null;
  /** `null` é "não sai" (desligado ou não informado); `false` é "não aceita". */
  openToRelocation: boolean | null;
  area: string | null;
  languages: string | null;
};

/** O formulário de `/candidate`, já lido do `FormData` pela action. */
export type PublicFactsFormInput = {
  workModel: readonly string[];
  experienceLevel: string;
  availability: string;
  startTimeframe: string;
  /** `yes` | `no` | vazio (não informado). */
  openToRelocation: string;
  area: string;
  languages: string;
  /** "Mostrar no perfil público", por fato. Ausente é desligado. */
  show: Partial<Record<PublicFactKey, boolean>>;
};

export type PublicFactsError =
  | "invalidChoice"
  | "areaTooLong"
  | "areaContact"
  | "areaPay"
  | "languagesTooLong"
  | "languagesContact"
  | "languagesPay";

function member<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

/** Espaço em volta some; vazio vira `null`. */
function optional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Deduplicado e na ordem da lista — a ordem do clique não é informação. */
function canonicalWorkModels(values: readonly string[]): WorkModel[] {
  const chosen = new Set(values);
  return WORK_MODELS.filter((model) => chosen.has(model));
}

type ChoiceResult<T> = { ok: true; value: T | null } | { ok: false };

function choice<T extends string>(list: readonly T[], raw: string): ChoiceResult<T> {
  const value = optional(raw);
  if (value === null) return { ok: true, value: null };
  return member(list, value) ? { ok: true, value } : { ok: false };
}

/**
 * Telefone sem marca num campo curto: oito dígitos ou mais com separador curto
 * entre eles — espaço, ponto, hífen, travessão ou parêntese, com até um espaço
 * de cada lado ("WhatsApp 11 91234-5678", "tel 11 9 1234 5678", "11 91234 -
 * 5678"). `containsContact()` deixa passar — no currículo um número assim não
 * se distingue de outro qualquer —, mas em área ou idiomas ninguém escreve oito
 * dígitos seguidos que não sejam um telefone. Par de anos ("2015-2020", "2015 -
 * 2020") fica de fora. Cada repetição começa num dígito e o separador tem no
 * máximo três caracteres: custo linear.
 */
const LOOSE_PHONE = /\d(?: ?[.()\-–]? ?\d){7,}/g;
const YEAR_PAIR = /^(?:19|20)\d{2} ?[-–]? ?(?:19|20)\d{2}$/;

function containsLoosePhone(text: string): boolean {
  return [...text.matchAll(LOOSE_PHONE)].some(([match]) => !YEAR_PAIR.test(match));
}

/** Contato num campo curto: o de todo o perfil, mais o telefone sem marca. */
export function containsShortFieldContact(text: string, known: KnownContact): boolean {
  return containsContact(text, known) || containsLoosePhone(text.replace(/\s+/g, " "));
}

const CURRENCY_CODE = "(?:usd|eur|brl|gbp)";
const CURRENCY_WORD = "(?:reais|d[óo]lar(?:es)?|dollars?|euros?)";
const TIME_UNIT = "(?:h|hrs?|hora|hour|dia|day|m[êe]s|mo|month|yr|ano|year|semana|week)";
const MAGNITUDE = "(?:mil|thousand|million|milh[õo]es)";

/**
 * Número de norma técnica ("ISO 27001", "ISO/IEC 42001", "IEC 61131", "RFC
 * 9110", "NBR 5410") sai antes da régua de valor: quatro dígitos que não são
 * ano seriam lidos como dinheiro, e a área "Segurança da informação (ISO
 * 27001)" seria recusada com a mensagem de pretensão.
 *
 * Estreito de propósito, porque o que ele retira a régua não vê: sigla em
 * MAIÚSCULA (como a norma é escrita — "iso 30000" continua valor), até cinco
 * dígitos (RFC, até quatro), com uma parte opcional (":2022", "-3"), e nunca
 * quando o número vem seguido de unidade de tempo, moeda, `k` ou `mil`
 * ("NBR 20000/mês" é valor).
 */
const STANDARD_NUMBER =
  /\b(?:(?:ISO|IEC|IEEE|NBR)(?: ?\/ ?(?:ISO|IEC|IEEE))* ?[:-]? ?\d{1,5}|RFC ?[:-]? ?\d{1,4})(?:[-:.]\d{1,4})?(?!\d)/gu;
const AMOUNT_AFTER = new RegExp(
  `^ ?(?:/ ?${TIME_UNIT}\\b|${CURRENCY_CODE}\\b|${CURRENCY_WORD}\\b|[$€£¥]|R\\$|k\\b|${MAGNITUDE}\\b)`,
  "iu",
);

function withoutStandardNumbers(text: string): string {
  return text.replace(STANDARD_NUMBER, (match: string, offset: number) =>
    AMOUNT_AFTER.test(text.slice(offset + match.length, offset + match.length + 16)) ? match : " ",
  );
}

/**
 * Valor com cara de dinheiro num campo CURTO (área, idiomas). Régua própria,
 * separada do `MONEY_LIKE` do currículo: lá "1.200 clientes" é métrica e fica;
 * aqui não há motivo para dinheiro, e na dúvida o campo fecha.
 *
 * Conta como valor:
 * - símbolo de moeda (`$`, `€`, `£`, `¥`, `R$`);
 * - código de moeda colado ou vizinho de número ("USD15000", "20k USD");
 * - moeda por extenso só vizinha de número ("90 dollars", "15000 euros") — a
 *   palavra solta ("euros e câmbio", "reais problemas") não;
 * - número com `mil`, `thousand`, `million`, `milhões`, SEMPRE ("30 mil",
 *   "1 million", "12,5 mil");
 * - número com `k`, SEMPRE ("20k", "12,5k", "1.5k/h", "4k"), menos
 *   exatamente `4K` ou `8K` maiúsculos sem decimal — resolução de vídeo
 *   (`amountWithK`);
 * - número por unidade de tempo ("90/hr", "150/mo", "150 por hora", "90 an
 *   hour");
 * - milhar com separador, inclusive espaço e apóstrofo ("30 000", "30'000");
 * - quatro dígitos ou mais que não sejam ano, fora número de norma;
 * - rótulo forte de remuneração seguido de dois-pontos ou número ("Piso 20k",
 *   "Expectativa: 20k", "Salário:");
 * - `target`, `pay` ou `rate` (com `hourly`/`daily`/`day` opcional) só quando
 *   vem número ou moeda depois, com dois-pontos ou não ("Rate 90", "IA, rate:
 *   150", "Target: USD 180k") — "target: B2B" não; e `rate` depois de
 *   `frame`, `conversion`, `error`, `success`, `churn` ou `retention` nunca.
 *
 * **Falso positivo aceito** (fechar por segurança): "10 mil TPS", "Equipes de
 * 1 200 pessoas", norma em minúscula ("iso 27001") e `rate`/`pay`/`target`
 * seguidos de número fora das exceções acima são recusados com a mensagem de
 * pretensão.
 *
 * **Limite declarado:** ano sem moeda nem rótulo ("Dados 2000"), número de três
 * dígitos ou menos sem nada em volta ("150") e número por extenso ("vinte
 * mil") passam.
 */
const SHORT_FIELD_AMOUNT = new RegExp(
  [
    "[$€£¥]|R\\$",
    `\\b${CURRENCY_CODE} ?\\d`,
    `\\d ?${CURRENCY_CODE}\\b`,
    `\\d ?${CURRENCY_WORD}\\b`,
    `\\d(?:[.,]\\d+)? ?${MAGNITUDE}\\b`,
    `\\d ?/ ?${TIME_UNIT}\\b`,
    `\\d (?:por|per|an?) ${TIME_UNIT}\\b`,
    "(?<![\\d.,])\\d{1,3}(?:[., '’]\\d{3})+(?!\\d)",
    "(?<![\\d.,])(?!(?:19|20)\\d{2}(?!\\d))\\d{4,}",
    "\\b(?:piso|pretens(?:[ãa]o|[õo]es)|expectativa|sal[áa]rio|salary|remunera[çc][ãa]o|compensation)\\b ?(?::|floor|\\d)",
    `(?<!\\b(?:frame|conversion|error|success|churn|retention)[ -]?)\\b(?:target|pay|(?:(?:hourly|daily|day) )?rate)\\b ?(?:(?::|floor) ?)?(?:\\d|[$€£¥]|R\\$|${CURRENCY_CODE}\\b)`,
  ].join("|"),
  "iu",
);

/** Número com `k`: sempre valor, menos a resolução `4K`/`8K` escrita exatamente assim. */
const AMOUNT_WITH_K = /(?<![\d.,])\d+(?:[.,]\d+)? ?k\b/giu;

function amountWithK(text: string): boolean {
  return [...text.matchAll(AMOUNT_WITH_K)].some(([match]) => match !== "4K" && match !== "8K");
}

/**
 * Pretensão num campo curto: o rótulo do currículo (`containsPay()`), número
 * com `k` ou o valor de `SHORT_FIELD_AMOUNT`, sobre espaço colapsado — cada
 * ` ?` consome no máximo um caractere, e as expressões ficam lineares.
 */
export function containsShortFieldPay(text: string): boolean {
  const collapsed = text.normalize("NFC").replace(/\s+/g, " ");
  if (containsPay(collapsed) || amountWithK(collapsed)) return true;
  return SHORT_FIELD_AMOUNT.test(withoutStandardNumbers(collapsed));
}

const FREE_TEXT_MAX = { area: AREA_MAX, languages: LANGUAGES_MAX } as const;

type FreeTextResult = { ok: true; value: string | null } | { ok: false; code: PublicFactsError };

function freeText(field: "area" | "languages", raw: string, known: KnownContact): FreeTextResult {
  const value = optional(raw);
  if (value === null) return { ok: true, value: null };
  // O teto vem antes dos filtros: nenhuma expressão roda sobre texto longo.
  if (value.length > FREE_TEXT_MAX[field]) return { ok: false, code: `${field}TooLong` };
  if (containsShortFieldContact(value, known)) return { ok: false, code: `${field}Contact` };
  if (containsShortFieldPay(value)) return { ok: false, code: `${field}Pay` };
  return { ok: true, value };
}

/**
 * Valida o formulário de "Dados do perfil público".
 *
 * Valor controlado fora da lista é `invalidChoice`: o formulário só oferece a
 * lista, e outro valor é requisição forjada, não digitação — gravá-lo
 * deixaria a coluna num estado que nenhum ramo da leitura reconhece.
 *
 * `known` leva os e-mails cadastrados (do candidato e da conta), que o padrão
 * genérico pode não reconhecer — a mesma régua da saída.
 */
export function parsePublicFactsForm(
  raw: PublicFactsFormInput,
  known: KnownContact = {},
): { ok: true; value: StoredFacts } | { ok: false; code: PublicFactsError } {
  const models = raw.workModel.map((value) => value.trim()).filter((value) => value !== "");
  if (!models.every((value) => member(WORK_MODELS, value))) return { ok: false, code: "invalidChoice" };

  const level = choice(EXPERIENCE_LEVELS, raw.experienceLevel);
  const availability = choice(AVAILABILITY_STATUSES, raw.availability);
  const start = choice(START_TIMEFRAMES, raw.startTimeframe);
  if (!level.ok || !availability.ok || !start.ok) return { ok: false, code: "invalidChoice" };

  const relocationRaw = raw.openToRelocation.trim();
  if (!["", "yes", "no"].includes(relocationRaw)) return { ok: false, code: "invalidChoice" };

  const area = freeText("area", raw.area, known);
  if (!area.ok) return area;
  const languages = freeText("languages", raw.languages, known);
  if (!languages.ok) return languages;

  const canonical = canonicalWorkModels(models);
  const show = (key: PublicFactKey) => raw.show[key] === true;
  return {
    ok: true,
    value: {
      workModel: canonical.length > 0 ? canonical : null,
      experienceLevel: level.value,
      availability: availability.value,
      startTimeframe: start.value,
      openToRelocation: relocationRaw === "" ? null : relocationRaw === "yes",
      area: area.value,
      languages: languages.value,
      publicWorkModel: show("workModel"),
      publicExperienceLevel: show("experienceLevel"),
      publicAvailability: show("availability"),
      publicStartTimeframe: show("startTimeframe"),
      publicRelocation: show("openToRelocation"),
      publicArea: show("area"),
      publicLanguages: show("languages"),
    },
  };
}

/**
 * O que sai em `/p/`. Um fato só sai com o opt-in ligado, valor presente e,
 * conforme o tipo, reconhecido (controlado) ou limpo de contato e pretensão
 * (livre). `known` leva os e-mails cadastrados, que o padrão genérico pode não
 * reconhecer — o mesmo contrato de `containsContact()` no resto do perfil.
 */
export function publicFactsFrom(row: StoredFacts, known: KnownContact = {}): PublicFacts {
  // `=== true`, e não verdade solta: nulo (linha importada) é desligado.
  const on = (field: PublicFactKey) => row[OPT_IN_COLUMN[field]] === true;
  const controlled = <T extends string>(list: readonly T[], field: PublicFactKey, value: string | null): T | null =>
    on(field) && value !== null && member(list, value) ? value : null;
  const free = (field: "area" | "languages", value: string | null): string | null => {
    const text = on(field) ? optional(value) : null;
    // Acima do teto não sai, e nenhuma expressão roda sobre ele: o valor só
    // chega longo por fora da gravação, e texto longo é onde o custo mora.
    if (text === null || text.length > FREE_TEXT_MAX[field]) return null;
    return containsShortFieldContact(text, known) || containsShortFieldPay(text) ? null : text;
  };

  return {
    workModel: on("workModel") ? canonicalWorkModels(row.workModel ?? []) : [],
    experienceLevel: controlled(EXPERIENCE_LEVELS, "experienceLevel", row.experienceLevel),
    availability: controlled(AVAILABILITY_STATUSES, "availability", row.availability),
    startTimeframe: controlled(START_TIMEFRAMES, "startTimeframe", row.startTimeframe),
    openToRelocation: on("openToRelocation") ? row.openToRelocation : null,
    area: free("area", row.area),
    languages: free("languages", row.languages),
  };
}
