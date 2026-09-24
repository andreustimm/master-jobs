/**
 * A source adapter turns one public endpoint into `RawJob`s.
 *
 * Adapters are deliberately dumb: fetch, map, return. All normalisation,
 * deduplication and scoring happens downstream, so adding a new board is a
 * single file and never touches the pipeline.
 */
export type RawJob = {
  /** Stable id within the source. */
  externalId: string;
  companyName: string;
  title: string;
  url: string;
  applyUrl?: string | null;
  locationRaw?: string | null;
  remote?: boolean | null;
  employmentType?: string | null;
  seniorityRaw?: string | null;
  descriptionHtml?: string | null;
  descriptionText?: string | null;
  postedAt?: string | null;
  compMin?: number | null;
  compMax?: number | null;
  compCurrency?: string | null;
  compPeriod?: string | null;
  /**
   * Tags the platform attached to the posting. Only term attribution reads
   * them, and only during the capture: observation keeps no platform payload.
   */
  tags?: string[] | null;
  raw: unknown;
};

/**
 * Source kinds that can participate in an automated sync.
 *
 * This runtime tuple is also consumed by the YAML validator. The adapter
 * registry is checked exhaustively against the derived union, so a kind can
 * never become configurable before its adapter exists.
 */
export const FETCHABLE_SOURCE_KINDS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "himalayas",
  "remotive",
  "arbeitnow",
  "remoteok",
  "adzuna",
  "braintrust",
  "careers",
  "jobicy",
  "workable",
  "hackernews",
] as const;

export type FetchableSourceKind = (typeof FETCHABLE_SOURCE_KINDS)[number];

/**
 * Fontes que só existem no banco: criadas por importação, nunca varridas pelo
 * sync — e por isso fora do union de configuração.
 *
 * `recruiter` é kind próprio, e não mais um `manual`, porque a distinção é a
 * razão de existir do rótulo de origem: "eu colei esta URL" e "um recrutador
 * ofereceu isto" são coisas diferentes na triagem. Vaga com recrutador
 * identificado do outro lado se lê mais como referral do que como anúncio — há
 * contraparte humana, canal de resposta e alguém a quem perguntar.
 *
 * Kind novo aqui não força migração: as vagas antigas seguem `manual`, o union
 * de `SourceConfig` não muda e o registry de adapters não é tocado, porque não
 * há nada a buscar.
 */
export const MANUAL_SOURCE_KINDS = ["manual", "recruiter"] as const;

export type ManualSourceKind = (typeof MANUAL_SOURCE_KINDS)[number];

export type SourceKind = FetchableSourceKind | ManualSourceKind;

export type SourceConfig = {
  kind: FetchableSourceKind;
  /** Board token, company slug, or a query string for aggregators. */
  handle: string;
  label: string;
  rationale?: string;
};

/**
 * Uma entrada de `config/sources.yaml` como o carregador devolve: com
 * `enabled`, porque a entrada desabilitada também é informação — sem ela, a
 * linha do banco não teria como aprender que foi desligada no arquivo.
 */
export type CatalogEntry = SourceConfig & { enabled: boolean };

export type FetchResult = {
  jobs: RawJob[];
  /** Non-fatal problems worth surfacing without failing the whole sync. */
  warnings: string[];
};

/**
 * Whether a listing is everything the source has open, or only a window of it.
 *
 * Only a `complete` listing proves that a posting it leaves out is gone. A
 * partial window — the newest 50, the first five pages, a capped offset loop —
 * says nothing about what fell outside it, so absence there closes nothing;
 * those postings close only on a 404/410 during verification (`probe.ts`).
 * An adapter that cannot prove the end of the list declares `partial`.
 */
export type Completeness = "complete" | "partial";

export type SourceSnapshot = FetchResult & { completeness: Completeness };

/**
 * What a platform lets us spend, declared by its adapter as data (ADR-010).
 *
 * The limits apply to the whole system — sync included — and are enforced by
 * the durable ledger, never by an in-memory counter.
 */
export type PlatformBudget = {
  perDay?: number;
  perMinute?: number;
  pageSize: number;
  maxRequestsPerRun: number;
};

export type TermSearchResult = FetchResult & {
  /** What the platform said it had, for "100 of about N". */
  totalHint: number | null;
  /** A reservation was refused: the result is what fit in the budget. */
  stoppedByQuota: boolean;
};

export type TermSearch = {
  budget: PlatformBudget;
  /**
   * Date the integration last passed `jho sources probe --term` against the
   * real API. Null keeps the platform out of term runs.
   */
  validatedOn: string | null;
  /** Calls `reserve()` before every HTTP request and stops when it returns false. */
  search(query: string, opts: { limit: number; reserve: () => Promise<boolean> }): Promise<TermSearchResult>;
};

export type SourceAdapter = {
  kind: FetchableSourceKind;
  /** Human-facing docs URL, so the config file explains itself. */
  docs: string;
  /**
   * Se a listagem PODE provar que terminou: `complete` quando o adapter sabe
   * reconhecer o fim da lista (cada execução ainda declara a sua completude),
   * `partial` quando nunca vê mais que uma janela. Ausente = desconhecido, e a
   * tela de catálogo trata como indisponível.
   */
  snapshot?: "complete" | "partial";
  fetchJobs(config: SourceConfig): Promise<SourceSnapshot>;
  /** Present only on platforms that search by term (ADR-004). */
  termSearch?: TermSearch;
};
