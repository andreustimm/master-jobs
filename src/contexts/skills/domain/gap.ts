/**
 * Vocabulary gap analysis.
 *
 * The finding that makes this file exist: the candidate's CV writes "Datadog,
 * Rollbar" where the target jobs write "observability". The experience is
 * there. The word is not. An ATS filter does not infer — a recruiter searches
 * the literal terms of their own job description, so a synonym scores zero.
 *
 * The whole value is in refusing to collapse three very different situations
 * into one "missing skills" list:
 *
 *   - `covered`    — the market asks, the CV says it, in the market's words.
 *   - `vocabulary` — the candidate HAS the skill and the CV proves it, but
 *                    under a spelling the market does not search for. This is
 *                    a find-and-replace, not a career gap, and it is the
 *                    cheapest points on the board.
 *   - `missing`    — the market asks and the CV shows nothing. A real gap.
 *
 * Conflating the middle case with the last one is what makes generic advice
 * useless: it tells a 20-year architect to "learn observability" when what he
 * actually needs is to write the word down once.
 *
 * Pure: no database, no network, no clock.
 */
import type { SkillDefinition } from "./types.ts";

export type GapKind = "covered" | "vocabulary" | "missing";

export type SkillDemand = {
  slug: string;
  /** How many target jobs mention the skill under any spelling. */
  jobCount: number;
  /** Spellings used by the market, most frequent first. */
  termsByFrequency: Array<{ term: string; count: number }>;
};

export type GapItem = {
  skill: SkillDefinition;
  kind: GapKind;
  /** Share of target jobs asking for it, 0..1. */
  demand: number;
  jobCount: number;
  /** Spelling the market uses most. */
  marketTerm: string;
  /** Spellings the CV actually uses. Empty for `missing`. */
  cvTerms: string[];
  /**
   * Points available for a pure rewording. Only meaningful for `vocabulary`;
   * it is what makes the list sortable by effort-to-reward.
   */
  rewriteValue: number;
  rationale: string;
};

export type GapReport = {
  totalJobs: number;
  items: GapItem[];
  /** Vocabulary gaps only, most valuable first. The actionable list. */
  quickWins: GapItem[];
  /** Real gaps, most demanded first. */
  realGaps: GapItem[];
  coverage: {
    /** Demand-weighted share of the market vocabulary the CV already speaks. */
    weighted: number;
    covered: number;
    vocabulary: number;
    missing: number;
  };
};

/** Word-boundary match. Same rule as the scorer, so the two agree. */
function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, "i").test(haystack);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/**
 * How often the market uses each spelling of each skill.
 *
 * Counts documents, not mentions: a job description that says "Kubernetes"
 * eleven times is still one employer asking for Kubernetes. Counting mentions
 * would let one verbose posting outweigh ten terse ones.
 */
export function measureDemand(catalog: SkillDefinition[], jobTexts: string[]): SkillDemand[] {
  const normalized = jobTexts.map(normalize);

  return catalog.map((skill) => {
    const counts = new Map<string, number>();
    let jobCount = 0;

    for (const text of normalized) {
      let hitThisJob = false;
      for (const alias of skill.aliases) {
        if (mentions(text, alias)) {
          counts.set(alias, (counts.get(alias) ?? 0) + 1);
          hitThisJob = true;
        }
      }
      if (hitThisJob) jobCount++;
    }

    const termsByFrequency = [...counts.entries()]
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

    return { slug: skill.slug, jobCount, termsByFrequency };
  });
}

export type AnalyzeGapOptions = {
  /** Ignore skills asked by fewer than this share of jobs. Default 5%. */
  minDemand?: number;
};

export function analyzeGap(
  catalog: SkillDefinition[],
  cvText: string,
  demand: SkillDemand[],
  totalJobs: number,
  options: AnalyzeGapOptions = {},
): GapReport {
  const minDemand = options.minDemand ?? 0.05;
  const cv = normalize(cvText);
  const bySlug = new Map(demand.map((d) => [d.slug, d]));

  const items: GapItem[] = [];

  for (const skill of catalog) {
    const d = bySlug.get(skill.slug);
    if (!d || d.jobCount === 0 || totalJobs === 0) continue;

    const share = d.jobCount / totalJobs;
    if (share < minDemand) continue;

    const cvTerms = skill.aliases.filter((a) => mentions(cv, a));
    const marketTerm = d.termsByFrequency[0]?.term ?? skill.name.toLowerCase();

    let kind: GapKind;
    let rationale: string;

    if (cvTerms.length === 0) {
      kind = "missing";
      rationale = `${d.jobCount} de ${totalJobs} vagas-alvo pedem "${marketTerm}"; o CV não menciona nenhuma grafia.`;
    } else if (cvTerms.some((t) => t === marketTerm)) {
      kind = "covered";
      rationale = `O CV já usa "${marketTerm}", o mesmo termo que o mercado busca.`;
    } else {
      kind = "vocabulary";
      rationale =
        `O CV escreve "${cvTerms.join('", "')}"; ${d.jobCount} de ${totalJobs} vagas ` +
        `escrevem "${marketTerm}". A experiência está documentada — falta a palavra.`;
    }

    // Only a rewording earns this. Scaled by demand so the list sorts by
    // "cheapest points first", which is the only order that gets acted on.
    const rewriteValue = kind === "vocabulary" ? Math.round(share * 1000) / 10 : 0;

    items.push({
      skill,
      kind,
      demand: Math.round(share * 1000) / 1000,
      jobCount: d.jobCount,
      marketTerm,
      cvTerms,
      rewriteValue,
      rationale,
    });
  }

  items.sort((a, b) => b.jobCount - a.jobCount || a.skill.slug.localeCompare(b.skill.slug));

  const quickWins = items.filter((i) => i.kind === "vocabulary");
  const realGaps = items.filter((i) => i.kind === "missing");
  const covered = items.filter((i) => i.kind === "covered");

  // Weighted by demand: speaking the word that 80% of jobs use is worth more
  // than speaking one that 6% use. A plain count would flatter the CV.
  const totalWeight = items.reduce((sum, i) => sum + i.jobCount, 0);
  const coveredWeight = covered.reduce((sum, i) => sum + i.jobCount, 0);

  return {
    totalJobs,
    items,
    quickWins,
    realGaps,
    coverage: {
      weighted: totalWeight === 0 ? 0 : Math.round((coveredWeight / totalWeight) * 1000) / 1000,
      covered: covered.length,
      vocabulary: quickWins.length,
      missing: realGaps.length,
    },
  };
}
