/**
 * Adapters for ATS job boards that expose public, unauthenticated JSON.
 *
 * Field shapes below were verified against live responses, not documentation:
 *   Greenhouse  boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 *   Lever       api.lever.co/v0/postings/{company}?mode=json
 *   Ashby       api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
 *   SmartRecr.  api.smartrecruiters.com/v1/companies/{company}/postings
 *   Recruitee   {company}.recruitee.com/api/offers/
 */
import { firstNonEmpty, getJson, htmlToText } from "./http.ts";
import type { RawJob, SourceAdapter, SourceConfig, FetchResult } from "./types.ts";

/* ------------------------------- Greenhouse ------------------------------- */

type GreenhouseJob = {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string } | null;
  company_name?: string;
  content?: string;
  metadata?: unknown;
};

export const greenhouse: SourceAdapter = {
  kind: "greenhouse",
  docs: "https://developers.greenhouse.io/job-board.html",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
    // `content=true` returns the HTML body; without it there is nothing to score.
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(config.handle)}/jobs?content=true`;
    const data = await getJson<{ jobs?: GreenhouseJob[] }>(url);
    const jobs = (data.jobs ?? []).map((j): RawJob => {
      // Greenhouse HTML-escapes the content field, so unescape before stripping.
      const html = j.content
        ? j.content.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
        : null;
      return {
        externalId: String(j.id),
        companyName: j.company_name ?? config.label,
        title: j.title.trim(),
        url: j.absolute_url,
        applyUrl: j.absolute_url,
        locationRaw: j.location?.name ?? null,
        remote: null,
        descriptionHtml: html,
        descriptionText: htmlToText(html),
        postedAt: j.first_published ?? j.updated_at ?? null,
        raw: j,
      };
    });
    return { jobs, warnings: [] };
  },
};

/* ---------------------------------- Lever --------------------------------- */

type LeverJob = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  country?: string;
  descriptionPlain?: string;
  description?: string;
  /** Sections like "Accountabilities" / "Requirements" — where the real
   *  keyword signal lives on aggregator boards such as Jobgether. */
  lists?: Array<{ text?: string; content?: string }>;
  categories?: {
    commitment?: string;
    location?: string;
    team?: string;
    allLocations?: string[];
  };
};

export const lever: SourceAdapter = {
  kind: "lever",
  docs: "https://github.com/lever/postings-api",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(config.handle)}?mode=json`;
    const data = await getJson<LeverJob[]>(url);
    const jobs = (data ?? []).map((j): RawJob => {
      const locations = j.categories?.allLocations ?? [];
      // Lever splits a posting across several fields and leaves the unused ones
      // as EMPTY STRINGS rather than null, so `??` silently keeps "". The body
      // is in `description`, and the requirements — the part that actually
      // carries keyword signal — are in `lists`.
      const sections = (j.lists ?? [])
        .map((l) => [l.text, htmlToText(l.content)].filter(Boolean).join("\n"))
        .filter((s) => s.length > 0)
        .join("\n\n");
      const bodyText = firstNonEmpty(j.descriptionPlain, htmlToText(j.description));
      // `additional` is the board's own boilerplate ("How Jobgether works"),
      // identical on every posting — including it would pollute the keywords.
      const fullText = [bodyText, sections].filter(Boolean).join("\n\n") || null;

      return {
        externalId: j.id,
        companyName: config.label,
        title: j.text.trim(),
        url: j.hostedUrl,
        applyUrl: j.applyUrl ?? j.hostedUrl,
        locationRaw: locations.length ? locations.join(" / ") : (j.categories?.location ?? null),
        remote: j.workplaceType ? j.workplaceType.toLowerCase() === "remote" : null,
        employmentType: j.categories?.commitment ?? null,
        descriptionHtml: j.description ?? null,
        descriptionText: fullText,
        // Lever returns epoch milliseconds.
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        raw: j,
      };
    });
    return { jobs, warnings: [] };
  },
};

/* ---------------------------------- Ashby --------------------------------- */

type AshbyJob = {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  employmentType?: string;
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  jobUrl: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: {
    compensationTierSummary?: string;
    summaryComponents?: Array<{
      compensationType?: string;
      interval?: string;
      currencyCode?: string;
      minValue?: number;
      maxValue?: number;
    }>;
  };
};

export const ashby: SourceAdapter = {
  kind: "ashby",
  docs: "https://developers.ashbyhq.com/reference/job-posting-api",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(config.handle)}?includeCompensation=true`;
    const data = await getJson<{ jobs?: AshbyJob[] }>(url);
    const warnings: string[] = [];

    const jobs = (data.jobs ?? [])
      .filter((j) => j.isListed !== false)
      .map((j): RawJob => {
        // Prefer the salary component; equity rows have no min/max worth scoring.
        const salary = j.compensation?.summaryComponents?.find(
          (c) => c.compensationType === "Salary" || c.minValue != null,
        );
        const secondary = (j.secondaryLocations ?? [])
          .map((s) => s.location)
          .filter((s): s is string => Boolean(s));
        return {
          externalId: j.id,
          companyName: config.label,
          title: j.title.trim(),
          url: j.jobUrl,
          applyUrl: j.applyUrl ?? j.jobUrl,
          locationRaw: [j.location, ...secondary].filter(Boolean).join(" / ") || null,
          remote: j.isRemote ?? (j.workplaceType ? j.workplaceType.toLowerCase() === "remote" : null),
          employmentType: j.employmentType ?? null,
          descriptionHtml: j.descriptionHtml ?? null,
          descriptionText: firstNonEmpty(j.descriptionPlain, htmlToText(j.descriptionHtml)),
          postedAt: j.publishedAt ?? null,
          compMin: salary?.minValue ?? null,
          compMax: salary?.maxValue ?? null,
          compCurrency: salary?.currencyCode ?? null,
          compPeriod: salary?.interval ?? null,
          raw: j,
        };
      });

    if (jobs.length === 0) warnings.push(`ashby:${config.handle} returned no listed jobs`);
    return { jobs, warnings };
  },
};

/* ------------------------------ SmartRecruiters --------------------------- */

type SmartRecruitersPosting = {
  id: string;
  name: string;
  ref?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
  typeOfEmployment?: { label?: string };
  company?: { name?: string };
};

export const smartrecruiters: SourceAdapter = {
  kind: "smartrecruiters",
  docs: "https://developers.smartrecruiters.com/reference/postings-1",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
    const jobs: RawJob[] = [];
    const warnings: string[] = [];
    const limit = 100;

    // The postings endpoint paginates with offset and caps the page at 100.
    for (let offset = 0; offset < 500; offset += limit) {
      const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(config.handle)}/postings?limit=${limit}&offset=${offset}`;
      const page = await getJson<{ content?: SmartRecruitersPosting[]; totalFound?: number }>(url);
      const content = page.content ?? [];
      for (const p of content) {
        const loc = p.location;
        jobs.push({
          externalId: p.id,
          companyName: p.company?.name ?? config.label,
          title: p.name.trim(),
          url: `https://jobs.smartrecruiters.com/${config.handle}/${p.id}`,
          applyUrl: `https://jobs.smartrecruiters.com/${config.handle}/${p.id}`,
          locationRaw: [loc?.city, loc?.region, loc?.country].filter(Boolean).join(", ") || null,
          remote: loc?.remote ?? null,
          employmentType: p.typeOfEmployment?.label ?? null,
          // The list endpoint omits the body; scoring falls back to the title.
          descriptionHtml: null,
          descriptionText: null,
          postedAt: p.releasedDate ?? null,
          raw: p,
        });
      }
      if (content.length < limit) break;
    }

    if (jobs.length > 0) {
      warnings.push(
        `smartrecruiters:${config.handle} list endpoint has no job body; keyword scoring uses titles only`,
      );
    }
    return { jobs, warnings };
  },
};

/* -------------------------------- Recruitee ------------------------------- */

type RecruiteeOffer = {
  id: number;
  title: string;
  slug: string;
  careers_url?: string;
  careers_apply_url?: string;
  location?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  employment_type_code?: string;
  description?: string;
  requirements?: string;
  published_at?: string;
};

export const recruitee: SourceAdapter = {
  kind: "recruitee",
  docs: "https://docs.recruitee.com/reference/offers",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
    const url = `https://${encodeURIComponent(config.handle)}.recruitee.com/api/offers/`;
    const data = await getJson<{ offers?: RecruiteeOffer[] }>(url);
    const jobs = (data.offers ?? []).map((o): RawJob => {
      const html = [o.description, o.requirements].filter(Boolean).join("\n");
      return {
        externalId: String(o.id),
        companyName: config.label,
        title: o.title.trim(),
        url: o.careers_url ?? `https://${config.handle}.recruitee.com/o/${o.slug}`,
        applyUrl: o.careers_apply_url ?? null,
        locationRaw: o.location ?? ([o.city, o.country].filter(Boolean).join(", ") || null),
        remote: o.remote ?? null,
        employmentType: o.employment_type_code ?? null,
        descriptionHtml: html || null,
        descriptionText: htmlToText(html),
        postedAt: o.published_at ?? null,
        raw: o,
      };
    });
    return { jobs, warnings: [] };
  },
};
