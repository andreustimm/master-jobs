import {
  boardFacets,
  countBoard,
  countHiddenBelowMinimum,
  listBoard,
  listCandidateTracks,
  listSavedTerms,
  recordTermVisit,
  resolveClusterFilter,
  savedTermForBoard,
  trackScope,
  type BoardFilters,
  type PayFilter,
  type SavedTermSummary,
  type TermRunState,
  type Track,
  type TrackChoice,
  type TrackScope,
} from "../../src/contexts/matching/index.ts";
import { loadRates } from "../../src/contexts/fx/index.ts";
import { defaultPay, readFilters, toBoardFilters, type FilterNotice, type FilterState } from "../filter-state";

/** Abaixo disto, a oferta de buscar o termo nas plataformas ganha destaque. */
export const FEW_MATCHES = 10;

export type JobsView = {
  state: FilterState;
  notices: FilterNotice[];
  rows: Awaited<ReturnType<typeof listBoard>>;
  total: number;
  facets: Awaited<ReturnType<typeof boardFacets>>;
  /** Jobs the pay minimum hid (disclosed, comparable, below it). */
  hiddenBelowMinimum: number;
  /** Active tracks for the selector; empty without a candidate scope. */
  tracks: Track[];
  scope: TrackScope | null;
  savedTerms: SavedTermSummary[];
  broughtBy: (SavedTermSummary & { run: TermRunState }) | null;
  /** Currencies with a stored rate on the latest quote date. */
  currencies: string[];
  /** The currency and period pay is shown and compared in. */
  pay: PayFilter;
  /** Offer to search the platforms for the typed term; emphasized when few match. */
  offer: { term: string; emphasized: boolean } | null;
};

function trackChoice(state: FilterState): TrackChoice {
  if (state.track === "all") return { kind: "all" };
  if (typeof state.track === "number") return { kind: "track", trackId: state.track };
  return { kind: "primary" };
}

/**
 * Tudo que a tela Vagas lê, sem UI — a página só apresenta.
 *
 * A visita ao filtro "trazida por" é gravada DEPOIS da resposta, por
 * `schedule`: as vagas são marcadas como novas contra a visita anterior. Um
 * prefetch do roteador não é visita — marcar nele zeraria a contagem de novas
 * antes de a pessoa abrir a página.
 */
export async function loadJobsView(input: {
  candidateId: number | null;
  params: Record<string, string | string[] | undefined>;
  page: number;
  pageSize: number;
  prefetch: boolean;
  schedule: (task: () => Promise<void>) => void;
  now: Date;
}): Promise<JobsView> {
  const { candidateId } = input;
  const state = readFilters(input.params);
  const notices = [...state.notices];

  let tracks: Track[] = [];
  let scope: TrackScope | null = null;
  let savedTerms: SavedTermSummary[] = [];
  let cluster = state.cluster;
  let broughtBy: JobsView["broughtBy"] = null;
  if (candidateId !== null) {
    tracks = (await listCandidateTracks(candidateId)).filter((track) => track.status === "active" && track.target);
    scope = await trackScope(candidateId, trackChoice(state));
    if (scope?.notice) notices.push(scope.notice);
    if (scope && cluster) {
      const resolved = await resolveClusterFilter(scope, cluster);
      cluster = resolved.cluster;
      if (resolved.notice) notices.push(resolved.notice);
    }
    savedTerms = await listSavedTerms({ candidateId });
    if (state.by !== undefined) broughtBy = await savedTermForBoard({ candidateId }, state.by, input.now);
  }
  if (state.by !== undefined && !broughtBy && !notices.includes("term_unknown")) notices.push("term_unknown");

  const fx = await loadRates();
  const primary = tracks.find((track) => track.isPrimary);
  const defaults = defaultPay(primary?.target ?? null);
  const currencies = fx
    ? [...new Set([fx.base, ...Object.keys(fx.rates)].map((code) => code.toUpperCase()))].sort()
    : [defaults.currency];
  const currency =
    state.pay?.currency && currencies.includes(state.pay.currency) ? state.pay.currency : defaults.currency;
  const pay: PayFilter = {
    min: state.pay?.min,
    currency,
    period: state.pay?.period ?? defaults.period,
    disclosedOnly: state.pay?.disclosedOnly ?? false,
  };
  // Pay is normalized when the viewer set any pay control or sorts by pay;
  // otherwise the board stays as fast as before.
  const payActive = state.pay !== undefined || state.sort === "comp";

  const filters: BoardFilters = {
    ...toBoardFilters(state),
    cluster,
    track: scope ?? undefined,
    broughtBy: broughtBy ? { termKey: broughtBy.termKey } : undefined,
    newSince: broughtBy ? (broughtBy.lastVisitAt ?? "") : undefined,
    pay: payActive ? pay : undefined,
  };
  const [rows, total, facets, hiddenBelowMinimum] = await Promise.all([
    listBoard(candidateId, { ...filters, limit: input.pageSize, offset: (input.page - 1) * input.pageSize }),
    countBoard(candidateId, filters),
    boardFacets(candidateId, {
      minFit: state.fit,
      cluster,
      term: state.term,
      sourceKind: state.source,
      workMode: state.workMode,
      track: scope ?? undefined,
    }),
    countHiddenBelowMinimum(candidateId, filters),
  ]);

  if (broughtBy && candidateId !== null && !input.prefetch) {
    const termId = broughtBy.id;
    const at = input.now;
    input.schedule(() => recordTermVisit({ candidateId }, termId, at));
  }

  return {
    state,
    notices,
    rows,
    total,
    facets,
    hiddenBelowMinimum,
    tracks,
    scope,
    savedTerms,
    broughtBy,
    currencies,
    pay,
    offer: state.term && candidateId !== null ? { term: state.term.term, emphasized: total < FEW_MATCHES } : null,
  };
}
