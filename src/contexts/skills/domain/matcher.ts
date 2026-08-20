/**
 * Canonical skill-term matching.
 *
 * Extraction, market demand and CV comparison must agree on what a mention is.
 * Keeping one boundary rule prevents `go` from matching `going` in one screen
 * while another screen counts it as market demand.
 */
import type { SkillDefinition } from "./types.ts";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string): string {
  return term.trim().split(/\s+/).map(escapeRegex).join("\\s+");
}

export function skillTermRegex(term: string): RegExp | null {
  const pattern = termPattern(term);
  if (!pattern) return null;
  // The lookahead observes the trailing boundary without consuming it, so
  // adjacent terms such as "Python Python" are both found.
  return new RegExp(`(^|[^a-z0-9+#.])(${pattern})(?=$|[^a-z0-9+#])`, "gi");
}

export function findSkillOccurrences(text: string, term: string): number[] {
  const regex = skillTermRegex(term);
  if (!regex) return [];

  const offsets: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    offsets.push(match.index + match[1]!.length);
  }
  return offsets;
}

export function matchesSkillTerm(text: string, term: string): boolean {
  return findSkillOccurrences(text, term).length > 0;
}

/** Canonical display name plus aliases, normalized and deduplicated. */
export function skillTerms(skill: SkillDefinition): string[] {
  return [
    ...new Set(
      [skill.name, ...skill.aliases]
        .map((term) => term.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  ];
}
