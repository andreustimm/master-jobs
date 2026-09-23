/**
 * Jobicy: remote jobs with a documented, keyless API (jobi.cy/apidocs).
 *
 * Its README asks for three things, and the adapter keeps all of them: credit
 * Jobicy with a link to the source, send every application to the original job
 * URL from the feed, and poll no more often than once an hour.
 */
import { BUDGETED, cleanTags, QUOTA_STOP, toList, withRestriction } from "./aggregators.ts";
import { getJson, htmlToText } from "./http.ts";
import type { PlatformBudget, RawJob, SourceAdapter, SourceConfig, SourceSnapshot } from "./types.ts";

type JobicyJob = {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobIndustry?: unknown;
  jobType?: unknown;
  /** "Geographic employment restriction, or `Anywhere` when not restricted." */
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  // Absent — not null — when the posting discloses no pay.
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
};

type JobicyResponse = { jobCount?: number; jobs?: JobicyJob[] };

const JOBICY_API = "https://jobicy.com/api/v2/remote-jobs";

/**
 * "Do not schedule automated polling more frequently than once per hour." The
 * ledger has no hour window, so the day total is capped at what hourly polling
 * would spend, and the minute window spaces a term run's calls apart.
 */
const JOBICY_BUDGET: PlatformBudget = { perDay: 24, perMinute: 1, pageSize: 100, maxRequestsPerRun: 1 };

/** The candidate's reach: `latam` also returns every posting open to "Anywhere". */
const JOBICY_DEFAULT_GEO = "latam";

/** "Brazil,  Canada,  USA" — the API pads the separators. */
function geoList(geo: string | undefined): string[] {
  return (geo ?? "").split(",").map((region) => region.trim()).filter(Boolean);
}

function mapJobicy(j: JobicyJob): RawJob {
  const regions = geoList(j.jobGeo);
  const anywhere = regions.length === 0 || regions.some((region) => /^anywhere$/i.test(region));
  const text = htmlToText(j.jobDescription) ?? j.jobExcerpt ?? null;
  return {
    externalId: String(j.id),
    companyName: j.companyName,
    title: j.jobTitle.trim(),
    url: j.url,
    // The README's condition of use: applications go to the feed's own URL.
    applyUrl: j.url,
    locationRaw: regions.join(", ") || "Anywhere",
    remote: true,
    employmentType: toList(j.jobType).join(", ") || null,
    seniorityRaw: j.jobLevel ?? null,
    descriptionHtml: j.jobDescription ?? null,
    // `jobGeo` is who may apply, the same fact as Himalayas' restrictions.
    descriptionText: anywhere ? text : withRestriction(text, regions),
    postedAt: j.pubDate ?? null,
    compMin: j.salaryMin ?? null,
    compMax: j.salaryMax ?? null,
    compCurrency: j.salaryCurrency ?? null,
    compPeriod: j.salaryPeriod ?? null,
    tags: cleanTags(toList(j.jobIndustry)),
    raw: j,
  };
}

function jobicyUrl(params: Record<string, string>): string {
  return `${JOBICY_API}?${new URLSearchParams(params)}`;
}

export const jobicy: SourceAdapter = {
  kind: "jobicy",
  docs: "https://jobi.cy/apidocs",
  async fetchJobs(config: SourceConfig): Promise<SourceSnapshot> {
    // `handle` is the geography slug; empty means the candidate's default.
    const geo = config.handle.trim() || JOBICY_DEFAULT_GEO;
    const data = await getJson<JobicyResponse>(jobicyUrl({ count: "100", geo }), BUDGETED);
    // `count=100`: the newest hundred for the region, not every open posting.
    return { jobs: (data.jobs ?? []).map(mapJobicy), warnings: [], completeness: "partial" };
  },
  termSearch: {
    budget: JOBICY_BUDGET,
    // `jho sources probe jobicy --term laravel` returned 1 of about 1 (LATAM
    // reach) on 2026-09-19; the `latam` feed returned 100.
    validatedOn: "2026-09-19",
    async search(query, opts) {
      // The API accepts a tag of 3–50 characters; outside that it would spend
      // a unit to say no.
      const tag = query.trim();
      if (tag.length < 3 || tag.length > 50) {
        return { jobs: [], warnings: [`jobicy: tag must have 3–50 characters (${tag.length})`], totalHint: 0, stoppedByQuota: false };
      }
      if (!(await opts.reserve())) return QUOTA_STOP;
      const count = String(Math.min(opts.limit, JOBICY_BUDGET.pageSize));
      const data = await getJson<JobicyResponse>(jobicyUrl({ count, geo: JOBICY_DEFAULT_GEO, tag }), BUDGETED);
      const jobs = (data.jobs ?? []).map(mapJobicy);
      return { jobs, warnings: [], totalHint: data.jobCount ?? jobs.length, stoppedByQuota: false };
    },
  },
};
