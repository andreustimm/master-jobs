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

export type SourceKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "recruitee"
  | "workable"
  | "himalayas"
  | "remotive"
  | "arbeitnow"
  | "remoteok"
  | "adzuna"
  | "braintrust"
  | "careers"
  | "manual";

export type SourceConfig = {
  kind: SourceKind;
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
  kind: SourceKind;
  /** Human-facing docs URL, so the config file explains itself. */
  docs: string;
  fetchJobs(config: SourceConfig): Promise<FetchResult>;
};
