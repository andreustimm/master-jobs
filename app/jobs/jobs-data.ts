import {
  cachedBoardFacets,
  countHiddenByPayRange,
  listBoardPage,
  listCandidateTracks,
  listSavedTerms,
  recordTermVisit,
  resolveClusterFilter,
  savedTermForBoard,
  trackScope,
  type BoardFacets,
  type BoardFilters,
  type PayFilter,
  type SavedTermSummary,
  type TermRunState,
  type Track,
  type TrackChoice,
  type TrackScope,
} from "../../src/contexts/matching/index.ts";
import { loadRates } from "../../src/contexts/fx/index.ts";
import type { StageTimer } from "../../src/core/observability.ts";
import { defaultPay, readFilters, toBoardFilters, type FilterNotice, type FilterState } from "../filter-state";

/** Abaixo disto, a oferta de buscar o termo nas plataformas ganha destaque. */
export const FEW_MATCHES = 10;

export type JobsView = {
  state: FilterState;
  notices: FilterNotice[];
  rows: Awaited<ReturnType<typeof listBoardPage>>["rows"];
  total: number;
  facets: BoardFacets;
  /** Jobs the pay minimum hid (disclosed, comparable, below it). */
  hiddenByPayRange: number;
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
  /** Mede cada estágio de espera do banco; ausente, a leitura roda sem medir. */
  timer?: StageTimer;
}): Promise<JobsView> {
  const { candidateId } = input;
  const stage = <T>(name: string, work: () => Promise<T>): Promise<T> =>
    input.timer ? input.timer.time(name, work) : work();
  const state = readFilters(input.params);
  const notices = [...state.notices];

  // Trilhas e câmbio não dependem um do outro, e cada ida ao banco é um
  // round-trip: juntas custam um. Em série eram quatro ou cinco esperas — as
  // trilhas lidas de novo pelo escopo (e pelo cluster, quando há) e o câmbio em
  // duas consultas. Duas por vez, sempre: o teto de conexões vale para a tela
  // inteira, ver o comentário mais abaixo.
  const [allTracks, fx] = await stage("prelude", () =>
    Promise.all([
      candidateId !== null ? listCandidateTracks(candidateId) : Promise.resolve([] as Track[]),
      loadRates(),
    ]),
  );

  let tracks: Track[] = [];
  let scope: TrackScope | null = null;
  let cluster = state.cluster;
  let broughtBy: JobsView["broughtBy"] = null;
  if (candidateId !== null) {
    tracks = allTracks.filter((track) => track.status === "active" && track.target);
    // As mesmas trilhas já lidas: escopo e cluster não voltam ao banco por elas.
    scope = await trackScope(candidateId, trackChoice(state), allTracks);
    if (scope?.notice) notices.push(scope.notice);
    if (scope && cluster) {
      const resolved = await resolveClusterFilter(scope, cluster, allTracks);
      cluster = resolved.cluster;
      if (resolved.notice) notices.push(resolved.notice);
    }
    const termId = state.by;
    if (termId !== undefined) {
      broughtBy = await stage("brought_by", () => savedTermForBoard({ candidateId }, termId, input.now));
    }
  }
  if (state.by !== undefined && !broughtBy && !notices.includes("term_unknown")) notices.push("term_unknown");

  const primary = tracks.find((track) => track.isPrimary);
  const defaults = defaultPay(primary?.target ?? null);
  const currencies = fx
    ? [...new Set([fx.base, ...Object.keys(fx.rates)].map((code) => code.toUpperCase()))].sort()
    : [defaults.currency];
  const currency =
    state.pay?.currency && currencies.includes(state.pay.currency) ? state.pay.currency : defaults.currency;
  const pay: PayFilter = {
    min: state.pay?.min,
    max: state.pay?.max,
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
    // O câmbio já está em mãos desde a linha de cima. Sem passar, cada leitura
    // que normaliza pagamento ia buscá-lo de novo — duas consultas cada.
    rates: fx,
  };
  // Lista e total compartilham a consulta; as facetas leem seu próprio conjunto
  // porque ignoram filtros diferentes. O teto da tela continua `POOL - 1`:
  // as etapas deixam conexão disponível para a requisição do lado.
  const { rows, total } = await stage("board", () =>
    listBoardPage(candidateId, { ...filters, limit: input.pageSize, offset: (input.page - 1) * input.pageSize }),
  );
  // Com cache: paginar, reordenar ou trocar a faixa salarial não muda as
  // facetas, e elas eram a leitura mais cara da tela. Ver `cachedBoardFacets`.
  const facets = await stage("facets", () =>
    cachedBoardFacets(candidateId, {
      minFit: state.fit,
      cluster,
      term: state.term,
      sourceKinds: state.sources,
      workMode: state.workMode,
      track: scope ?? undefined,
      // Os chips têm de contar a MESMA coisa que o rodapé. Sem isto o rodapé
      // contava grupos e os chips contavam publicações, e um chip podia mostrar
      // número maior que o total exibido ao lado dele.
      groupRepeats: filters.groupRepeats,
    }),
  );
  // Os termos salvos só alimentam o seletor da tela — nenhum filtro depende
  // deles —, então viajam ao lado da última leitura em vez de abrir uma ida
  // própria antes das que importam.
  const [hiddenByPayRange, savedTerms] = await stage("tail", () =>
    Promise.all([
      countHiddenByPayRange(candidateId, filters),
      candidateId !== null ? listSavedTerms({ candidateId }) : Promise.resolve([] as SavedTermSummary[]),
    ]),
  );

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
    hiddenByPayRange,
    tracks,
    scope,
    savedTerms,
    broughtBy,
    currencies,
    pay,
    offer: state.term && candidateId !== null ? { term: state.term.term, emphasized: total < FEW_MATCHES } : null,
  };
}
