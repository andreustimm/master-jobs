/**
 * Skill extraction — domain types.
 *
 * Nothing here touches a database, a network or a clock. That is the point:
 * the extractor is the part worth testing exhaustively, and it can be, because
 * it is a pure function of (text, catalogue) → detections.
 */

export const SKILL_CATEGORIES = [
  "language",
  "framework",
  "ai",
  "cloud",
  "data",
  "practice",
  "domain",
  "tool",
  "soft",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_STATUSES = ["detected", "confirmed", "rejected"] as const;

export type SkillStatus = (typeof SKILL_STATUSES)[number];

export type SkillAuditStatus = Exclude<SkillStatus, "detected">;

export const SKILL_SOURCES = ["cv", "profile", "manual", "inferred"] as const;

export type SkillSource = (typeof SKILL_SOURCES)[number];

const CATEGORY_SET: ReadonlySet<string> = new Set(SKILL_CATEGORIES);
const STATUS_SET: ReadonlySet<string> = new Set(SKILL_STATUSES);
const SOURCE_SET: ReadonlySet<string> = new Set(SKILL_SOURCES);

export function isSkillCategory(value: string): value is SkillCategory {
  return CATEGORY_SET.has(value);
}

export function parseSkillCategory(value: string): SkillCategory {
  if (!isSkillCategory(value)) throw new Error(`Unknown skill category "${value}"`);
  return value;
}

export function isSkillStatus(value: string): value is SkillStatus {
  return STATUS_SET.has(value);
}

export function parseSkillStatus(value: string): SkillStatus {
  if (!isSkillStatus(value)) throw new Error(`Unknown skill status "${value}"`);
  return value;
}

export function isSkillSource(value: string): value is SkillSource {
  return SOURCE_SET.has(value);
}

export function parseSkillSource(value: string): SkillSource {
  if (!isSkillSource(value)) throw new Error(`Unknown skill source "${value}"`);
  return value;
}

/** A canonical skill and every spelling it appears under. */
export type SkillDefinition = {
  slug: string;
  name: string;
  category: SkillCategory;
  aliases: readonly string[];
};

/** Candidate-facing projection; storage column names never escape the context. */
export type CandidateSkillView = {
  id: number;
  slug: string;
  name: string;
  category: SkillCategory;
  status: SkillStatus;
  source: SkillSource;
  evidence: string | null;
  occurrences: number;
  level: string | null;
  auditedAt: string | null;
};

export type MarketSkillDemand = {
  slug: string;
  name: string;
  category: SkillCategory;
  /** Share of high-fit postings mentioning it, 0..1. */
  demand: number;
  postings: number;
  candidateStatus: SkillStatus | null;
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
 * Strategies report evidence only. Confidence is calculated once by the
 * canonical combiner from mention context and repetition.
 */
export type ExtractionStrategy = {
  readonly name: string;
  extract(text: string, catalog: SkillDefinition[]): StrategyHit[];
};
