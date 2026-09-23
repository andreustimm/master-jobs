/**
 * Workable's public job search (jobs.workable.com): every company on the ATS,
 * searchable by text, with the country and the workplace structured per job.
 *
 * The API is undocumented; the shape here is the live response. robots.txt
 * disallows the HTML search pages (`/search*?*`), not `/api/`, and the terms of
 * service carry no scraping clause. The per-company widget exists too, but it
 * lists titles without a description — the SmartRecruiters trap — so both the
 * feed and the term search use the global search.
 */
import { BUDGETED, QUOTA_STOP } from "./aggregators.ts";
import { getJson, htmlToText } from "./http.ts";
import type { PlatformBudget, RawJob, SourceAdapter, SourceConfig, SourceSnapshot } from "./types.ts";

type WorkableJob = {
  id: string;
  title: string;
  description?: string;
  requirementsSection?: string;
  benefitsSection?: string;
  employmentType?: string;
  url: string;
  location?: { city?: string | null; subregion?: string | null; countryName?: string | null };
  created?: string;
  company?: { title?: string };
  /** `remote`, `hybrid` or `on_site`. */
  workplace?: string;
};

type WorkableResponse = { totalSize?: number; nextPageToken?: string; jobs?: WorkableJob[] };

const WORKABLE_API = "https://jobs.workable.com/api/v1/jobs";

/** Fixed server-side. */
const WORKABLE_PAGE = 20;

/** Undocumented API: a slow, bounded pace is the polite reading. */
const WORKABLE_BUDGET: PlatformBudget = { perMinute: 10, pageSize: WORKABLE_PAGE, maxRequestsPerRun: 5 };

/**
 * Remote jobs whose location is Brazil. The same posting is listed once per
 * country it hires in, so filtering by the candidate's country is also what
 * keeps the copies out.
 */
const REACH = { location: "Brazil", workplace: "remote" } as const;

function mapWorkable(j: WorkableJob): RawJob {
  const place = [j.location?.city, j.location?.subregion, j.location?.countryName]
    .map((part) => part?.trim())
    .filter(Boolean);
  const text = [j.description, j.requirementsSection, j.benefitsSection]
    .map((section) => htmlToText(section))
    .filter((section): section is string => section !== null)
    .join("\n\n");
  return {
    externalId: j.id,
    companyName: j.company?.title?.trim() || "Workable",
    title: j.title.trim(),
    url: j.url,
    applyUrl: j.url,
    locationRaw: place.join(", ") || null,
    remote: j.workplace === "remote" ? true : j.workplace ? false : null,
    employmentType: j.employmentType ?? null,
    descriptionHtml: j.description ?? null,
    descriptionText: text || null,
    postedAt: j.created ?? null,
    raw: j,
  };
}

async function searchPages(
  query: string,
  pages: number,
  reserve: () => Promise<boolean>,
): Promise<{ jobs: WorkableJob[]; totalHint: number | null; stoppedByQuota: boolean; reachedEnd: boolean }> {
  const jobs: WorkableJob[] = [];
  let totalHint: number | null = null;
  let token: string | undefined;
  for (let page = 0; page < pages; page++) {
    if (!(await reserve())) return { jobs, totalHint, stoppedByQuota: true, reachedEnd: false };
    const params = new URLSearchParams({ ...REACH, ...(query ? { query } : {}), ...(token ? { pageToken: token } : {}) });
    const data = await getJson<WorkableResponse>(`${WORKABLE_API}?${params}`, BUDGETED);
    totalHint = data.totalSize ?? totalHint;
    jobs.push(...(data.jobs ?? []));
    token = data.nextPageToken;
    // No next token is the platform saying the list ended. An empty page with
    // a token still pending is not.
    if (!token) return { jobs, totalHint, stoppedByQuota: false, reachedEnd: true };
    if ((data.jobs ?? []).length === 0) break;
  }
  return { jobs, totalHint, stoppedByQuota: false, reachedEnd: false };
}

export const workable: SourceAdapter = {
  kind: "workable",
  docs: "https://jobs.workable.com",
  async fetchJobs(config: SourceConfig): Promise<SourceSnapshot> {
    // `handle` is the search text; empty lists every remote job in Brazil.
    const found = await searchPages(config.handle.trim(), WORKABLE_BUDGET.maxRequestsPerRun, async () => true);
    const warnings =
      found.totalHint !== null && found.jobs.length < found.totalHint
        ? [`workable: ${found.jobs.length} de ${found.totalHint} vagas (as primeiras páginas).`]
        : [];
    return {
      jobs: found.jobs.map(mapWorkable),
      warnings,
      completeness: found.reachedEnd ? "complete" : "partial",
    };
  },
  termSearch: {
    budget: WORKABLE_BUDGET,
    // `jho sources probe workable --term typescript` returned 52 of about 52 on
    // 2026-09-19, paging with `pageToken`.
    validatedOn: "2026-09-19",
    async search(query, opts) {
      const pages = Math.min(WORKABLE_BUDGET.maxRequestsPerRun, Math.ceil(opts.limit / WORKABLE_PAGE));
      const found = await searchPages(query, pages, opts.reserve);
      if (found.stoppedByQuota && found.jobs.length === 0) return QUOTA_STOP;
      return {
        jobs: found.jobs.slice(0, opts.limit).map(mapWorkable),
        warnings: [],
        totalHint: found.totalHint,
        stoppedByQuota: found.stoppedByQuota,
      };
    },
  },
};
