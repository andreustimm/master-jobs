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

type FreeTextResult = { ok: true; value: string | null } | { ok: false; code: PublicFactsError };

function freeText(field: "area" | "languages", raw: string, max: number): FreeTextResult {
  const value = optional(raw);
  if (value === null) return { ok: true, value: null };
  if (value.length > max) return { ok: false, code: `${field}TooLong` };
  if (containsContact(value)) return { ok: false, code: `${field}Contact` };
  if (containsPay(value)) return { ok: false, code: `${field}Pay` };
  return { ok: true, value };
}

/**
 * Valida o formulário de "Dados do perfil público".
 *
 * Valor controlado fora da lista é `invalidChoice`: o formulário só oferece a
 * lista, e outro valor é requisição forjada, não digitação — gravá-lo
 * deixaria a coluna num estado que nenhum ramo da leitura reconhece.
 */
export function parsePublicFactsForm(
  raw: PublicFactsFormInput,
): { ok: true; value: StoredFacts } | { ok: false; code: PublicFactsError } {
  const models = raw.workModel.map((value) => value.trim()).filter((value) => value !== "");
  if (!models.every((value) => member(WORK_MODELS, value))) return { ok: false, code: "invalidChoice" };

  const level = choice(EXPERIENCE_LEVELS, raw.experienceLevel);
  const availability = choice(AVAILABILITY_STATUSES, raw.availability);
  const start = choice(START_TIMEFRAMES, raw.startTimeframe);
  if (!level.ok || !availability.ok || !start.ok) return { ok: false, code: "invalidChoice" };

  const relocationRaw = raw.openToRelocation.trim();
  if (!["", "yes", "no"].includes(relocationRaw)) return { ok: false, code: "invalidChoice" };

  const area = freeText("area", raw.area, AREA_MAX);
  if (!area.ok) return area;
  const languages = freeText("languages", raw.languages, LANGUAGES_MAX);
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
  const free = (field: PublicFactKey, value: string | null): string | null => {
    const text = on(field) ? optional(value) : null;
    return text === null || containsContact(text, known) || containsPay(text) ? null : text;
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
