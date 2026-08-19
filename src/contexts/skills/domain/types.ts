/**
 * Skill extraction — domain types.
 *
 * Nothing here touches a database, a network or a clock. That is the point:
 * the extractor is the part worth testing exhaustively, and it can be, because
 * it is a pure function of (text, catalogue) → detections.
 */

export type SkillCategory =
  | "language" | "framework" | "ai" | "cloud"
  | "data" | "practice" | "domain" | "tool" | "soft";

/** A canonical skill and every spelling it appears under. */
export type SkillDefinition = {
  slug: string;
  name: string;
  category: SkillCategory;
  aliases: string[];
};

/** Where in a document a mention was found — this is what confidence is built on. */
export type MentionContext = "skills-section" | "experience" | "summary" | "unknown";

export type Mention = {
  alias: string;
  offset: number;
  context: MentionContext;
  /** The line the mention sits on, so a human can judge the detection. */
  sentence: string;
};

export type Detection = {
  skill: SkillDefinition;
  mentions: Mention[];
  occurrences: number;
  /** 0..1. Derived from where and how often, never from a model's opinion. */
  confidence: number;
  /** The most informative sentence, chosen for a human reviewer. */
  evidence: string;
  /** Why the extractor believes this — shown during audit. */
  rationale: string;
};

/** What a strategy reports for one skill. */
export type StrategyHit = {
  skillSlug: string;
  mentions: Mention[];
};

/**
 * One way of finding skills in text.
 *
 * A strategy exists so that adding a smarter extractor later — an LLM pass, a
 * parser for a specific CV format, a LinkedIn profile reader — does not mean
 * rewriting the pipeline. It means adding a file and registering it.
 *
 * `weight` is how much this strategy's opinion counts when several agree.
 */
export type ExtractionStrategy = {
  readonly name: string;
  readonly weight: number;
  extract(text: string, catalog: SkillDefinition[]): StrategyHit[];
};
