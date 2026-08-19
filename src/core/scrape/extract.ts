/**
 * Stage two: turn a captured page into a readable job description.
 *
 * Pure — takes HTML, returns fields. No network, no database, no clock. That is
 * what makes it safe to improve: a better heuristic here reprocesses the whole
 * corpus offline, and it can be tested exhaustively without a fixture server.
 */

export type ExtractedPage = {
  text: string | null;
  title: string | null;
  /** Employment type, seniority, salary line, location — whatever was found. */
  fields: Record<string, string>;
  /** Bullet points, which is where requirements almost always live. */
  requirements: string[];
};

const STRIP_TAGS = /<(script|style|noscript|svg|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Containers a job description tends to live in, most specific first. */
const CONTENT_HINTS = [
  /<[^>]+class="[^"]*(job[-_]?description|posting[-_]?content|description__text|job[-_]?details)[^"]*"[^>]*>/i,
  /<[^>]+id="[^"]*(job[-_]?description|jobDescription|content)[^"]*"[^>]*>/i,
  /<article\b[^>]*>/i,
  /<main\b[^>]*>/i,
];

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
    ldquo: "“", rdquo: "”", eacute: "é", uacute: "ú", ccedil: "ç",
  };
  return text
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(STRIP_TAGS, " ")
      // Block-level boundaries become newlines so structure survives.
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Narrows to the part of the page that is the posting.
 *
 * A careers page is mostly navigation, cookie banners and footer. Feeding all
 * of it to the scorer would dilute every keyword frequency and let a site's
 * boilerplate outrank the job itself.
 */
export function mainContent(html: string): string {
  for (const hint of CONTENT_HINTS) {
    const match = hint.exec(html);
    if (!match) continue;
    const slice = html.slice(match.index);
    const text = stripHtml(slice);
    // Only trust the container if it actually holds a description's worth.
    if (text.length > 400) return slice;
  }
  return html;
}

export function extractTitle(html: string): string | null {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1?.[1]) {
    const text = stripHtml(h1[1]).trim();
    if (text.length > 2 && text.length < 200) return text;
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title?.[1]) {
    // Titles are usually "Role — Company | Board"; the first segment is ours.
    const text = decodeEntities(title[1]).split(/\s+[|–—]\s+/)[0]!.trim();
    if (text.length > 2) return text;
  }
  return null;
}

const FIELD_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "employmentType", re: /\b(full[- ]time|part[- ]time|contract|freelance|internship|temporary|c2c|w2)\b/i },
  { key: "workplace", re: /\b(fully remote|remote[- ]first|remote|hybrid|on[- ]site|onsite)\b/i },
  { key: "seniority", re: /\b(intern|junior|mid[- ]level|senior|staff|principal|lead|director|head of)\b/i },
  { key: "salary", re: /(?:[$€£R]\$?\s?\d[\d.,]*\s*(?:k|mil)?\s*(?:-|–|to|até)\s*[$€£R]?\$?\s?\d[\d.,]*\s*(?:k|mil)?(?:\s*(?:\/|per\s+)?(?:year|yr|annum|ano|month|mês|hour|hr|hora))?)/i },
  { key: "visa", re: /\b(visa sponsorship|work authorization|authorized to work|no sponsorship)\b/i },
];

export function extractFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const { key, re } of FIELD_PATTERNS) {
    const match = re.exec(text);
    if (match) fields[key] = match[0].trim();
  }
  return fields;
}

/**
 * Navigation, not requirements.
 *
 * Every careers page wraps its menu, footer and cookie banner in `<li>`, so a
 * naive bullet scrape returns sixty items of which forty are "Home", "Careers"
 * and "Privacy Policy". Length is the cheapest discriminator that works: a real
 * requirement is a sentence, a menu item is a word or two.
 */
const NAV_NOISE =
  /^(home|jobs?|careers?|about|contact|blog|login|sign in|sign up|privacy|terms|cookies?|menu|search|all|apply|share|next|previous|back|português|english|español)\b/i;

/** Bullets a human would recognise as part of the posting. */
export function cleanBullets(lines: string[], max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    // A requirement is a sentence; 25 characters is where menu items stop and
    // sentences start, measured against this corpus.
    if (line.length < 25 || line.length > 400) continue;
    if (NAV_NOISE.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/** Bullet lines, which is where requirements almost always live. */
export function extractRequirements(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-•*·]\s*/, "").trim())
    .filter((line) => line.length > 12 && line.length < 400)
    .filter((line) => /^[-•*·]/.test(line) === false)
    .slice(0, 60);
}

export function extractPage(html: string): ExtractedPage {
  const scoped = mainContent(html);
  const text = stripHtml(scoped);
  const usable = text.length >= 200 ? text : null;

  const bullets = cleanBullets(
    scoped
      .split(/<li\b[^>]*>/i)
      .slice(1)
      .map((chunk) => stripHtml(chunk.split(/<\/li>/i)[0] ?? "").trim()),
  );

  return {
    text: usable,
    title: extractTitle(html),
    fields: usable ? extractFields(usable) : {},
    requirements: bullets,
  };
}
