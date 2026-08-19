/**
 * A company's own careers page as a source (E-04).
 *
 * This is the adapter that exists because of a number: 73,6% of the corpus
 * comes from one aggregator that hides the employer by design. An anonymous
 * posting breaks referral matching, breaks cross-source dedupe, and makes the
 * research that gives a cover letter any weight impossible. The sourcing metric
 * this project cares about is not "how many jobs" — it is **how many jobs with
 * a named employer**, and a careers page is by definition named.
 *
 * It fits the existing port: fetch, map, return. What is different is that the
 * page is HTML rather than JSON, so it reuses the scraper's extractor instead
 * of parsing a documented schema.
 *
 * The boundary, inherited from ADR 0001 and restated in ADR 0009: `robots.txt`
 * is obeyed. A page the site declines to serve is skipped with a warning, never
 * fetched anyway. Absence of a prohibition is not permission — but a company's
 * own careers page, publicly linked and not disallowed, is exactly the case
 * that is uncontroversial.
 */
import { getText } from "./http.ts";
import { mayFetch } from "../scrape/robots.ts";
import { cleanBullets, extractFields, stripHtml } from "../scrape/extract.ts";
import type { FetchResult, RawJob, SourceAdapter, SourceConfig } from "./types.ts";

/**
 * Anchors that look like a posting.
 *
 * Matching on the URL rather than on class names because every site names its
 * markup differently, and a selector for a page we cannot open would be a guess
 * that rots on the next deploy. A job URL, by contrast, almost always says so.
 */
const JOB_PATH = /\/(jobs?|careers?|positions?|openings?|vagas?|opportunit(?:y|ies))\/[\w-]{2,}/i;

/** Anchor text that is navigation, not a role. */
const NOT_A_ROLE =
  /^(all|view all|see all|apply|learn more|back|next|previous|home|careers?|jobs?|search|filter|open roles?)$/i;

type Anchor = { href: string; text: string; location: string | null };

/** Call-to-action text that rides along inside the anchor. */
const CTA = /\b(read more|saiba mais|ver vaga|apply now|view (?:role|job|position)|learn more)\b/gi;

/**
 * Splits an anchor's text into a title and whatever followed it.
 *
 * A careers-page link is rarely just the role: it usually wraps the title, the
 * office list and a "Read more" in one element. Taking the raw text as the
 * title produces "Account Executive, Commercial London Read more", which then
 * fails to match any target cluster and scores the job at zero for a formatting
 * reason rather than a substantive one.
 *
 * `stripHtml` already turns block boundaries into newlines, so the first line
 * is the title far more reliably than any heuristic over a flattened string.
 */
export function splitAnchorText(raw: string): { title: string; location: string | null } {
  const lines = raw
    .split("\n")
    .map((line) => line.replace(CTA, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const title = lines[0] ?? "";
  const rest = lines.slice(1).join(" · ").trim();
  return { title, location: rest.length > 0 && rest.length < 120 ? rest : null };
}

export function findJobAnchors(html: string, baseUrl: string): Anchor[] {
  const anchors: Anchor[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const rawHref = match[1]!;
    // Newlines are preserved here on purpose — `splitAnchorText` needs them.
    const { title, location } = splitAnchorText(stripHtml(match[2] ?? ""));

    if (title.length < 3 || title.length > 160) continue;
    if (NOT_A_ROLE.test(title)) continue;

    let url: URL;
    try {
      url = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (!JOB_PATH.test(url.pathname)) continue;

    const href = url.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    anchors.push({ href, text: title, location });
  }

  return anchors;
}

/** Stable id from the URL path, so re-syncing the same page dedupes. */
export function externalIdFor(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).slice(-2).join("-");
  } catch {
    return url;
  }
}

export type CareersOptions = {
  /** Cap on postings fetched per company, so one big board cannot dominate. */
  maxJobs?: number;
  /** Skip the per-posting fetch; titles only. Much faster, much weaker. */
  listOnly?: boolean;
};

/**
 * `handle` is the careers page URL, and `label` is the employer's name.
 *
 * The name comes from configuration rather than from the page because it is the
 * whole point of this adapter: guessing it from a `<title>` would reintroduce
 * exactly the ambiguity the adapter exists to remove.
 */
export function careersAdapter(options: CareersOptions = {}): SourceAdapter {
  const maxJobs = options.maxJobs ?? 40;

  return {
    kind: "careers",
    docs: "https://developers.google.com/search/docs/crawling-indexing/robots/intro",

    async fetchJobs(config: SourceConfig): Promise<FetchResult> {
      const warnings: string[] = [];
      const listUrl = config.handle;

      if (!(await mayFetch(listUrl))) {
        return { jobs: [], warnings: [`robots.txt não permite ${listUrl}`] };
      }

      const listHtml = await getText(listUrl);
      if (!listHtml) return { jobs: [], warnings: [`Sem resposta de ${listUrl}`] };

      const anchors = findJobAnchors(listHtml, listUrl).slice(0, maxJobs);
      if (anchors.length === 0) {
        warnings.push(
          `Nenhum link de vaga reconhecido em ${listUrl}. ` +
            `A página pode montar a lista por JavaScript — nesse caso use \`jho sources snippet\`.`,
        );
        return { jobs: [], warnings };
      }

      const jobs: RawJob[] = [];

      for (const anchor of anchors) {
        const base: RawJob = {
          externalId: externalIdFor(anchor.href),
          companyName: config.label,
          title: anchor.text,
          locationRaw: anchor.location,
          url: anchor.href,
          raw: { source: "careers", listUrl },
        };

        if (options.listOnly) {
          jobs.push(base);
          continue;
        }

        if (!(await mayFetch(anchor.href))) {
          warnings.push(`robots.txt não permite ${anchor.href}`);
          jobs.push(base);
          continue;
        }

        const detail = await getText(anchor.href);
        if (!detail) {
          // The listing entry is still worth keeping; it just scores weaker.
          jobs.push(base);
          continue;
        }

        const text = stripHtml(detail);
        const fields = extractFields(text);
        const bullets = cleanBullets(
          detail
            .split(/<li\b[^>]*>/i)
            .slice(1)
            .map((chunk) => stripHtml(chunk.split(/<\/li>/i)[0] ?? "").trim()),
        );

        jobs.push({
          ...base,
          descriptionHtml: detail,
          descriptionText: text.length >= 200 ? text : null,
          employmentType: fields.employmentType ?? null,
          seniorityRaw: fields.seniority ?? null,
          remote: fields.workplace ? /remote/i.test(fields.workplace) : null,
          raw: { source: "careers", listUrl, fields, requirements: bullets },
        });
      }

      return { jobs, warnings };
    },
  };
}

export const careers = careersAdapter();
