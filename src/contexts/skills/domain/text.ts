/**
 * Text utilities shared by extraction strategies.
 *
 * Kept apart from the strategies because getting word boundaries wrong is the
 * single most common way a skill extractor becomes useless: "go" matching
 * "going", "R" matching every capital R, "C" matching everything.
 */
import type { MentionContext } from "./types.ts";

/**
 * Word-boundary match that understands the characters real technology names
 * contain — `c#`, `c++`, `node.js`, `ci/cd`.
 */
export function findOccurrences(haystack: string, term: string): number[] {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#]|$)`, "gi");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    out.push(m.index + m[1]!.length);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

/** The line containing an offset, trimmed for display. */
export function lineAt(text: string, offset: number, max = 240): string {
  const start = Math.max(0, text.lastIndexOf("\n", offset) + 1);
  const nl = text.indexOf("\n", offset);
  const end = nl === -1 ? Math.min(text.length, offset + max) : nl;
  return text.slice(start, end).trim().slice(0, max);
}

const SECTION_PATTERNS: Array<{ test: RegExp; context: MentionContext }> = [
  { test: /^#{0,3}\s*\**\s*(key )?(technolog|skills?|stack|core expertise|competenc|tecnolog|compet[êe]nc)/i, context: "skills-section" },
  { test: /^#{0,3}\s*\**\s*(professional )?(experience|employment|hist[óo]ric|experi[êe]ncia)/i, context: "experience" },
  { test: /^#{0,3}\s*\**\s*(summary|profile|about|resumo|perfil)/i, context: "summary" },
  { test: /^#{0,3}\s*\**\s*(education|languages|certification|forma[çc][ãa]o|idiomas)/i, context: "unknown" },
];

/**
 * Map every character offset to the document section it belongs to.
 *
 * Why this matters: a technology listed under "Key Technologies" is a claim of
 * capability. The same word inside an experience bullet is usually stronger
 * evidence — it shows the thing being *used*. And a word appearing only in a
 * summary is the weakest signal of the three. Confidence should reflect that,
 * and it cannot without knowing where the mention sits.
 */
export function buildSectionMap(text: string): Array<{ from: number; context: MentionContext }> {
  const map: Array<{ from: number; context: MentionContext }> = [{ from: 0, context: "unknown" }];
  let offset = 0;

  for (const line of text.split("\n")) {
    const hit = SECTION_PATTERNS.find((p) => p.test.test(line.trim()));
    if (hit) map.push({ from: offset, context: hit.context });
    offset += line.length + 1;
  }
  return map;
}

export function contextAt(
  map: Array<{ from: number; context: MentionContext }>,
  offset: number,
): MentionContext {
  let current: MentionContext = "unknown";
  for (const entry of map) {
    if (entry.from <= offset) current = entry.context;
    else break;
  }
  return current;
}
