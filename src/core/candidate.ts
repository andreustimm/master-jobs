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
import { application, candidate, candidateDocument, job, jobScore } from "./db/schema.ts";
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
  /** Grava mesmo que o conteúdo não tenha mudado. Só a restauração usa. */
  force?: boolean;
}): Promise<{ id: number; previousRetired: boolean; unchanged?: true }> {
  const db = getDb();
  const kind = input.kind ?? "cv";

  // Salvar sem mudar nada não deveria criar versão. Três "ATS EN 2026-07" com
  // 8.227, 8.228 e 8.166 caracteres foi o que essa ausência produziu: um
  // histórico onde o rótulo não distingue e o tamanho quase também não.
  //
  // Só o conteúdo conta. Trocar o rótulo de uma versão é `renameDocument`, que
  // corrige a que existe em vez de criar outra igual com nome diferente.
  if (!input.force) {
    const current = await currentDocument(input.candidateId, kind);
    if (current && current.content === input.content) {
      return { id: current.id, previousRetired: false, unchanged: true };
    }
  }

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
    // `id` desempata: `created_at` tem resolução de milissegundo e dois
    // salvamentos na mesma requisição empatam. Ordem instável num histórico é
    // pior que ordem errada — a lista muda de posição entre dois carregamentos
    // e o usuário clica na linha que não queria.
    .orderBy(desc(candidateDocument.createdAt), desc(candidateDocument.id));
}

/* -------------------------------------------------------------------------- */
/* Versões: ver, restaurar, renomear, excluir                                  */
/* -------------------------------------------------------------------------- */

/**
 * Uma versão pelo id, **sempre** limitada ao candidato.
 *
 * O id chega de um formulário, e id em formulário é pedido, não prova. Filtrar
 * por `candidateId` aqui é o que impede que trocar um número no HTML leia o
 * currículo de outra pessoa. O mesmo motivo pelo qual `guardOwnCandidate` não
 * aceita id por parâmetro.
 */
export async function documentById(candidateId: number, id: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(candidateDocument)
    .where(and(eq(candidateDocument.id, id), eq(candidateDocument.candidateId, candidateId)))
    .limit(1);
  return rows[0] ?? null;
}

export const MAX_LABEL = 120;

export type VersionError = "not-found" | "empty-label" | "label-too-long" | "is-current" | "referenced";

export type VersionFailure = { ok: false; error: VersionError; detail?: string };
/** Sucesso simples, ou recusa que diz por quê. */
export type VersionResult = { ok: true } | VersionFailure;
/** Sucesso que carrega dado — a restauração devolve o id da versão criada. */
export type VersionResultWith<T> = ({ ok: true } & T) | VersionFailure;

/**
 * Renomear.
 *
 * Não é cosmético: o rótulo é a única alça humana de uma versão, e um histórico
 * com três rótulos iguais não responde à pergunta que se faz a um histórico —
 * *qual era esta?*. Renomear é o que torna a lista utilizável.
 */
export async function renameDocument(
  candidateId: number,
  id: number,
  label: string,
): Promise<VersionResult> {
  const trimmed = label.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty-label" };
  if (trimmed.length > MAX_LABEL) return { ok: false, error: "label-too-long" };

  const db = getDb();
  const updated = await db
    .update(candidateDocument)
    .set({ label: trimmed })
    .where(and(eq(candidateDocument.id, id), eq(candidateDocument.candidateId, candidateId)))
    .returning({ id: candidateDocument.id });

  return updated.length > 0 ? { ok: true } : { ok: false, error: "not-found" };
}

/**
 * Candidaturas que dizem ter enviado esta versão.
 *
 * `application.cv_variant` é **texto livre**, não chave estrangeira: o funil
 * registra qual currículo foi enviado guardando o nome dele numa string solta.
 * Enquanto for assim, a integridade tem de ser verificada aqui — o banco não a
 * garante. Ver UI-02 em `docs/product/backlog.md`.
 */
export async function applicationsUsingLabel(label: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ title: job.title, company: job.companyName })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(eq(application.cvVariant, label))
    .limit(20);
  return rows.map((r) => [r.company, r.title].filter(Boolean).join(" · "));
}

/**
 * Excluir uma versão.
 *
 * Duas recusas, e nenhuma é zelo excessivo:
 *
 * **A versão atual não sai.** `/candidate` renderiza a partir dela, e as
 * análises de vocabulário e de skills comparam o mercado contra ela. Apagá-la
 * deixaria três telas sem chão. Para trocar a atual, restaura-se outra antes.
 *
 * **Versão citada pelo funil não sai.** Antes de uma entrevista a pergunta é
 * "que currículo essa empresa viu?", e ela precisa ser respondível meses
 * depois. Apagar aqui não quebra nada tecnicamente — e é justamente o problema:
 * o funil continuaria afirmando ter enviado um documento que não existe mais.
 * Auditoria que aponta para o vazio é pior que auditoria nenhuma, porque parece
 * íntegra.
 */
export async function deleteDocument(candidateId: number, id: number): Promise<VersionResult> {
  const doc = await documentById(candidateId, id);
  if (!doc) return { ok: false, error: "not-found" };
  if (doc.isCurrent) return { ok: false, error: "is-current" };

  const used = await applicationsUsingLabel(doc.label);
  if (used.length > 0) {
    return { ok: false, error: "referenced", detail: used.join(" | ") };
  }

  const db = getDb();
  await db
    .delete(candidateDocument)
    .where(and(eq(candidateDocument.id, id), eq(candidateDocument.candidateId, candidateId)));
  return { ok: true };
}

/**
 * Restaurar: **acrescenta**, não rebobina.
 *
 * Grava uma versão nova com o conteúdo da antiga em vez de mover `is_current`
 * de volta. As duas alternativas preservam as linhas, mas só esta mantém "a
 * última linha" e "o currículo atual" como a mesma coisa. Mover o ponteiro faz
 * o histórico deixar de ser cronológico, e todo código que hoje lê o topo da
 * lista como estado corrente passa a mentir em silêncio.
 *
 * `force` porque o guard de conteúdo idêntico existe para salvamento repetido,
 * não para restauração: restaurar a versão que já é a atual é sem efeito, mas
 * restaurar uma anterior cujo texto por acaso coincide é uma intenção real.
 */
export async function restoreDocument(
  candidateId: number,
  id: number,
  label: string,
): Promise<VersionResultWith<{ id: number }>> {
  const doc = await documentById(candidateId, id);
  if (!doc) return { ok: false, error: "not-found" };
  if (doc.isCurrent) return { ok: false, error: "is-current" };

  const trimmed = label.trim().slice(0, MAX_LABEL);
  if (trimmed.length === 0) return { ok: false, error: "empty-label" };

  const saved = await saveDocument({
    candidateId,
    kind: doc.kind,
    label: trimmed,
    content: doc.content,
    format: doc.format,
    sourceFilename: doc.sourceFilename,
    force: true,
  });
  return { ok: true, id: saved.id };
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
