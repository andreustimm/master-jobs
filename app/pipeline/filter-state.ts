import type { Route } from "next";
import { FUNNEL_STATUSES, type ApplicationStatus } from "../../src/contexts/pursuit/domain/application.ts";
import type { PipelineFilters } from "../../src/contexts/pursuit/index.ts";
import { EMPTY_SYNONYMS, type SynonymDictionary } from "../../src/core/synonyms.ts";
import { searchSynonyms } from "../../src/core/synonyms-load.ts";
import { FIT_MAX } from "../filter-scales.ts";
import { readSearchQuery, unreadableFit, type FilterNotice, type SearchQueryState } from "../filter-state.ts";

/**
 * O estado dos filtros do Funil (#478), lido da URL e escrito de volta nela.
 *
 * Mesma regra de `app/filter-state.ts`: filtro vive na URL, a página continua
 * Server Component, e parâmetro inválido vira aviso em vez de derrubar a tela.
 * A consulta `q` é lida pela mesma `readSearchQuery` de Vagas.
 */
export type PipelineState = {
  /** `null` é o funil inteiro. */
  stage: ApplicationStatus | null;
  /** O `stage` da URL não é um estágio do funil. */
  invalidStage: boolean;
  query?: SearchQueryState;
  /**
   * Ampliar a consulta: sinônimos da lista curada e título de grafia parecida.
   * Fica na URL mesmo sem consulta, para valer quando ela voltar.
   */
  semantic: boolean;
  companies: string[];
  channels: string[];
  /** Piso do score; ausente é sem piso. */
  fit?: number;
  /** Teto do score; ausente é sem teto. */
  fitMax?: number;
  notices: FilterNotice[];
};

type Params = Record<string, string | string[] | undefined>;

/** Score da URL preso entre 0 e o teto do scorer; vazio ou ilegível não filtra. */
function readFit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), FIT_MAX) : undefined;
}

/**
 * `dictionary` é a lista de sinônimos da composição; só vale com `semantic=1`.
 * Sem ele a busca é literal, como a pessoa a escreveu.
 */
export function readPipelineFilters(params: Params, dictionary: SynonymDictionary = searchSynonyms()): PipelineState {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  // Repetido, como a lista de checkboxes envia; um valor só também vale.
  const many = (key: string) => {
    const value = params[key];
    const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
    return [...new Set(raw.map((item) => item.trim()).filter((item) => item !== ""))];
  };

  const rawStage = one("stage");
  const stage = FUNNEL_STATUSES.find((status) => status === rawStage) ?? null;
  const semantic = one("semantic") === "1";
  const notices: FilterNotice[] = [];
  const search = readSearchQuery(one("q"), semantic ? dictionary : EMPTY_SYNONYMS);
  if (search.notice) notices.push(search.notice);

  // Parâmetro ilegível é ignorado com aviso, como diz o contrato acima (#494).
  if (unreadableFit(one("fit")) || unreadableFit(one("fitMax"))) notices.push("fit_invalid");
  let fit = readFit(one("fit"));
  let fitMax = readFit(one("fitMax"));
  if (fit !== undefined && fitMax !== undefined && fit > fitMax) {
    [fit, fitMax] = [fitMax, fit];
    notices.push("range_swapped");
  }

  return {
    stage,
    invalidStage: Boolean(rawStage) && stage === null,
    query: search.query,
    semantic,
    companies: many("company"),
    channels: many("channel"),
    fit,
    fitMax,
    notices,
  };
}

/**
 * A chave da dica de "ampliar busca". Só promete sinônimo quando a lista está
 * em uso: `SEARCH_SYNONYMS_ENABLED` ligada e arquivo válido. Desligada (o
 * padrão), ampliar acha só título de grafia parecida.
 */
export function broadenHintKey(
  dictionary: SynonymDictionary = searchSynonyms(),
): "pipeline.broadenHint" | "pipeline.broadenHintSpelling" {
  return dictionary.lookup.size > 0 ? "pipeline.broadenHint" : "pipeline.broadenHintSpelling";
}

/** O estado como parâmetros, em ordem estável. Página e avisos nunca viajam. */
export function toPipelineParams(state: PipelineState): Array<[string, string]> {
  const params: Array<[string, string]> = [];
  if (state.stage) params.push(["stage", state.stage]);
  if (state.query) params.push(["q", state.query.raw]);
  if (state.semantic) params.push(["semantic", "1"]);
  for (const company of state.companies) params.push(["company", company]);
  for (const channel of state.channels) params.push(["channel", channel]);
  if (state.fit !== undefined) params.push(["fit", String(state.fit)]);
  if (state.fitMax !== undefined) params.push(["fitMax", String(state.fitMax)]);
  return params;
}

/**
 * Link do funil com o estado atual e alguns parâmetros trocados. Sem `page` no
 * `patch`, volta à primeira página: outro filtro é outra lista.
 */
export function pipelineHref(state: PipelineState, patch: Record<string, string | undefined> = {}): Route {
  const params = new URLSearchParams(toPipelineParams(state));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  const search = params.toString();
  return (search ? `/pipeline?${search}` : "/pipeline") as Route;
}

/** Algum filtro além do estágio corta a lista. `semantic` sozinho não corta. */
export function hasPipelineFilters(state: PipelineState): boolean {
  return (
    state.query !== undefined ||
    state.companies.length > 0 ||
    state.channels.length > 0 ||
    state.fit !== undefined ||
    state.fitMax !== undefined
  );
}

/** O funil sem os filtros, no mesmo estágio. */
export function clearPipelineFiltersHref(state: PipelineState): Route {
  return pipelineHref({ stage: state.stage, invalidStage: false, semantic: false, companies: [], channels: [], notices: [] });
}

/** A consulta do repositório para o estado. */
export function toPipelineFilters(state: PipelineState): PipelineFilters {
  return {
    query: state.query ? { terms: state.query.terms, phrases: state.query.phrases } : undefined,
    synonyms: state.query?.synonyms,
    proximity: state.semantic && state.query !== undefined,
    companies: state.companies,
    channels: state.channels,
    minFit: state.fit,
    maxFit: state.fitMax,
  };
}
