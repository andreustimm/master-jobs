/**
 * Adapters for free remote-job aggregators.
 *
 * These widen the funnel beyond companies you already know about. They are
 * noisier than ATS boards, so the scorer does the filtering — not the fetcher.
 * Field shapes verified against live responses.
 */
import { firstNonEmpty, getJson, htmlToText } from "./http.ts";
import type {
  PlatformBudget,
  RawJob,
  SourceAdapter,
  SourceConfig,
  SourceSnapshot,
  TermSearchResult,
} from "./types.ts";

/**
 * Budgeted platforms never retry inside a call (ADR-010): a retry would spend
 * a unit the ledger did not reserve. A failed call waits for the next window.
 */
export const BUDGETED = { retries: 0 } as const;

export const QUOTA_STOP: TermSearchResult = { jobs: [], warnings: [], totalHint: null, stoppedByQuota: true };

export function cleanTags(tags: unknown): string[] | null {
  if (!Array.isArray(tags)) return null;
  const clean = tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean);
  return clean.length > 0 ? clean : null;
}

/* -------------------------------- Himalayas ------------------------------- */

type HimalayasJob = {
  guid: string;
  title: string;
  companyName: string;
  companySlug?: string;
  employmentType?: string;
  seniority?: string[] | string;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  salaryPeriod?: string | null;
  locationRestrictions?: unknown;
  description?: string;
  excerpt?: string;
  pubDate?: number | string;
  applicationLink?: string;
  /** Search results only: the platform's own classification, used as tags. */
  categories?: string[];
};

/** Aggregators are inconsistent: a field is sometimes a string, sometimes a list. */
export function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

function toIso(value: number | string | undefined | null): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    // Himalayas returns seconds, not milliseconds.
    return new Date(value * 1000).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Page size is fixed server-side: `limit` above 20 is silently ignored. */
const HIMALAYAS_PAGE = 20;
const HIMALAYAS_DEFAULT_PAGES = 50;

/**
 * Sem limite por minuto (PRD, orçamento da Himalayas): a busca faz até 5 páginas
 * seguidas numa execução, e um teto de 1 por minuto parava toda captura na
 * primeira página, com 20 das 100 vagas prometidas. O 429 continua esgotando o dia.
 */
const HIMALAYAS_BUDGET: PlatformBudget = { pageSize: HIMALAYAS_PAGE, maxRequestsPerRun: 5 };

/**
 * The site shows `locationRestrictions` as "United States only": who may
 * apply, not where the team sits. Stated as a sentence in the description, the
 * way Braintrust states its eligibility, which the scorer reads
 * (`locationRestriction` in score.ts).
 */
export function withRestriction(text: string | null, countries: string[]): string | null {
  if (countries.length === 0) return text;
  const line = `Location restricted to: ${countries.join(", ")} only.`;
  return text ? `${text}\n\n${line}` : line;
}

function mapHimalayas(j: HimalayasJob): RawJob {
  const restrictions = toList(j.locationRestrictions);
  return {
    externalId: j.guid,
    companyName: j.companyName,
    title: j.title.trim(),
    url: j.applicationLink ?? `https://himalayas.app/companies/${j.companySlug ?? ""}`,
    applyUrl: j.applicationLink ?? null,
    // Part of the posting's identity (the fingerprint), so it stays the bare
    // list: rewriting it would insert every restricted job a second time.
    locationRaw: restrictions.join(", ") || "Remote",
    remote: true,
    employmentType: j.employmentType ?? null,
    seniorityRaw: Array.isArray(j.seniority) ? j.seniority.join(", ") : (j.seniority ?? null),
    descriptionHtml: j.description ?? null,
    descriptionText: withRestriction(firstNonEmpty(htmlToText(j.description), j.excerpt), restrictions),
    postedAt: toIso(j.pubDate),
    compMin: j.minSalary ?? null,
    compMax: j.maxSalary ?? null,
    compCurrency: j.currency ?? null,
    compPeriod: j.salaryPeriod ?? null,
    tags: cleanTags(j.categories),
    raw: j,
  };
}

export const himalayas: SourceAdapter = {
  kind: "himalayas",
  snapshot: "complete",
  docs: "https://himalayas.app/api",
  async fetchJobs(config: SourceConfig): Promise<SourceSnapshot> {
    // Himalayas exposes ~101.000 postings but serves 20 per request and
    // ignores a larger `limit`, so the whole board would be ~5.000 calls —
    // neither practical nor polite. It orders by publication date descending,
    // which makes the first pages the freshest postings, and freshness is the
    // strongest lever on reply rate. So we page a bounded, recent slice.
    //
    // `handle` is the page count ("" uses the default). It is NOT a search
    // term: the API accepts `q` and ignores it — every query returns the same
    // 101.018 results — so filtering happens in the scorer, as everywhere else.
    const requested = Number.parseInt(config.handle, 10);
    const pages =
      Number.isFinite(requested) && requested > 0 ? requested : HIMALAYAS_DEFAULT_PAGES;

    const collected: HimalayasJob[] = [];
    const warnings: string[] = [];
    let total: number | undefined;

    for (let page = 0; page < pages; page++) {
      const offset = page * HIMALAYAS_PAGE;
      // Retentativa padrão nas páginas do feed: a sincronização reserva uma
      // unidade por execução, não por página, e sem retentativa um 5xx
      // passageiro numa das 60 páginas jogava fora o feed inteiro.
      const data = await getJson<{ jobs?: HimalayasJob[]; totalCount?: number }>(
        `https://himalayas.app/jobs/api?limit=${HIMALAYAS_PAGE}&offset=${offset}`,
      );
      total = data.totalCount ?? total;
      const batch = data.jobs ?? [];
      collected.push(...batch);
      if (batch.length < HIMALAYAS_PAGE) break;
      // Deliberate pacing: this is a free service doing us a favour.
      if (page < pages - 1) await new Promise((r) => setTimeout(r, 120));
    }

    if (total && collected.length < total) {
      warnings.push(
        `himalayas: ${collected.length} de ${total.toLocaleString("pt-BR")} vagas (as mais recentes). Aumente o handle para paginar mais.`,
      );
    }

    // The feed is a recency window over ~100.000 postings: leaving it is aging
    // out, not closing. Only the platform's own total proves the list ended.
    const completeness = total !== undefined && collected.length >= total ? "complete" : "partial";
    return { jobs: collected.map(mapHimalayas), warnings, completeness };
  },
  termSearch: {
    budget: HIMALAYAS_BUDGET,
    // The search endpoint is not the feed: it honours `q` and pages with
    // `page` (1-based; `offset` is ignored there). `jho sources probe
    // himalayas --term laravel` returned 98 of about 296 on 2026-09-19.
    validatedOn: "2026-09-19",
    async search(query, opts) {
      const collected: HimalayasJob[] = [];
      let totalHint: number | null = null;
      let stoppedByQuota = false;
      const pages = Math.min(HIMALAYAS_BUDGET.maxRequestsPerRun, Math.ceil(opts.limit / HIMALAYAS_PAGE));
      for (let page = 1; page <= pages; page++) {
        if (!(await opts.reserve())) {
          stoppedByQuota = true;
          break;
        }
        const params = new URLSearchParams({ q: query, page: String(page) });
        const data = await getJson<{ jobs?: HimalayasJob[]; totalCount?: number }>(
          `https://himalayas.app/jobs/api/search?${params}`,
          BUDGETED,
        );
        totalHint = data.totalCount ?? totalHint;
        const batch = data.jobs ?? [];
        collected.push(...batch);
        // A page can come back short in the middle of the results (the probe
        // got 19 on page 3 of 296): only an empty page or the total ends it.
        if (batch.length === 0 || (totalHint !== null && page * HIMALAYAS_PAGE >= totalHint)) break;
      }
      return {
        jobs: collected.slice(0, opts.limit).map(mapHimalayas),
        warnings: [],
        totalHint,
        stoppedByQuota,
      };
    },
  },
};

/* --------------------------------- Remotive ------------------------------- */

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
};

type RemotiveResponse = { jobs?: RemotiveJob[]; "total-job-count"?: number };

/**
 * The API's legal notice asks for "max. 4 times a day" and blocks excessive
 * requests. Four is the system-wide day budget, sync included.
 */
const REMOTIVE_BUDGET: PlatformBudget = { perDay: 4, perMinute: 2, pageSize: 100, maxRequestsPerRun: 1 };

function mapRemotive(j: RemotiveJob): RawJob {
  return {
    externalId: String(j.id),
    companyName: j.company_name,
    title: j.title.trim(),
    url: j.url,
    applyUrl: j.url,
    locationRaw: j.candidate_required_location ?? "Remote",
    remote: true,
    employmentType: j.job_type ?? null,
    descriptionHtml: j.description ?? null,
    descriptionText: htmlToText(j.description),
    postedAt: j.publication_date ?? null,
    tags: cleanTags(j.tags),
    raw: j,
  };
}

export const remotive: SourceAdapter = {
  kind: "remotive",
  snapshot: "partial",
  docs: "https://remotive.com/api/remote-jobs",
  async fetchJobs(config: SourceConfig): Promise<SourceSnapshot> {
    const params = new URLSearchParams({ limit: "50" });
    if (config.handle) params.set("search", config.handle);
    const data = await getJson<RemotiveResponse>(`https://remotive.com/api/remote-jobs?${params}`, BUDGETED);
    // `limit=50`: the newest slice of a search, never the whole board.
    return { jobs: (data.jobs ?? []).map(mapRemotive), warnings: [], completeness: "partial" };
  },
  termSearch: {
    budget: REMOTIVE_BUDGET,
    validatedOn: "2026-09-19",
    async search(query, opts) {
      if (!(await opts.reserve())) return QUOTA_STOP;
      const params = new URLSearchParams({
        search: query,
        limit: String(Math.min(opts.limit, REMOTIVE_BUDGET.pageSize)),
      });
      const data = await getJson<RemotiveResponse>(`https://remotive.com/api/remote-jobs?${params}`, BUDGETED);
      const jobs = (data.jobs ?? []).map(mapRemotive);
      return { jobs, warnings: [], totalHint: data["total-job-count"] ?? jobs.length, stoppedByQuota: false };
    },
  },
};

/* -------------------------------- Arbeitnow ------------------------------- */

type ArbeitnowJob = {
  slug: string;
  company_name: string;
  title: string;
  description?: string;
  remote?: boolean;
  url: string;
  tags?: unknown;
  job_types?: unknown;
  location?: string;
  created_at?: number;
};

export const arbeitnow: SourceAdapter = {
  kind: "arbeitnow",
  snapshot: "partial",
  docs: "https://www.arbeitnow.com/blog/job-board-api",
  async fetchJobs(_config: SourceConfig): Promise<SourceSnapshot> {
    const data = await getJson<{ data?: ArbeitnowJob[] }>(
      "https://www.arbeitnow.com/api/job-board-api",
    );
    const jobs = (data.data ?? []).map((j): RawJob => ({
      externalId: j.slug,
      companyName: j.company_name,
      title: j.title.trim(),
      url: j.url,
      applyUrl: j.url,
      locationRaw: j.location ?? null,
      remote: j.remote ?? null,
      employmentType: toList(j.job_types).join(", ") || null,
      descriptionHtml: j.description ?? null,
      descriptionText: htmlToText(j.description),
      postedAt: toIso(j.created_at),
      raw: j,
    }));
    // Only the first page of a paginated board is read.
    return { jobs, warnings: [], completeness: "partial" };
  },
};

/* --------------------------------- RemoteOK ------------------------------- */

type RemoteOkJob = {
  id?: string;
  slug?: string;
  company?: string;
  position?: string;
  description?: string;
  location?: string;
  tags?: string[];
  date?: string;
  url?: string;
  apply_url?: string;
  salary_min?: number;
  salary_max?: number;
  legal?: string;
};

/** No published limit: one call a minute is the courtesy floor (ADR-010). */
const REMOTEOK_BUDGET: PlatformBudget = { perMinute: 1, pageSize: 100, maxRequestsPerRun: 1 };

/** The first element of the array is a legal notice, not a job. */
function remoteOkJobs(data: RemoteOkJob[] | null): RawJob[] {
  return (data ?? [])
    .filter((j) => !j.legal && j.position && j.id)
    .map((j): RawJob => ({
      externalId: String(j.id),
      companyName: j.company ?? "Unknown",
      title: (j.position ?? "").trim(),
      url: j.url ?? `https://remoteok.com/remote-jobs/${j.slug ?? j.id}`,
      applyUrl: j.apply_url ?? null,
      locationRaw: j.location || "Remote",
      remote: true,
      descriptionHtml: j.description ?? null,
      descriptionText: htmlToText(j.description),
      postedAt: j.date ?? null,
      compMin: j.salary_min ?? null,
      compMax: j.salary_max ?? null,
      compCurrency: j.salary_min ? "USD" : null,
      compPeriod: j.salary_min ? "year" : null,
      tags: cleanTags(j.tags),
      raw: j,
    }));
}

/** `Tech Lead` -> `tech-lead`: RemoteOK tags are lowercase and hyphenated. */
export function remoteOkTag(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, "-");
}

export const remoteok: SourceAdapter = {
  kind: "remoteok",
  snapshot: "partial",
  docs: "https://remoteok.com/api",
  async fetchJobs(_config: SourceConfig): Promise<SourceSnapshot> {
    const data = await getJson<RemoteOkJob[]>("https://remoteok.com/api", BUDGETED);
    // The feed is the latest postings, not the archive of open ones.
    return { jobs: remoteOkJobs(data), warnings: [], completeness: "partial" };
  },
  termSearch: {
    budget: REMOTEOK_BUDGET,
    // `tag` is undocumented: `jho sources probe remoteok --term "tech lead"`
    // answered with the three tag matches on 2026-09-19. A change surfaces as
    // `endpoint_gone` or `parse` on the admin view, and Remotive keeps working.
    validatedOn: "2026-09-19",
    async search(query, opts) {
      if (!(await opts.reserve())) return QUOTA_STOP;
      const data = await getJson<RemoteOkJob[]>(
        `https://remoteok.com/api?tag=${encodeURIComponent(remoteOkTag(query))}`,
        BUDGETED,
      );
      const jobs = remoteOkJobs(data);
      return { jobs: jobs.slice(0, opts.limit), warnings: [], totalHint: jobs.length, stoppedByQuota: false };
    },
  },
};

/* ---------------------------------- Adzuna -------------------------------- */

type AdzunaJob = {
  id: string;
  title: string;
  redirect_url: string;
  created?: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  company?: { display_name?: string };
  location?: { display_name?: string };
  contract_time?: string;
};

export const adzuna: SourceAdapter = {
  kind: "adzuna",
  snapshot: "partial",
  docs: "https://developer.adzuna.com/",
  async fetchJobs(config: SourceConfig): Promise<SourceSnapshot> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    if (!appId || !appKey) {
      return {
        jobs: [],
        warnings: ["adzuna skipped: ADZUNA_APP_ID/ADZUNA_APP_KEY not set"],
        completeness: "partial",
      };
    }
    // handle format: "<country>:<query>", e.g. "us:AI architect"
    //
    // `|| "us"` e não default de destructuring: `"".split(":")` devolve `[""]`,
    // não `[undefined]`, e default só vale para `undefined`. O país saía vazio
    // e a URL virava `/jobs//search/1` — 404 silencioso.
    //
    // Não é hipotético: `config.ts` declara `handle: z.string().default("")`,
    // então uma entrada `- kind: adzuna` sem handle PASSA na validação e chega
    // aqui vazia.
    const [rawCountry, ...rest] = config.handle.split(":");
    const country = rawCountry || "us";
    const what = rest.join(":") || "software architect";
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      what,
      results_per_page: "50",
      content_type: "application/json",
    });
    const data = await getJson<{ results?: AdzunaJob[] }>(
      `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`,
    );
    const jobs = (data.results ?? []).map((j): RawJob => ({
      externalId: j.id,
      companyName: j.company?.display_name ?? "Unknown",
      title: j.title.trim(),
      url: j.redirect_url,
      applyUrl: j.redirect_url,
      locationRaw: j.location?.display_name ?? null,
      remote: null,
      employmentType: j.contract_time ?? null,
      descriptionHtml: null,
      descriptionText: firstNonEmpty(j.description),
      postedAt: j.created ?? null,
      compMin: j.salary_min ? Math.round(j.salary_min) : null,
      compMax: j.salary_max ? Math.round(j.salary_max) : null,
      compCurrency: null,
      compPeriod: "year",
      raw: j,
    }));
    // Page 1 of a search: 50 results out of however many match.
    return { jobs, warnings: [], completeness: "partial" };
  },
};
