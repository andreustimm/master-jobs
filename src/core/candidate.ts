/**
 * The candidate's own material, and what the corpus says about it.
 *
 * Storing a CV is only worth doing because of what it enables: comparing the
 * candidate's vocabulary against the vocabulary of the jobs he actually wants.
 * That answers a question nothing else here answers — "which words are the
 * postings using that my CV never says?" — and it is answerable offline,
 * because the descriptions have been in the database since the first sync.
 *
 * > **Invariante:** this module never edits the CV. It reports. A tool that
 * > silently rewrites a candidate's own words to match a job posting is how
 * > people end up claiming experience they do not have — see rule 6 in
 * > CLAUDE.md and the `growth:` list in profile.yaml.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { candidate, candidateDocument, job, jobScore } from "./db/schema.ts";
import { loadProfile } from "./profile/load.ts";

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

export async function ensureCandidate(input: {
  slug?: string;
  name: string;
  headline?: string | null;
  location?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
}): Promise<number> {
  const db = getDb();
  const slug = input.slug ?? "default";

  const existing = await db
    .select({ id: candidate.id })
    .from(candidate)
    .where(eq(candidate.slug, slug))
    .limit(1);

  const found = existing[0];
  if (found) {
    await db
      .update(candidate)
      .set({
        name: input.name,
        headline: input.headline ?? null,
        location: input.location ?? null,
        email: input.email ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        githubUrl: input.githubUrl ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(candidate.id, found.id));
    return found.id;
  }

  const inserted = await db
    .insert(candidate)
    .values({
      slug,
      name: input.name,
      headline: input.headline ?? null,
      location: input.location ?? null,
      email: input.email ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      githubUrl: input.githubUrl ?? null,
      isDefault: true,
    })
    .returning({ id: candidate.id });

  const row = inserted[0];
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

/** Seed the candidate row from profile.yaml, so the two never drift on identity. */
export async function syncCandidateFromProfile(): Promise<number> {
  const profile = await loadProfile(true);
  return ensureCandidate({
    slug: "default",
    name: profile.identity.name,
    headline: profile.identity.headline,
    location: profile.identity.location,
    email: profile.identity.email,
    linkedinUrl: profile.identity.linkedin ?? null,
    githubUrl: profile.identity.github ?? null,
  });
}

export async function getCandidate(slug = "default") {
  const db = getDb();
  const rows = await db.select().from(candidate).where(eq(candidate.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Save a document, retiring the previous current one of the same kind.
 *
 * Versioned rather than overwritten: knowing what was actually sent to a
 * company three weeks ago is the difference between answering an interview
 * question and guessing.
 */
export async function saveDocument(input: {
  candidateId: number;
  kind?: string;
  label: string;
  content: string;
  format?: string;
  sourceFilename?: string | null;
}): Promise<{ id: number; previousRetired: boolean }> {
  const db = getDb();
  const kind = input.kind ?? "cv";

  const retired = await db
    .update(candidateDocument)
    .set({ isCurrent: false })
    .where(
      and(
        eq(candidateDocument.candidateId, input.candidateId),
        eq(candidateDocument.kind, kind),
        eq(candidateDocument.isCurrent, true),
      ),
    )
    .returning({ id: candidateDocument.id });

  const inserted = await db
    .insert(candidateDocument)
    .values({
      candidateId: input.candidateId,
      kind,
      label: input.label,
      content: input.content,
      format: input.format ?? "text",
      sourceFilename: input.sourceFilename ?? null,
      isCurrent: true,
    })
    .returning({ id: candidateDocument.id });

  const row = inserted[0];
  if (!row) throw new Error("insert returned no row");
  return { id: row.id, previousRetired: retired.length > 0 };
}

export async function currentDocument(candidateId: number, kind = "cv") {
  const db = getDb();
  const rows = await db
    .select()
    .from(candidateDocument)
    .where(
      and(
        eq(candidateDocument.candidateId, candidateId),
        eq(candidateDocument.kind, kind),
        eq(candidateDocument.isCurrent, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function documentHistory(candidateId: number, kind = "cv") {
  const db = getDb();
  return db
    .select({
      id: candidateDocument.id,
      label: candidateDocument.label,
      format: candidateDocument.format,
      isCurrent: candidateDocument.isCurrent,
      length: sql<number>`length(${candidateDocument.content})`,
      createdAt: candidateDocument.createdAt,
    })
    .from(candidateDocument)
    .where(and(eq(candidateDocument.candidateId, candidateId), eq(candidateDocument.kind, kind)))
    .orderBy(desc(candidateDocument.createdAt));
}

/* -------------------------------------------------------------------------- */
/* Gap analysis                                                                */
/* -------------------------------------------------------------------------- */

export type TermGap = {
  term: string;
  weight: number;
  /** How many high-fit postings mention it. */
  inJobs: number;
  /** Share of high-fit postings, 0..1. */
  coverage: number;
  inCv: boolean;
};

export type GapReport = {
  cvLength: number;
  jobsAnalysed: number;
  minFit: number;
  /** Wanted by the market, absent from the CV — the actionable list. */
  missing: TermGap[];
  /** Present in both — the vocabulary that is already working. */
  confirmed: TermGap[];
  /** In the CV but rare in the target postings — possibly dead weight. */
  unused: TermGap[];
};

function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, "i").test(haystack);
}

/**
 * Compare the CV's vocabulary against the postings that actually match.
 *
 * Deliberately scoped to high-fit jobs: comparing against the whole corpus
 * would surface the vocabulary of roles the candidate does not want, which is
 * how a CV gets diluted rather than sharpened.
 */
export async function analyseGap(opts: { minFit?: number; limit?: number } = {}): Promise<GapReport | null> {
  const db = getDb();
  const minFit = opts.minFit ?? 60;

  const person = await getCandidate();
  if (!person) return null;
  const doc = await currentDocument(person.id, "cv");
  if (!doc) return null;

  const cv = doc.content.toLowerCase();
  const profile = await loadProfile(true);

  const rows = await db
    .select({ text: sql<string>`lower(coalesce(${job.descriptionText}, '') || ' ' || ${job.title})` })
    .from(job)
    .innerJoin(jobScore, eq(jobScore.jobId, job.id))
    .where(and(sql`${job.closedAt} is null`, sql`${jobScore.fit} >= ${minFit}`))
    .limit(opts.limit ?? 300);

  const corpus = rows.map((r) => r.text);
  const terms = [
    ...profile.keywords.critical,
    ...profile.keywords.strong,
    ...profile.keywords.stack,
  ];

  const scored: TermGap[] = terms.map((t) => {
    const inJobs = corpus.filter((text) => mentions(text, t.term)).length;
    return {
      term: t.term,
      weight: t.weight,
      inJobs,
      coverage: corpus.length > 0 ? inJobs / corpus.length : 0,
      inCv: mentions(cv, t.term),
    };
  });

  const byImpact = (a: TermGap, b: TermGap) =>
    b.coverage * b.weight - a.coverage * a.weight;

  return {
    cvLength: doc.content.length,
    jobsAnalysed: corpus.length,
    minFit,
    // Worth acting on only if the market actually asks for it.
    missing: scored.filter((t) => !t.inCv && t.coverage >= 0.1).sort(byImpact),
    confirmed: scored.filter((t) => t.inCv && t.coverage >= 0.1).sort(byImpact),
    unused: scored.filter((t) => t.inCv && t.coverage < 0.05).sort((a, b) => a.coverage - b.coverage),
  };
}
