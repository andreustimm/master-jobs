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

export type FetchResult = {
  jobs: RawJob[];
  /** Non-fatal problems worth surfacing without failing the whole sync. */
  warnings: string[];
};

export type SourceAdapter = {
  kind: FetchableSourceKind;
  /** Human-facing docs URL, so the config file explains itself. */
  docs: string;
  fetchJobs(config: SourceConfig): Promise<FetchResult>;
};
