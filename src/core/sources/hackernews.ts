/**
 * Hacker News "Ask HN: Who is hiring?" through the official Algolia API.
 *
 * Each top-level comment of the monthly thread is one posting written by the
 * team itself, and the thread's convention puts it on the first line:
 * "Company | Role | Location | …". Replies, job seekers posting in the wrong
 * thread ("Location: London…") and postings in prose do not follow it; the
 * adapter keeps only first lines with at least three pipe-separated parts,
 * which drops the prose ones too — a known, accepted loss.
 */
import { BUDGETED, QUOTA_STOP } from "./aggregators.ts";
import { getJson, htmlToText } from "./http.ts";
import type { FetchResult, PlatformBudget, RawJob, SourceAdapter } from "./types.ts";

type HnHit = {
  objectID: string;
  title?: string | null;
  comment_text?: string | null;
  created_at?: string;
  parent_id?: number | null;
};

type HnSearch = { hits?: HnHit[]; nbHits?: number };

const HN_API = "https://hn.algolia.com/api/v1";

/** Algolia's own ceiling per request; a month's thread is ~400 comments. */
const THREAD_PAGE = 1000;

/** Two calls per run: find the month's thread, then read or search it. */
const HN_BUDGET: PlatformBudget = { perMinute: 30, pageSize: 100, maxRequestsPerRun: 2 };

const ROLE = /engineer|developer|architect|\blead\b|manager|scientist|designer|\bcto\b|\bhead of\b|devops|\bsre\b|programmer|analyst|researcher|founding/i;
const PLACE =
  /remote|on-?site|hybrid|in[- ]office|worldwide|anywhere|global|\b(us|usa|uk|eu|emea|latam|apac|americas|europe|canada|brazil)\b|,\s*[A-Z]{2}\b/i;

/**
 * HN separates paragraphs with a bare `<p>` and escapes `/` and `'` as hex
 * entities, which the shared `htmlToText` leaves alone. Decoding happens after
 * the tags are gone, so an escaped `<` never turns into markup.
 */
function hnText(html: string | null | undefined): string | null {
  const text = htmlToText(html?.replace(/<p>/gi, "\n\n"));
  return text
    ?.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&quot;/g, '"') ?? null;
}

/** One posting from a top-level comment, or null when it is not one. */
export function parseHiringPost(hit: HnHit): RawJob | null {
  const text = hnText(hit.comment_text);
  if (!text) return null;
  const firstLine = text.split("\n")[0]!.trim();
  const parts = firstLine.split(/\s+\|\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  // "Pango (YC S26)": the batch is not part of the name the company is known by.
  const companyName = parts[0]!.replace(/\s*\([^)]*\)/g, "").trim();
  const rest = parts.slice(1);
  const role = rest.find((part) => ROLE.test(part)) ?? rest[0]!;
  const place = rest.filter((part) => part !== role && PLACE.test(part) && !/https?:\/\//.test(part));
  if (!companyName) return null;
  return {
    externalId: hit.objectID,
    companyName,
    title: role.slice(0, 200),
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    applyUrl: null,
    // Missing is neutral (rule 8): no location part means unknown, not on-site.
    locationRaw: place.join(" | ") || null,
    // "Full-Stack Engineer (full-time, REMOTE)": the signal can sit in the role.
    remote: /remote/i.test(firstLine) ? true : null,
    descriptionText: text,
    postedAt: hit.created_at ?? null,
    raw: { objectID: hit.objectID, created_at: hit.created_at },
  };
}

/** The newest "Who is hiring?" thread (the bot also posts "Who wants to be hired?"). */
async function currentThread(): Promise<string | null> {
  const data = await getJson<HnSearch>(
    `${HN_API}/search_by_date?${new URLSearchParams({ tags: "story,author_whoishiring", hitsPerPage: "10" })}`,
    BUDGETED,
  );
  return (data.hits ?? []).find((hit) => /^Ask HN: Who is hiring\?/i.test(hit.title ?? ""))?.objectID ?? null;
}

/** Top-level comments only: a reply's parent is another comment, not the thread. */
function postings(hits: HnHit[] | undefined, thread: string): RawJob[] {
  return (hits ?? [])
    .filter((hit) => String(hit.parent_id) === thread)
    .map(parseHiringPost)
    .filter((job): job is RawJob => job !== null);
}

export const hackernews: SourceAdapter = {
  kind: "hackernews",
  docs: "https://hn.algolia.com/api",
  async fetchJobs(): Promise<FetchResult> {
    const thread = await currentThread();
    if (!thread) return { jobs: [], warnings: ["hackernews: no \"Who is hiring?\" thread found"] };
    const params = new URLSearchParams({ tags: `comment,story_${thread}`, hitsPerPage: String(THREAD_PAGE) });
    const data = await getJson<HnSearch>(`${HN_API}/search?${params}`, BUDGETED);
    return { jobs: postings(data.hits, thread), warnings: [] };
  },
  termSearch: {
    budget: HN_BUDGET,
    // `jho sources probe hackernews --term laravel` returned 1 posting from the
    // September 2026 thread on 2026-09-19; the feed parsed 235 of 261.
    validatedOn: "2026-09-19",
    async search(query, opts) {
      if (!(await opts.reserve())) return QUOTA_STOP;
      const thread = await currentThread();
      if (!thread) return { jobs: [], warnings: [], totalHint: 0, stoppedByQuota: false };
      if (!(await opts.reserve())) return QUOTA_STOP;
      const params = new URLSearchParams({
        tags: `comment,story_${thread}`,
        query,
        hitsPerPage: String(Math.min(opts.limit, HN_BUDGET.pageSize)),
      });
      const data = await getJson<HnSearch>(`${HN_API}/search?${params}`, BUDGETED);
      const jobs = postings(data.hits, thread);
      return { jobs, warnings: [], totalHint: jobs.length, stoppedByQuota: false };
    },
  },
};
