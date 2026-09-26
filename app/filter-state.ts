import type { Route } from "next";
import { WORK_MODES, readWorkMode, type BoardFilters, type TrackTarget, type WorkMode } from "../src/contexts/matching/index.ts";
import { FUNNEL_STATUSES } from "../src/contexts/pursuit/domain/application.ts";
import { parseQuery } from "../src/core/search.ts";
import { validateTerm, type TermError, type ValidTerm } from "../src/core/term.ts";
import { FIT_MAX, PAY_FILTER_MAX } from "./filter-scales.ts";

/**
 * O estado dos filtros do quadro, lido da URL e escrito de volta nela.
 *
 * Estado de filtro vive na URL, não em React: a visão filtrada é
 * compartilhável, o voltar do navegador funciona e a página continua Server
 * Component. Parâmetro inválido não derruba a página — vira aviso e o filtro
 * é ignorado.
 *
 * Sem UI aqui, de propósito: é o que deixa a leitura da URL ser testada sem
 * montar componente.
 */

export type FilterNotice =
  | TermError
  | "pay_invalid"
  | "range_swapped"
  | "track_unknown"
  | "term_unknown"
  | "cluster_unknown"
  /**
   * O candidato ainda não tem nota na trilha principal — sem currículo, ou com
   * a fila ainda por rodar. O texto vale para os dois casos.
   */
  | "scores_pending";

export type PayState = {
  /** Floor of the range; absent means "no floor". */
  min?: number;
  /** Ceiling of the range; absent means "no ceiling". */
  max?: number;
  currency?: string;
  period?: "month" | "year";
  disclosedOnly: boolean;
};

export type FilterState = {
  /** Lowest fit shown. Zero is "every score". */
  fit: number;
  /** Highest fit shown; absent means no ceiling. */
  fitMax?: number;
  cluster?: string;
  /**
   * A consulta `q` analisada: termos de palavra inteira e frases entre aspas
   * sobre cargo, empresa, localização e descrição. `raw` é o que volta à URL.
   */
  query?: { raw: string; terms: ValidTerm[]; phrases: ValidTerm[] };
  /** O termo, quando a consulta é um termo só — o que se salva como termo. */
  term?: ValidTerm;
  /** Part of the employer's name. Free text: it is matched, never parsed. */
  company?: string;
  /** Which sources to show. Empty means every source. */
  sources: string[];
  workMode?: WorkMode;
  unblocked?: boolean;
  fresh?: boolean;
  paid?: boolean;
  named?: boolean;
  described?: boolean;
  /** Only jobs not sent yet — no application, or one with no sent date. */
  notApplied?: boolean;
  /**
   * Fold a job repeated across countries into one row. On by default.
   *
   * The URL carries the exception (`ungrouped=1`), not the rule: the common
   * link stays short, and a link without the parameter keeps meaning what it
   * means today.
   */
  grouped: boolean;
  sort?: string;
  status?: string;
  /** Track id, or every active track. Absent: the primary. */
  track?: "all" | number;
  /** The viewer's saved term whose jobs to show ("brought by"). */
  by?: number;
  pay?: PayState;
  /** Why a parameter was ignored. Never written back to the URL. */
  notices: FilterNotice[];
};

export type BoardRoute = "/" | "/jobs";

// The scales live in `filter-scales.ts`, which the client islands can import
// without pulling this module's server graph with them.
export { FIT_MAX, FIT_SLIDER_STEP, PAY_FILTER_MAX, PAY_SLIDER_CEILING, PAY_SLIDER_STEP } from "./filter-scales.ts";

const SORTS = ["fit", "recent", "comp", "relevance"] as const;

/**
 * A score read from the URL, held between zero and the scorer's ceiling.
 *
 * The field is typed now, not a row of preset chips, so it can carry anything:
 * `fit=abc` used to reach the query as NaN and Postgres refused the page. An
 * empty field is a deliberate "every score"; an absent one keeps the default.
 */
function boundedFit(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  if (raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, 0), FIT_MAX);
}

function positiveInt(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function readFilters(params: Record<string, string | string[] | undefined>): FilterState {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  // Every ticked source arrives as a repeated `source=`, which is what a list
  // of checkboxes submits. A lone `source=x` — the older shape, still in saved
  // links — still reads as one source.
  const many = (k: string) => {
    const v = params[k];
    const raw = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return [...new Set(raw.map((item) => item.trim()).filter((item) => item !== ""))];
  };
  const notices: FilterNotice[] = [];
  const state: FilterState = {
    fit: boundedFit(one("fit"), 45),
    cluster: one("cluster"),
    sources: many("source"),
    workMode: readWorkMode(one("workMode")),
    status: one("status"),
    sort: SORTS.find((sort) => sort === one("sort")),
    unblocked: one("unblocked") === "1",
    fresh: one("fresh") === "1",
    paid: one("paid") === "1",
    named: one("named") === "1",
    described: one("described") === "1",
    notApplied: one("notApplied") === "1",
    grouped: one("ungrouped") !== "1",
    notices,
  };

  // Cut to length rather than refused: an employer name has no grammar, and a
  // pasted field far too long is a slip of the hand, not an invalid request.
  const company = one("company")?.trim().slice(0, 80);
  if (company) state.company = company;

  const q = one("q");
  if (q !== undefined && q.trim() !== "") {
    // Cada termo e cada frase passa pela mesma validação do termo de sempre;
    // um pedaço inválido invalida a consulta inteira, como antes.
    const parsed = parseQuery(q);
    const terms: ValidTerm[] = [];
    const phrases: ValidTerm[] = [];
    let error: TermError | undefined;
    for (const [list, into] of [[parsed.terms, terms], [parsed.phrases, phrases]] as const) {
      for (const part of list) {
        const valid = validateTerm(part);
        if (valid.ok) into.push(valid.value);
        else error ??= valid.code;
      }
    }
    if (error) notices.push(error);
    else if (terms.length + phrases.length > 0) {
      state.query = { raw: q.trim().replace(/\s+/g, " "), terms, phrases };
      // Um termo só, sem frase: é o termo que se salva e se busca nas plataformas.
      if (terms.length === 1 && phrases.length === 0) state.term = terms[0];
    }
  }

  const track = one("track");
  if (track === "all") state.track = "all";
  else if (track !== undefined && track !== "") {
    const id = positiveInt(track);
    if (id === null) notices.push("track_unknown");
    else state.track = id;
  }

  const by = one("by");
  if (by !== undefined && by !== "") {
    const id = positiveInt(by);
    if (id === null) notices.push("term_unknown");
    else state.by = id;
  }

  const rawFitMax = one("fitMax");
  if (rawFitMax !== undefined && rawFitMax.trim() !== "") {
    state.fitMax = boundedFit(rawFitMax, FIT_MAX);
  }
  if (state.fitMax !== undefined && state.fit > state.fitMax) {
    [state.fit, state.fitMax] = [state.fitMax, state.fit];
    // Um aviso por leitura, como o `pay_invalid` doze linhas abaixo já fazia.
    // As duas faixas compartilham a chave, e `?fit=80&fitMax=20&pay=5000&payMax=1000`
    // empilhava a mesma frase duas vezes — dois irmãos com a mesma `key` do
    // React, e o `data-testid` resolvendo para dois elementos.
    if (!notices.includes("range_swapped")) notices.push("range_swapped");
  }

  const rawCurrency = one("cur")?.trim().toUpperCase();
  const rawPeriod = one("per");
  const disclosedOnly = one("disclosed") === "1";
  const bound = (raw: string | undefined): number | undefined => {
    // Apara antes de decidir se está vazio, como todo o resto do módulo faz
    // (`boundedFit`, o termo, `company`). `?pay=%20` — link copiado com espaço,
    // ou URL escrita à mão — chegava como `" "`, escapava do teste de vazio e
    // caía em `positiveInt`, que apara, acha string vazia e recusa: a tela dizia
    // "valor inválido" para um parâmetro em branco, quando o contrato é que
    // campo vazio é escolha e não erro.
    if (raw === undefined || raw.trim() === "") return undefined;
    const amount = positiveInt(raw);
    if (amount === null || amount > PAY_FILTER_MAX) {
      // One notice per read, even with both sides invalid: the cause is a
      // single one, and saying the same sentence twice adds nothing.
      if (!notices.includes("pay_invalid")) notices.push("pay_invalid");
      return undefined;
    }
    return amount;
  };
  let min = bound(one("pay"));
  let max = bound(one("payMax"));
  // An inverted range is legible intent: the slider cannot produce it, but a
  // hand-written URL and a typed field can. Swapping the sides delivers what
  // was meant; the notice says the swap happened, so the filter does not look
  // like it has a mind of its own.
  if (min !== undefined && max !== undefined && min > max) {
    [min, max] = [max, min];
    if (!notices.includes("range_swapped")) notices.push("range_swapped");
  }
  const currency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : undefined;
  const period = rawPeriod === "month" || rawPeriod === "year" ? rawPeriod : undefined;
  if (min !== undefined || max !== undefined || currency || period || disclosedOnly) {
    state.pay = { min, max, currency, period, disclosedOnly };
  }
  return state;
}

/**
 * The state as URL parameters, in a stable order. Notices never travel.
 *
 * A list of pairs, not an object: `source` repeats once per chosen source, and
 * an object keyed by name can only hold the last one.
 */
export function toParams(state: FilterState): Array<[string, string]> {
  const params: Array<[string, string]> = [["fit", String(state.fit)]];
  const put = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined || value === "" || value === false) return;
    params.push([key, value === true ? "1" : String(value)]);
  };
  put("cluster", state.cluster);
  put("q", state.query?.raw);
  put("company", state.company);
  for (const kind of state.sources) put("source", kind);
  put("workMode", state.workMode);
  put("status", state.status);
  put("sort", state.sort);
  put("unblocked", state.unblocked);
  put("fresh", state.fresh);
  put("paid", state.paid);
  put("named", state.named);
  put("described", state.described);
  put("fitMax", state.fitMax);
  put("notApplied", state.notApplied);
  put("ungrouped", !state.grouped);
  put("track", state.track);
  put("by", state.by);
  put("pay", state.pay?.min);
  put("payMax", state.pay?.max);
  put("cur", state.pay?.currency);
  put("per", state.pay?.period);
  put("disclosed", state.pay?.disclosedOnly);
  return params;
}

/** A link to the board with the current state and some parameters changed. */
export function href(base: BoardRoute, state: FilterState, patch: Record<string, string | undefined>): Route {
  const params = new URLSearchParams(toParams(state));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  const qs = params.toString();
  return (qs ? `${base}?${qs}` : base) as Route;
}

/**
 * The pay control's starting currency and period: the primary track's first
 * range, as the candidate thinks about pay. Without a primary target, USD per
 * month.
 */
export function defaultPay(primary: TrackTarget | null): { currency: string; period: "month" | "year" } {
  const first = primary?.compensation.ranges[0];
  if (!first) return { currency: "USD", period: "month" };
  return { currency: first.currency.toUpperCase(), period: first.period === "year" ? "year" : "month" };
}

const BOARD_STATUSES = [...FUNNEL_STATUSES, "unfiled", "any"] as const;

/** The board query for the state alone. Track, term and pay are resolved by the page. */
export function toBoardFilters(state: FilterState): BoardFilters {
  return {
    minFit: state.fit,
    maxFit: state.fitMax,
    // A tela mostra o acervo a quem ainda espera a nota (#279).
    keepUnscored: true,
    cluster: state.cluster,
    query: state.query ? { terms: state.query.terms, phrases: state.query.phrases } : undefined,
    company: state.company,
    sourceKinds: state.sources,
    workMode: state.workMode,
    status: BOARD_STATUSES.find((status) => status === state.status),
    hideBlocked: state.unblocked,
    freshDays: state.fresh ? 3 : undefined,
    hasComp: state.paid,
    namedEmployer: state.named,
    hasDescription: state.described,
    hideApplied: state.notApplied,
    groupRepeats: state.grouped,
    // Relevância sem consulta não tem o que pesar: cai na ordem de fit, e o
    // parâmetro fica na URL para voltar a valer quando a consulta voltar.
    sort: state.sort === "relevance" && !state.query ? "fit" : (SORTS.find((sort) => sort === state.sort) ?? "fit"),
  };
}

export { WORK_MODES };
