/**
 * Everything needed to apply well to one job, gathered in one place.
 *
 * This is the step before autonomous submission (E-03), and it is deliberately
 * where the line sits. Submitting is irreversible and its own decision — see
 * ADR 0010. Preparing is not: it costs nothing to be wrong, and it attacks the
 * bottleneck this product was built around. The funnel holds a handful of
 * applications against thousands of jobs because a good application takes 40 to
 * 90 minutes, and most of that is reassembling context the system already has.
 *
 * What it answers, in the order a person actually needs it:
 *   1. Should I apply at all — what would disqualify me?
 *   2. Do I know anyone there?
 *   3. Which of my evidence maps to what they asked for?
 *   4. Which words do they use that my CV does not?
 *
 * The last one is the difference between being read and being filtered, and it
 * is computed against *this* posting rather than the market average.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { job, jobPage, jobScore } from "../db/schema.ts";
import { loadProfile } from "../profile/load.ts";
import { companiesWithContacts } from "../contacts.ts";
import { slugifyCompany } from "../ingest/normalize.ts";
import { jobVocabularyComparison } from "../../contexts/skills/index.ts";
import { scoreMessages } from "../../contexts/matching/index.ts";
import { renderScoreMessage, translator } from "../i18n/index.ts";

export type DossierEvidence = { area: string; line: string; matched: string[] };

export type Dossier = {
  job: {
    id: number;
    title: string;
    companyName: string;
    url: string;
    applyUrl: string | null;
    locationRaw: string | null;
    ageDays: number | null;
  };
  fit: number | null;
  cluster: string | null;
  /** Reasons not to bother, first — the cheapest information here. */
  blockers: string[];
  contacts: string[];
  requirements: string[];
  evidence: DossierEvidence[];
  /** Terms this posting uses that the CV does not — a rewrite, not a gap. */
  vocabularyGaps: Array<{ term: string; cvSays: string[] }>;
  /** Terms the posting asks for that the CV cannot support at all. */
  missing: string[];
  hasDescription: boolean;
  warnings: string[];
};

const STOPWORDS = new Set([
  "with", "and", "for", "the", "from", "that", "this", "into", "using", "across",
  "built", "over", "more", "than", "were", "have", "been", "their", "which",
  "while", "where", "when", "them", "they", "also", "such", "including",
]);

/** Words distinctive enough that a shared one means something. */
export function significantTerms(line: string): string[] {
  const seen = new Set<string>();
  for (const raw of line.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ0-9+#.-]{3,}/g) ?? []) {
    const word = raw.replace(/[.,]+$/, "");
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    seen.add(word);
  }
  return [...seen];
}

/** Evidence lines whose own vocabulary shows up in this posting. */
export function matchEvidence(
  evidence: Record<string, string[]>,
  postingText: string,
  minShared = 2,
): DossierEvidence[] {
  const haystack = postingText.toLowerCase();
  const out: DossierEvidence[] = [];

  for (const [area, lines] of Object.entries(evidence)) {
    for (const line of lines) {
      const matched = significantTerms(line).filter((term) => haystack.includes(term));
      // One shared word is coincidence; two is a claim worth making.
      if (matched.length >= minShared) out.push({ area, line, matched });
    }
  }
  return out.sort((a, b) => b.matched.length - a.matched.length);
}

export async function buildDossier(
  candidateId: number,
  jobId: number,
  cvText: string | null,
): Promise<Dossier | null> {
  const db = getDb();

  const [row] = await db
    .select({
      id: job.id,
      title: job.title,
      companyName: job.companyName,
      url: job.url,
      applyUrl: job.applyUrl,
      locationRaw: job.locationRaw,
      descriptionText: job.descriptionText,
      fit: jobScore.fit,
      cluster: jobScore.cluster,
      blockers: jobScore.blockers,
      ageDays: jobScore.ageDays,
      pageText: jobPage.text,
      pageExtracted: jobPage.extracted,
    })
    .from(job)
    .leftJoin(
      jobScore,
      and(eq(jobScore.jobId, job.id), eq(jobScore.candidateId, candidateId)),
    )
    .leftJoin(jobPage, eq(jobPage.jobId, job.id))
    .where(eq(job.id, jobId))
    .limit(1);

  if (!row) return null;

  const warnings: string[] = [];
  const profile = await loadProfile();

  // The captured page beats the adapter's text: it is the fuller of the two,
  // and this analysis is only as good as the words it can see.
  const text = row.pageText ?? row.descriptionText ?? "";
  const hasDescription = text.length >= 400;
  if (!hasDescription) {
    warnings.push(
      "Sem descrição suficiente — rode `jho scrape queue && jho scrape run` antes de confiar nas lacunas.",
    );
  }

  const extracted = (row.pageExtracted ?? {}) as { requirements?: string[] };

  const byCompany = await companiesWithContacts();
  const contacts = byCompany.get(slugifyCompany(row.companyName) ?? "") ?? [];

  let vocabularyGaps: Dossier["vocabularyGaps"] = [];
  let missing: string[] = [];

  if (hasDescription && cvText) {
    // One posting is the whole corpus here, so demand is binary: the term is
    // either in this job or it is not. That is exactly the question being asked.
    const report = await jobVocabularyComparison({ cvText, jobText: text });
    vocabularyGaps = report.quickWins.map((item) => ({ term: item.marketTerm, cvSays: item.cvTerms }));
    missing = report.realGaps.map((item) => item.marketTerm);
  } else if (!cvText) {
    warnings.push("Nenhum currículo salvo — sem CV não há como cruzar vocabulário.");
  }

  return {
    job: {
      id: row.id,
      title: row.title,
      companyName: row.companyName,
      url: row.url,
      applyUrl: row.applyUrl,
      locationRaw: row.locationRaw,
      ageDays: row.ageDays,
    },
    fit: row.fit,
    cluster: row.cluster,
    blockers: scoreMessages(row.blockers).map((blocker) =>
      renderScoreMessage(blocker, translator("pt-BR").t)
    ),
    contacts,
    requirements: extracted.requirements ?? [],
    // Nothing outside `evidence:` is claimable — rule 6.
    evidence: matchEvidence(profile.evidence, text).slice(0, 8),
    vocabularyGaps,
    missing,
    hasDescription,
    warnings,
  };
}
