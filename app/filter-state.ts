import type { Route } from "next";
import { WORK_MODES, readWorkMode, type BoardFilters, type TrackTarget, type WorkMode } from "../src/contexts/matching/index.ts";
import { APPLICATION_STATUSES } from "../src/contexts/pursuit/domain/application.ts";
import { validateTerm, type TermError, type ValidTerm } from "../src/core/term.ts";

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

export type FilterNotice = TermError | "pay_invalid" | "track_unknown" | "term_unknown" | "cluster_unknown";

export type PayState = {
  /** Minimum top of the range; absent means "normalize and sort only". */
  min?: number;
  currency?: string;
  period?: "month" | "year";
  disclosedOnly: boolean;
};

export type FilterState = {
  fit: number;
  cluster?: string;
  /** Whole-word term over title, company and description (`q`). */
  term?: ValidTerm;
  source?: string;
  workMode?: WorkMode;
  unblocked?: boolean;
  fresh?: boolean;
  paid?: boolean;
  named?: boolean;
  described?: boolean;
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

/** Largest pay amount the filter accepts, as on the track editor. */
export const PAY_FILTER_MAX = 10_000_000;

const SORTS = ["fit", "recent", "comp"] as const;

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
  const notices: FilterNotice[] = [];
  const state: FilterState = {
    fit: Number(one("fit") ?? 45),
    cluster: one("cluster"),
    source: one("source"),
    workMode: readWorkMode(one("workMode")),
    status: one("status"),
    sort: SORTS.find((sort) => sort === one("sort")),
    unblocked: one("unblocked") === "1",
    fresh: one("fresh") === "1",
    paid: one("paid") === "1",
    named: one("named") === "1",
    described: one("described") === "1",
    notices,
  };

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

  const rawPay = one("pay");
  const rawCurrency = one("cur")?.trim().toUpperCase();
  const rawPeriod = one("per");
  const disclosedOnly = one("disclosed") === "1";
  let min: number | undefined;
  if (rawPay !== undefined && rawPay !== "") {
    const amount = positiveInt(rawPay);
    if (amount === null || amount > PAY_FILTER_MAX) notices.push("pay_invalid");
    else min = amount;
  }
  const currency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : undefined;
  const period = rawPeriod === "month" || rawPeriod === "year" ? rawPeriod : undefined;
  if (min !== undefined || currency || period || disclosedOnly) {
    state.pay = { min, currency, period, disclosedOnly };
  }
  return state;
}

/** The state as URL parameters, in a stable order. Notices never travel. */
export function toParams(state: FilterState): Record<string, string> {
  const params: Record<string, string> = { fit: String(state.fit) };
  const put = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined || value === "" || value === false) return;
    params[key] = value === true ? "1" : String(value);
  };
  put("cluster", state.cluster);
  put("q", state.term?.term);
  put("source", state.source);
  put("workMode", state.workMode);
  put("status", state.status);
  put("sort", state.sort);
  put("unblocked", state.unblocked);
  put("fresh", state.fresh);
  put("paid", state.paid);
  put("named", state.named);
  put("described", state.described);
  put("track", state.track);
  put("by", state.by);
  put("pay", state.pay?.min);
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
    cluster: state.cluster,
    term: state.term,
    sourceKind: state.source,
    workMode: state.workMode,
    status: BOARD_STATUSES.find((status) => status === state.status),
    hideBlocked: state.unblocked,
    freshDays: state.fresh ? 3 : undefined,
    hasComp: state.paid,
    namedEmployer: state.named,
    hasDescription: state.described,
    sort: SORTS.find((sort) => sort === state.sort) ?? "fit",
  };
}

export { WORK_MODES };
