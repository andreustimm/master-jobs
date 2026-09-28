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
 *   lista, texto longo demais, contato, pretensão salarial, número em área
 *   ou idiomas (`shortFieldProblem()`).
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
  | "areaNumber"
  | "languagesTooLong"
  | "languagesContact"
  | "languagesPay"
  | "languagesNumber";

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
 * máximo três caracteres: custo linear. `\p{Nd}`, não `\d`: dígito de outra
 * escrita ("٣") também é dígito.
 */
const LOOSE_PHONE = /\p{Nd}(?: ?[.()\-–]? ?\p{Nd}){7,}/gu;
const YEAR_PAIR = /^(?:19|20)\p{Nd}{2} ?[-–]? ?(?:19|20)\p{Nd}{2}$/u;

function containsLoosePhone(text: string): boolean {
  return [...text.matchAll(LOOSE_PHONE)].some(([match]) => !YEAR_PAIR.test(match));
}

/**
 * O texto de um campo curto antes de qualquer expressão: NFKC, para que a
 * forma de compatibilidade vire a comum ("３０ｋ" → "30k", "³⁰" → "30", "①" →
 * "1", "＠" → "@"); espaço colapsado, para que cada expressão fique linear; e
 * sem espaço em volta de `@`, para que "pia @ local.test" seja e-mail.
 */
function normalizeShortField(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").replace(/ ?@ ?/g, "@");
}

/** Contato num campo curto: o de todo o perfil, mais o telefone sem marca. */
export function containsShortFieldContact(text: string, known: KnownContact): boolean {
  const normalized = normalizeShortField(text);
  return containsContact(normalized, known) || containsLoosePhone(normalized);
}

const CURRENCY_CODE = "(?:usd|eur|brl|gbp)";
const CURRENCY_WORD = "(?:reais|d[óo]lar(?:es)?|dollars?|euros?)";
const TIME_UNIT = "(?:h|hrs?|hora|hour|dia|day|m[êe]s|mo|month|yr|ano|year|semana|week)";

/**
 * Número de norma técnica ("ISO 27001", "ISO 27001:2022", "ISO/IEC 42001",
 * "IEC 61131", "RFC 9110", "NBR 5410"): a única exceção à regra de número dos
 * campos curtos. Estreita de propósito, porque o que ela retira a regra não
 * vê — sigla em MAIÚSCULA ("iso 9001" continua número), até cinco dígitos
 * (RFC, até quatro), uma parte opcional (":2022", "-3"), e nunca quando vem
 * seguida de unidade de tempo, moeda, `k` ou `mil` ("NBR 20000/mês").
 */
const STANDARD_NUMBER =
  /\b(?:(?:ISO|IEC|IEEE|NBR)(?: ?\/ ?(?:ISO|IEC|IEEE))* ?[:-]? ?\p{Nd}{1,5}|RFC ?[:-]? ?\p{Nd}{1,4})(?:[-:.]\p{Nd}{1,4})?(?!\p{Nd})/gu;
const AMOUNT_AFTER = new RegExp(
  `^ ?(?:/ ?${TIME_UNIT}\\b|${CURRENCY_CODE}\\b|${CURRENCY_WORD}\\b|[$€£¥]|R\\$|k\\b|(?:mil|thousand|million|milh[õo]es)\\b)`,
  "iu",
);

/**
 * Palavra INTEIRA de remuneração em qualquer lugar do campo. Não recusa nada
 * sozinha — "Payments", "target: B2B", "Cadeia de valor" são área —; só
 * impede a exceção de norma: com ela no campo, "Piso ISO 15000" não vira
 * "Piso". Palavra inteira, para que "Payments e ISO 27001" continue passando.
 */
const PAY_HINT =
  /\b(?:piso|pretens(?:[ãa]o|[õo]es)|expectativas?|sal[áa]rios?|salarial|salariais|salary|salaries|remunera[çc](?:[ãa]o|[õo]es)|compensa[çc](?:[ãa]o|[õo]es)|compensation|target|pay|rate|hourly|daily|di[áa]rias?|mensal|mensais|per diem|fees?|ganhos?)\b/iu;

function withoutStandardNumbers(text: string): string {
  if (PAY_HINT.test(text)) return text;
  return text.replace(STANDARD_NUMBER, (match: string, offset: number) =>
    AMOUNT_AFTER.test(text.slice(offset + match.length, offset + match.length + 16)) ? match : " ",
  );
}

/**
 * Letras que, coladas antes de dígitos, fazem deles valor e não identificador:
 * código de moeda e regime de contratação ("USD30k", "R30k", "PJ30k",
 * "CLT15k"). A sequência de letras inteira é comparada, sem distinguir
 * caixa.
 */
const MONEY_PREFIX = /^(?:usd|eur|brl|gbp|chf|cad|aud|jpy|us|r|pj|clt)$/iu;
/** Depois dos dígitos, o que os faz valor mesmo colados a letra: `k`, barra, decimal, `mil`. */
const VALUE_SUFFIX = /^(?:k\b|\/|[.,]\p{Nd}| ?mil\b)/iu;
const DIGIT_RUN = /\p{Nd}+/gu;
const LETTER = /\p{L}/u;

/**
 * A regra estrutural dos campos curtos (passadas L2 da #362, decisão do
 * coordenador: parar de caçar formatos de valor). Área e idiomas são
 * palavras; número não tem lugar neles, e todo formato de piso ("20k", "30
 * mil", "150/h", "USD15000", "600 a diária") tem número.
 *
 * Toda sequência de dígitos é número, exceto a de um ou dois dígitos colada a
 * letras antes dela — identificador: "Web3", "K8s", "S3", "EC2", "B2B",
 * "C1", "IPv6", "Java21", "JLPT N2" —, e mesmo essa é número quando as letras
 * são código de moeda ou regime (`MONEY_PREFIX`) ou quando os dígitos vêm
 * seguidos de `k`, barra, decimal ou `mil` (`VALUE_SUFFIX`).
 *
 * As letras antes de cada sequência são lidas andando para trás a partir
 * dela; cada letra pertence a no máximo uma sequência, então o custo total é
 * linear.
 */
function containsLooseNumber(text: string): boolean {
  for (const run of text.matchAll(DIGIT_RUN)) {
    const at = run.index;
    let from = at;
    while (from > 0 && LETTER.test(text[from - 1]!)) from--;
    const letters = text.slice(from, at);
    if (letters === "" || run[0].length > 2 || MONEY_PREFIX.test(letters)) return true;
    if (VALUE_SUFFIX.test(text.slice(at + run[0].length, at + run[0].length + 8))) return true;
  }
  return false;
}

/** O motivo de recusar um campo curto, na ordem em que a tela o explica. */
export type ShortFieldProblem = "contact" | "pay" | "number";

/**
 * Por que um campo curto (área, idiomas) não pode sair — ou `null`.
 *
 * 1. Contato primeiro: a mensagem de contato é a que diz o que tirar.
 * 2. Rótulo de pretensão (`containsPay()`, a régua do CV), mesmo sem número
 *    ("Pretensão a combinar").
 * 3. Número, depois de retirar o número de norma.
 *
 * Tudo sobre o texto de `normalizeShortField()`.
 */
export function shortFieldProblem(text: string, known: KnownContact): ShortFieldProblem | null {
  const normalized = normalizeShortField(text);
  if (containsShortFieldContact(normalized, known)) return "contact";
  if (containsPay(normalized)) return "pay";
  if (containsLooseNumber(withoutStandardNumbers(normalized))) return "number";
  return null;
}

const FREE_TEXT_MAX = { area: AREA_MAX, languages: LANGUAGES_MAX } as const;

type FreeTextResult = { ok: true; value: string | null } | { ok: false; code: PublicFactsError };

function freeText(field: "area" | "languages", raw: string, known: KnownContact): FreeTextResult {
  const value = optional(raw);
  if (value === null) return { ok: true, value: null };
  // O teto vem antes dos filtros: nenhuma expressão roda sobre texto longo.
  if (value.length > FREE_TEXT_MAX[field]) return { ok: false, code: `${field}TooLong` };
  const problem = shortFieldProblem(value, known);
  if (problem === "contact") return { ok: false, code: `${field}Contact` };
  if (problem === "pay") return { ok: false, code: `${field}Pay` };
  if (problem === "number") return { ok: false, code: `${field}Number` };
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
    return shortFieldProblem(text, known) === null ? text : null;
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
