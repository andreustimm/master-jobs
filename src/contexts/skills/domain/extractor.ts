/**
 * The extractor: pure, deterministic, testable without a database.
 *
 * Combines the strategies into one detection per skill, with a confidence that
 * can be explained in a sentence. That last part is not decoration — the whole
 * feature rests on a human auditing the output, and nobody audits a number they
 * cannot interrogate.
 *
 * > **Invariante:** this produces *candidates*. It never decides that the
 * > person has a skill. The word "detected" is load-bearing.
 */
import { DEFAULT_STRATEGIES } from "./strategies.ts";
import type {
  Detection,
  ExtractionStrategy,
  Mention,
  SkillDefinition,
} from "./types.ts";

export type ExtractOptions = {
  strategies?: ExtractionStrategy[];
  /** Detections below this are dropped as noise. */
  minConfidence?: number;
};

/**
 * Confidence, and the reasoning behind each term.
 *
 * Three signals, in the order they deserve trust:
 *
 *  - **applied** — the skill sits in a sentence describing work done. The
 *    strongest evidence a CV can offer.
 *  - **declared** — it appears in an explicit technologies list. A claim, which
 *    is weaker than a demonstration but still deliberate.
 *  - **repetition** — mentioned several times across the document. Real, but
 *    saturating: the tenth mention says little the third did not.
 *
 * Deliberately capped below 1.0 for anything that is only declared. A skill
 * listed once in a stack block should never look as certain as one attached to
 * a shipped system.
 */
function scoreConfidence(mentions: Mention[]): { confidence: number; rationale: string } {
  const applied = mentions.filter((m) => m.context === "experience").length;
  const declared = mentions.filter((m) => m.context === "skills-section").length;
  const total = mentions.length;

  const reasons: string[] = [];
  let score = 0.35; // a mention at all is weak evidence, not zero

  if (applied > 0) {
    score += 0.4;
    reasons.push(`usada em ${applied} bullet(s) de experiência`);
  }
  if (declared > 0) {
    score += 0.15;
    reasons.push("listada explicitamente entre tecnologias");
  }

  // Saturating: the third mention adds much less than the second.
  const repetition = Math.min(0.15, Math.log2(total + 1) * 0.05);
  score += repetition;
  if (total > 2) reasons.push(`${total} menções no documento`);

  if (applied === 0 && declared === 0) {
    reasons.push("apenas menção solta — verifique o contexto");
  }

  return {
    confidence: Math.min(1, Math.round(score * 100) / 100),
    rationale: reasons.join("; "),
  };
}

/**
 * Pick the sentence a human should read to judge the detection.
 *
 * Prefers a bullet describing work over a stack list, because "Built X using Y"
 * settles the question and "Y, Z, W" does not.
 */
function chooseEvidence(mentions: Mention[]): string {
  const applied = mentions.find((m) => m.context === "experience");
  if (applied) return applied.sentence;
  const declared = mentions.find((m) => m.context === "skills-section");
  if (declared) return declared.sentence;
  return mentions[0]?.sentence ?? "";
}

export function extractSkills(
  text: string,
  catalog: SkillDefinition[],
  opts: ExtractOptions = {},
): Detection[] {
  if (!text.trim() || catalog.length === 0) return [];

  const strategies = opts.strategies ?? DEFAULT_STRATEGIES;
  const bySlug = new Map(catalog.map((s) => [s.slug, s]));

  // Merge mentions from every strategy, deduplicating by offset — the same
  // occurrence is reported by more than one strategy by design.
  const merged = new Map<string, Map<number, Mention>>();

  for (const strategy of strategies) {
    for (const hit of strategy.extract(text, catalog)) {
      const existing = merged.get(hit.skillSlug) ?? new Map<number, Mention>();
      for (const mention of hit.mentions) {
        // A stronger context wins for the same offset.
        const prev = existing.get(mention.offset);
        if (!prev || rank(mention.context) > rank(prev.context)) {
          existing.set(mention.offset, mention);
        }
      }
      merged.set(hit.skillSlug, existing);
    }
  }

  const detections: Detection[] = [];
  for (const [slug, mentionMap] of merged) {
    const skill = bySlug.get(slug);
    if (!skill) continue;

    const mentions = [...mentionMap.values()].sort((a, b) => a.offset - b.offset);
    const { confidence, rationale } = scoreConfidence(mentions);
    if (confidence < (opts.minConfidence ?? 0)) continue;

    detections.push({
      skill,
      mentions,
      occurrences: mentions.length,
      confidence,
      evidence: chooseEvidence(mentions),
      rationale,
    });
  }

  return detections.sort(
    (a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences,
  );
}

function rank(context: Mention["context"]): number {
  return context === "experience" ? 3 : context === "skills-section" ? 2 : context === "summary" ? 1 : 0;
}

/** Group detections by category, for display. */
export function groupByCategory(detections: Detection[]): Map<string, Detection[]> {
  const out = new Map<string, Detection[]>();
  for (const d of detections) {
    out.set(d.skill.category, [...(out.get(d.skill.category) ?? []), d]);
  }
  return out;
}
