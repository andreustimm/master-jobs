/**
 * Braintrust — the one talent marketplace found with a genuinely open API.
 *
 * Why it earns its own file rather than a line in aggregators.ts: it is the only
 * source in this project that publishes ELIGIBILITY AS STRUCTURED DATA.
 * `locations[].country` carries an ISO code, so "can I even take this job from
 * Brazil?" stops being a regex over prose and becomes a field lookup. For a
 * candidate whose hardest constraint is work authorisation, that is the single
 * most valuable thing a source can provide.
 *
 * It also fits the engagement model: budgets are already denominated in USD
 * (`budget_minimum_usd`), `payment_type` is explicit, and most listings are
 * hourly or fixed-price contracts rather than employment.
 *
 * Cost of the integration: the list endpoint carries no description at all, so
 * the body has to be fetched per job. At ~121 open jobs that is acceptable; the
 * adapter paces itself and caps the work.
 *
 * Verified live 2026-08-18: 121 open jobs, no auth, no key.
 */
import { getJson, htmlToText, firstNonEmpty } from "./http.ts";
import type { RawJob, SourceAdapter, SourceConfig, FetchResult } from "./types.ts";

type BraintrustLocation = {
  location?: string;
  custom_location?: string | null;
  location_type?: string;
  /** ISO 3166-1 alpha-2, or null for a custom region like "north_america". */
  country?: string | null;
  state?: string | null;
  city?: string | null;
};

type BraintrustJob = {
  id: number;
  title: string;
  employer?: { name?: string };
  budget_minimum_usd?: string | number | null;
  budget_maximum_usd?: string | number | null;
  payment_type?: string | null;
  contract_type?: string | null;
  job_type?: string | null;
  expected_hours_per_week?: number | null;
  created?: string;
  published_at?: string;
  locations?: BraintrustLocation[];
  timezones?: Array<{ timezone?: string }>;
  main_skills?: Array<{ name?: string }>;
  role?: { name?: string };
  experience_level?: string | null;
  locations_strongly_required?: boolean;
  // detail endpoint only
  description?: string;
  introduction?: string;
  requirements?: string;
};

const BASE = "https://app.usebraintrust.com/api/jobs";
const DEFAULT_MAX = 150;

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Readable location, preserving the custom regions Braintrust uses. */
function describeLocations(locations: BraintrustLocation[] | undefined): string | null {
  if (!locations?.length) return null;
  const parts = locations
    .map((l) => firstNonEmpty(l.location, l.custom_location))
    .filter((s): s is string => Boolean(s));
  return parts.length > 0 ? [...new Set(parts)].join(" / ") : null;
}

/**
 * Turn structured eligibility into a line the scorer's geo component can read.
 *
 * The scorer works on prose, so rather than special-casing this source we emit
 * an explicit sentence. Naming Brazil when it is genuinely listed is what lets
 * a structurally eligible job outrank a vaguely "remote" one.
 */
function eligibilityLine(job: BraintrustJob): string {
  const countries = (job.locations ?? [])
    .map((l) => l.country)
    .filter((c): c is string => Boolean(c));
  const regions = (job.locations ?? [])
    .map((l) => l.custom_location)
    .filter((c): c is string => Boolean(c));

  const bits: string[] = [];
  if (countries.includes("BR")) bits.push("Open to Brazil.");
  if (regions.some((r) => /latam|south_america|worldwide|anywhere/i.test(r))) {
    bits.push("Open to LATAM / worldwide.");
  }
  if (countries.length > 0) bits.push(`Eligible countries: ${[...new Set(countries)].join(", ")}.`);
  if (regions.length > 0) bits.push(`Regions: ${[...new Set(regions)].join(", ")}.`);
  if (job.locations_strongly_required) bits.push("Location is strongly required.");
  // Everything here is a remote marketplace; say so for the geo scorer.
  bits.push("Remote contract via Braintrust.");
  return bits.join(" ");
}

export const braintrust: SourceAdapter = {
  kind: "braintrust",
  docs: "https://app.usebraintrust.com/api/jobs/",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
    const warnings: string[] = [];
    const requested = Number.parseInt(config.handle, 10);
    const max = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_MAX;

    /* ---- 1. page the listing ------------------------------------------ */
    const listed: BraintrustJob[] = [];
    let url: string | null = `${BASE}/?limit=20`;
    let total: number | undefined;

    while (url && listed.length < max) {
      const page: { count?: number; next?: string | null; results?: BraintrustJob[] } =
        await getJson(url);
      total = page.count ?? total;
      listed.push(...(page.results ?? []));
      url = page.next ?? null;
      if (url) await new Promise((r) => setTimeout(r, 120));
    }

    const slice = listed.slice(0, max);
    if (total && total > slice.length) {
      warnings.push(`braintrust: ${slice.length} de ${total} vagas abertas.`);
    }

    /* ---- 2. fetch each body ------------------------------------------- */
    // The list endpoint has no description whatsoever, so without this step
    // every job would score zero on keywords — the exact failure this project
    // already hit once with Lever.
    const jobs: RawJob[] = [];
    let detailFailures = 0;

    for (const summary of slice) {
      let detail: BraintrustJob = summary;
      try {
        detail = { ...summary, ...(await getJson<BraintrustJob>(`${BASE}/${summary.id}/`)) };
      } catch {
        detailFailures++;
      }

      const skills = (detail.main_skills ?? [])
        .map((s) => s.name)
        .filter((s): s is string => Boolean(s));

      const body = [
        htmlToText(detail.introduction),
        htmlToText(detail.description),
        htmlToText(detail.requirements),
        skills.length > 0 ? `Skills: ${skills.join(", ")}.` : null,
        detail.role?.name ? `Role: ${detail.role.name}.` : null,
        detail.experience_level ? `Experience level: ${detail.experience_level}.` : null,
        eligibilityLine(detail),
      ]
        .filter(Boolean)
        .join("\n\n");

      jobs.push({
        externalId: String(detail.id),
        companyName: detail.employer?.name ?? "Braintrust client",
        title: detail.title.trim(),
        url: `https://app.usebraintrust.com/jobs/${detail.id}/`,
        applyUrl: `https://app.usebraintrust.com/jobs/${detail.id}/`,
        locationRaw: describeLocations(detail.locations),
        remote: true,
        employmentType: firstNonEmpty(detail.job_type, detail.contract_type),
        seniorityRaw: detail.experience_level ?? null,
        descriptionHtml: detail.description ?? null,
        descriptionText: body || null,
        postedAt: firstNonEmpty(detail.published_at, detail.created),
        compMin: toNumber(detail.budget_minimum_usd),
        compMax: toNumber(detail.budget_maximum_usd),
        // Budgets are published in USD by the field name itself.
        compCurrency: toNumber(detail.budget_minimum_usd) ? "USD" : null,
        compPeriod: detail.payment_type ?? null,
        raw: detail,
      });

      await new Promise((r) => setTimeout(r, 80));
    }

    if (detailFailures > 0) {
      warnings.push(
        `braintrust: ${detailFailures} vaga(s) sem detalhe — descrição incompleta, score de keywords prejudicado.`,
      );
    }

    return { jobs, warnings };
  },
};
