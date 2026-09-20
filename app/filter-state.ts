import type { Route } from "next";
import { WORK_MODES, readWorkMode, type BoardFilters, type TrackTarget, type WorkMode } from "../src/contexts/matching/index.ts";
import { APPLICATION_STATUSES } from "../src/contexts/pursuit/domain/application.ts";
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
  | "cluster_unknown";

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
  /** Whole-word term over title, company and description (`q`). */
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

const SORTS = ["fit", "recent", "comp"] as const;

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
    const valid = validateTerm(q);
    if (valid.ok) state.term = valid.value;
    else notices.push(valid.code);
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
    notices.push("range_swapped");
  }

  const rawCurrency = one("cur")?.trim().toUpperCase();
  const rawPeriod = one("per");
  const disclosedOnly = one("disclosed") === "1";
  const bound = (raw: string | undefined): number | undefined => {
    if (raw === undefined || raw === "") return undefined;
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
    notices.push("range_swapped");
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
  put("q", state.term?.term);
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

const BOARD_STATUSES = [...APPLICATION_STATUSES, "unfiled", "any"] as const;

/** The board query for the state alone. Track, term and pay are resolved by the page. */
export function toBoardFilters(state: FilterState): BoardFilters {
  return {
    minFit: state.fit,
    maxFit: state.fitMax,
    cluster: state.cluster,
    term: state.term,
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
    sort: SORTS.find((sort) => sort === state.sort) ?? "fit",
  };
}

export { WORK_MODES };
