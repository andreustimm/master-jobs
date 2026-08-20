/**
 * Adapters for free remote-job aggregators.
 *
 * These widen the funnel beyond companies you already know about. They are
 * noisier than ATS boards, so the scorer does the filtering — not the fetcher.
 * Field shapes verified against live responses.
 */
import { firstNonEmpty, getJson, htmlToText } from "./http.ts";
import type { RawJob, SourceAdapter, SourceConfig, FetchResult } from "./types.ts";

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
};

/** Aggregators are inconsistent: a field is sometimes a string, sometimes a list. */
function toList(value: unknown): string[] {
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

export const himalayas: SourceAdapter = {
  kind: "himalayas",
  docs: "https://himalayas.app/api",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
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

    const jobs = collected.map((j): RawJob => ({
      externalId: j.guid,
      companyName: j.companyName,
      title: j.title.trim(),
      url: j.applicationLink ?? `https://himalayas.app/companies/${j.companySlug ?? ""}`,
      applyUrl: j.applicationLink ?? null,
      locationRaw: toList(j.locationRestrictions).join(", ") || "Remote",
      remote: true,
      employmentType: j.employmentType ?? null,
      seniorityRaw: Array.isArray(j.seniority) ? j.seniority.join(", ") : (j.seniority ?? null),
      descriptionHtml: j.description ?? null,
      descriptionText: firstNonEmpty(htmlToText(j.description), j.excerpt),
      postedAt: toIso(j.pubDate),
      compMin: j.minSalary ?? null,
      compMax: j.maxSalary ?? null,
      compCurrency: j.currency ?? null,
      compPeriod: j.salaryPeriod ?? null,
      raw: j,
    })) as RawJob[];
    return { jobs, warnings };
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

export const remotive: SourceAdapter = {
  kind: "remotive",
  docs: "https://remotive.com/api/remote-jobs",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
    const params = new URLSearchParams({ limit: "50" });
    if (config.handle) params.set("search", config.handle);
    const data = await getJson<{ jobs?: RemotiveJob[] }>(
      `https://remotive.com/api/remote-jobs?${params}`,
    );
    const jobs = (data.jobs ?? []).map((j): RawJob => ({
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
      raw: j,
    }));
    return { jobs, warnings: [] };
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
  docs: "https://www.arbeitnow.com/blog/job-board-api",
  async fetchJobs(_config: SourceConfig): Promise<FetchResult> {
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
    return { jobs, warnings: [] };
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

export const remoteok: SourceAdapter = {
  kind: "remoteok",
  docs: "https://remoteok.com/api",
  async fetchJobs(_config: SourceConfig): Promise<FetchResult> {
    const data = await getJson<RemoteOkJob[]>("https://remoteok.com/api");
    // The first element of the array is a legal notice, not a job.
    const jobs = (data ?? [])
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
        raw: j,
      }));
    return { jobs, warnings: [] };
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
  docs: "https://developer.adzuna.com/",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    if (!appId || !appKey) {
      return { jobs: [], warnings: ["adzuna skipped: ADZUNA_APP_ID/ADZUNA_APP_KEY not set"] };
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
    return { jobs, warnings: [] };
  },
};
