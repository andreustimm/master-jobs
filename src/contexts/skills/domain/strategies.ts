/**
 * Extraction strategies.
 *
 * Each one is a pure function of (text, catalogue). They are separate so that a
 * future strategy — an LLM pass over ambiguous sections, a parser for a
 * specific CV template, a LinkedIn profile reader — is an added file rather
 * than a rewrite.
 */
import { findSkillOccurrences, skillTerms } from "./matcher.ts";
import { buildSectionMap, contextAt, lineAt } from "./text.ts";
import type { ExtractionStrategy, Mention, SkillDefinition, StrategyHit } from "./types.ts";

/**
 * Literal alias matching.
 *
 * The workhorse. Every alias in the catalogue was chosen because it appears in
 * real CVs or real postings, and matching is word-boundary aware so short names
 * cannot fire inside longer words.
 */
export const aliasStrategy: ExtractionStrategy = {
  name: "alias",
  extract(text, catalog): StrategyHit[] {
    const sections = buildSectionMap(text);
    const hits: StrategyHit[] = [];

    for (const skill of catalog) {
      const mentions: Mention[] = [];
      for (const alias of skillTerms(skill)) {
        for (const offset of findSkillOccurrences(text, alias)) {
          mentions.push({
            alias,
            offset,
            context: contextAt(sections, offset),
            sentence: lineAt(text, offset),
          });
        }
      }

      if (mentions.length > 0) hits.push({ skillSlug: skill.slug, mentions });
    }
    return hits;
  },
};

/**
 * Skills named inside a dedicated list.
 *
 * A "Key Technologies" block is a different kind of evidence from a passing
 * mention: it is an explicit claim. This strategy only reports mentions that
 * land inside such a section, which lets the combiner weight them separately
 * rather than treating every occurrence as equal.
 */
export const declaredStrategy: ExtractionStrategy = {
  name: "declared",
  extract(text, catalog): StrategyHit[] {
    const sections = buildSectionMap(text);
    const hits: StrategyHit[] = [];

    for (const skill of catalog) {
      const mentions: Mention[] = [];
      for (const alias of skillTerms(skill)) {
        for (const offset of findSkillOccurrences(text, alias)) {
          if (contextAt(sections, offset) !== "skills-section") continue;
          mentions.push({
            alias,
            offset,
            context: "skills-section",
            sentence: lineAt(text, offset),
          });
        }
      }
      if (mentions.length > 0) hits.push({ skillSlug: skill.slug, mentions });
    }
    return hits;
  },
};

/**
 * Skills demonstrated inside an experience bullet.
 *
 * The strongest evidence a CV offers, because the technology appears attached
 * to something the person did rather than to a list they wrote.
 */
export const appliedStrategy: ExtractionStrategy = {
  name: "applied",
  extract(text, catalog): StrategyHit[] {
    const sections = buildSectionMap(text);
    const hits: StrategyHit[] = [];

    for (const skill of catalog) {
      const mentions: Mention[] = [];
      for (const alias of skillTerms(skill)) {
        for (const offset of findSkillOccurrences(text, alias)) {
          if (contextAt(sections, offset) !== "experience") continue;
          const sentence = lineAt(text, offset);
          // A bullet describing work, not a stack list that happens to sit here.
          if (!/^[-*•]|\b(built|led|designed|developed|implemented|architect|migrat|scal)/i.test(sentence)) {
            continue;
          }
          mentions.push({ alias, offset, context: "experience", sentence });
        }
      }
      if (mentions.length > 0) hits.push({ skillSlug: skill.slug, mentions });
    }
    return hits;
  },
};

export const DEFAULT_STRATEGIES: ExtractionStrategy[] = [
  aliasStrategy,
  declaredStrategy,
  appliedStrategy,
];
