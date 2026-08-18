/**
 * Extracting openings from a job-alert email.
 *
 * This is the piece ADR 0008 unlocks: LinkedIn *sends* these, so reading them
 * closes the coverage gap ADR 0001 accepted, without touching the platform.
 *
 * Two constraints shape the implementation:
 *
 * 1. **Email templates change without notice.** A parser that silently returns
 *    zero when LinkedIn reshuffles its markup is worse than one that fails —
 *    the user would just see "no new jobs" forever. So extraction reports what
 *    it found *and* what it could not resolve, and the caller surfaces both.
 *
 * 2. **Per Trava 2 of ADR 0008, the URL is a signal, never a target.** We keep
 *    the link so a human can open it. Nothing in this codebase may follow it
 *    automatically — resolution belongs to the public ATS sources.
 */
import { htmlToText } from "../sources/http.ts";
import type { RawJob } from "../sources/types.ts";

export type ExtractedAlertJob = {
  title: string;
  companyName: string | null;
  location: string | null;
  url: string;
  externalId: string | null;
};

export type AlertExtraction = {
  jobs: ExtractedAlertJob[];
  /** Links that looked like jobs but yielded no title. */
  unresolved: number;
  warnings: string[];
};

/** LinkedIn routes alert links through /comm/ and appends tracking. */
const LINKEDIN_JOB_URL =
  /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/comm\/jobs\/view\/(\d+)|https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/jobs\/view\/(\d+)/gi;

/** Strip tracking so the same posting dedupes across two alert emails. */
export function canonicalJobUrl(url: string): string {
  const id = /\/jobs\/view\/(\d+)/.exec(url)?.[1];
  return id ? `https://www.linkedin.com/jobs/view/${id}` : url.split("?")[0] ?? url;
}

function stripTags(html: string): string {
  return (htmlToText(html) ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Pull the anchor text and the lines that follow it.
 *
 * LinkedIn's layout is consistently: job title inside the anchor, then company
 * and location as sibling text before the next anchor. Rather than depend on
 * class names — which change constantly — we take the slice of markup between
 * this job link and the next one, and read it as text.
 */
function extractFromHtml(html: string): AlertExtraction {
  const warnings: string[] = [];
  const jobs: ExtractedAlertJob[] = [];
  let unresolved = 0;

  const matches = [...html.matchAll(LINKEDIN_JOB_URL)];
  if (matches.length === 0) {
    return { jobs: [], unresolved: 0, warnings: ["Nenhum link de vaga do LinkedIn encontrado."] };
  }

  const seen = new Set<string>();

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const id = match[1] ?? match[2] ?? null;
    const url = canonicalJobUrl(match[0]);
    if (seen.has(url)) continue;
    seen.add(url);

    // The URL sits INSIDE the href attribute, so slicing from its index would
    // cut off the opening <a and lose the anchor text entirely. Walk back to
    // the tag that owns it.
    const urlIndex = match.index ?? 0;
    const tagStart = html.lastIndexOf("<a", urlIndex);
    const start = tagStart >= 0 && urlIndex - tagStart < 600 ? tagStart : urlIndex;

    const nextUrlIndex = matches[i + 1]?.index;
    const nextTagStart =
      nextUrlIndex !== undefined ? html.lastIndexOf("<a", nextUrlIndex) : -1;
    const next =
      nextTagStart > start
        ? nextTagStart
        : (nextUrlIndex ?? Math.min(html.length, start + 4000));

    const block = html.slice(start, next);

    // The anchor's own text is the title.
    const anchorText = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(block)?.[1];
    const title = anchorText ? stripTags(anchorText) : "";

    if (!title || title.length < 3 || /^(view|apply|see|ver|aplicar)/i.test(title)) {
      unresolved++;
      continue;
    }

    // What follows the anchor is "Company · Location" in some arrangement.
    const after = stripTags(block.replace(/<a\b[^>]*>[\s\S]*?<\/a>/i, " "));
    const parts = after
      .split(/[·•|]|\s{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 1 && !/^\d+ (hours?|days?|weeks?) ago$/i.test(p));

    jobs.push({
      title,
      companyName: parts[0] ?? null,
      location: parts[1] ?? null,
      url,
      externalId: id,
    });
  }

  if (unresolved > 0) {
    warnings.push(
      `${unresolved} link(s) de vaga sem título legível — o template do e-mail pode ter mudado.`,
    );
  }

  return { jobs, unresolved, warnings };
}

/** Plain-text fallback, for alerts delivered without an HTML part. */
function extractFromText(text: string): AlertExtraction {
  const jobs: ExtractedAlertJob[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = LINKEDIN_JOB_URL.exec(lines[i] ?? "");
    LINKEDIN_JOB_URL.lastIndex = 0;
    if (!match) continue;

    const url = canonicalJobUrl(match[0]);
    if (seen.has(url)) continue;
    seen.add(url);

    // In the text template the title sits on the line above the link.
    const title = (lines[i - 1] ?? "").trim();
    const company = (lines[i - 2] ?? "").trim();
    if (!title) continue;

    jobs.push({
      title,
      companyName: company || null,
      location: null,
      url,
      externalId: match[1] ?? match[2] ?? null,
    });
  }

  return {
    jobs,
    unresolved: 0,
    warnings: jobs.length === 0 ? ["Nenhuma vaga extraída da versão texto."] : [],
  };
}

export function extractAlertJobs(html: string | null, text: string | null): AlertExtraction {
  if (html) {
    const fromHtml = extractFromHtml(html);
    if (fromHtml.jobs.length > 0) return fromHtml;
    // HTML present but unreadable is worth saying out loud.
    if (text) {
      const fromText = extractFromText(text);
      if (fromText.jobs.length > 0) {
        return {
          ...fromText,
          warnings: [...fromHtml.warnings, "Recuperado da versão texto.", ...fromText.warnings],
        };
      }
    }
    return fromHtml;
  }
  if (text) return extractFromText(text);
  return { jobs: [], unresolved: 0, warnings: ["E-mail sem corpo legível."] };
}

/**
 * Turn extracted openings into RawJobs.
 *
 * These deliberately carry no description: the alert only has a title line.
 * The scorer will therefore rank them low on keywords, which is correct — an
 * alert is a *pointer*. Resolution to the full posting happens through the
 * public ATS sources, per Trava 2.
 */
export function toRawJobs(extraction: AlertExtraction, receivedAt: string | null): RawJob[] {
  return extraction.jobs.map((j) => ({
    externalId: j.externalId ?? j.url,
    companyName: j.companyName ?? "Desconhecida",
    title: j.title,
    url: j.url,
    applyUrl: j.url,
    locationRaw: j.location,
    remote: null,
    descriptionHtml: null,
    descriptionText: null,
    postedAt: receivedAt,
    raw: { source: "linkedin_job_alert", ...j },
  }));
}
