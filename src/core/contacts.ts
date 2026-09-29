/**
 * The professional network as data.
 *
 * Why this exists, in one number: referrals are roughly 7% of applicants and
 * 40% of hires. Nothing else in this system moves the outcome by that margin —
 * not a better scorer, not another source. And until now `application.channel`
 * was a column nothing ever wrote.
 *
 * The job here is narrow and unglamorous: know who you know, at which company,
 * so that when a strong match appears the system says "you know someone here"
 * instead of leaving that connection in your memory.
 *
 * A rede é de um candidato. Toda função recebe `candidateId` — da sessão na
 * página, do candidato ativo na CLI — e nenhuma lê ou grava fora dele: os
 * nomes aqui são de pessoas de fora, e a rede de uma conta não aparece para
 * outra (#379, regra 15).
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { isDuplicateKey } from "./db/retry.ts";
import { application, job, targetAccount } from "./db/schema.ts";
import { slugifyCompany } from "./ingest/normalize.ts";
import { primaryScoreFilter } from "../contexts/matching/index.ts";

export const CONTACT_CATEGORIES = [
  "recruiter",  // recrutador interno ou de agência
  "ai-leader",  // Head of AI, Engineering Director, decisor técnico
  "peer",       // par Staff/Principal
  "former",     // ex-colega ou ex-cliente — o vínculo mais forte que existe
  "company",    // empresa-alvo, ainda sem pessoa identificada
] as const;

export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export type NewContact = {
  name: string;
  company?: string | null;
  role?: string | null;
  linkedinUrl?: string | null;
  category: ContactCategory;
  country?: string | null;
  notes?: string | null;
};

/**
 * A URL do LinkedIn já está gravada fora da rede deste candidato.
 *
 * O índice `target_account_url_idx` ainda é global: a mesma pessoa não entra
 * em duas redes, e contato gravado antes da migration 0031 (sem dono) também
 * ocupa a URL. Recusar é o lado seguro — casar pela URL global sobrescreveria
 * o contato de outra conta. Some quando o índice passar a ser por candidato
 * (#405). `cause` guarda o erro do banco (23505).
 */
export class ContactUrlTaken extends Error {
  readonly code = "contact_url_taken";
  readonly linkedinUrl: string;

  constructor(linkedinUrl: string, cause: unknown) {
    super(`A URL ${linkedinUrl} já está cadastrada fora da sua rede.`, { cause });
    this.name = "ContactUrlTaken";
    this.linkedinUrl = linkedinUrl;
  }
}

export async function addContact(
  candidateId: number,
  input: NewContact,
): Promise<{ id: number; created: boolean }> {
  const db = getDb();

  // The LinkedIn URL is the natural key when present — within this
  // candidate's network. Matching globally would overwrite another
  // account's notes; a URL taken elsewhere is refused below.
  if (input.linkedinUrl) {
    const existing = await db
      .select({ id: targetAccount.id })
      .from(targetAccount)
      .where(
        and(
          eq(targetAccount.candidateId, candidateId),
          eq(targetAccount.linkedinUrl, input.linkedinUrl),
        ),
      )
      .limit(1);
    const found = existing[0];
    if (found) {
      await db
        .update(targetAccount)
        .set({
          name: input.name,
          company: input.company ?? null,
          role: input.role ?? null,
          category: input.category,
          country: input.country ?? null,
          notes: input.notes ?? null,
        })
        .where(eq(targetAccount.id, found.id));
      return { id: found.id, created: false };
    }
  }

  let inserted: { id: number }[];
  try {
    inserted = await db
      .insert(targetAccount)
      .values({
        candidateId,
        name: input.name,
        company: input.company ?? null,
        role: input.role ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        category: input.category,
        country: input.country ?? null,
        notes: input.notes ?? null,
      })
      .returning({ id: targetAccount.id });
  } catch (error) {
    // Só a URL tem índice único nesta tabela; sem URL não há o que colidir.
    if (input.linkedinUrl && isDuplicateKey(error)) throw new ContactUrlTaken(input.linkedinUrl, error);
    throw error;
  }

  const row = inserted[0];
  if (!row) throw new Error("insert returned no row");
  return { id: row.id, created: true };
}

export async function listContacts(candidateId: number, category?: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(targetAccount)
    .where(eq(targetAccount.candidateId, candidateId))
    .orderBy(targetAccount.category);
  return category ? rows.filter((r) => r.category === category) : rows;
}

/**
 * Companies where a contact exists, keyed by normalised slug.
 *
 * Slugified on both sides so "Nubank" matches "Nubank Ltd" — the same
 * normalisation the deduper uses, for the same reason.
 */
export async function companiesWithContacts(candidateId: number): Promise<Map<string, string[]>> {
  const db = getDb();
  const rows = await db
    .select({
      name: targetAccount.name,
      company: targetAccount.company,
      category: targetAccount.category,
    })
    .from(targetAccount)
    .where(
      and(eq(targetAccount.candidateId, candidateId), sql`${targetAccount.company} is not null`),
    );

  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.company) continue;
    const slug = slugifyCompany(row.company);
    if (!slug) continue;
    const label = row.category === "former" ? `${row.name} (ex-colega)` : row.name;
    map.set(slug, [...(map.get(slug) ?? []), label]);
  }
  return map;
}

export type ReferralOpportunity = {
  jobId: number;
  title: string;
  companyName: string;
  url: string;
  applyUrl: string | null;
  fit: number;
  cluster: string | null;
  status: string | null;
  contacts: string[];
};

/**
 * Open jobs at companies where a contact exists, best fit first.
 *
 * This is the report that should drive a week's applications. A referral at a
 * decent-fit company beats a cold application at a perfect-fit one, and until
 * now the funnel had no way of telling you that.
 */
export async function referralOpportunities(
  candidateId: number,
  minFit = 45,
): Promise<ReferralOpportunity[]> {
  const db = getDb();
  const contacts = await companiesWithContacts(candidateId);
  if (contacts.size === 0) return [];

  const rows = await db
    .select({
      jobId: job.id,
      title: job.title,
      companyName: job.companyName,
      url: job.url,
      applyUrl: job.applyUrl,
      fit: sql<number>`coalesce((select s.fit from production.job_score s where s.candidate_id = ${candidateId} and s.job_id = ${job.id} and ${primaryScoreFilter("s")}), 0)`,
      cluster: sql<string | null>`(select s.cluster from production.job_score s where s.candidate_id = ${candidateId} and s.job_id = ${job.id} and ${primaryScoreFilter("s")})`,
      status: application.status,
    })
    .from(job)
    .leftJoin(
      application,
      and(eq(application.jobId, job.id), eq(application.candidateId, candidateId)),
    )
    .where(sql`${job.closedAt} is null`);

  return rows
    .map((r) => ({ ...r, contacts: contacts.get(slugifyCompany(r.companyName)) ?? [] }))
    .filter((r) => r.contacts.length > 0 && r.fit >= minFit)
    .sort((a, b) => b.fit - a.fit);
}

/* -------------------------------------------------------------------------- */
/* Seeding from work history                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Companies where the candidate has actually worked or delivered.
 *
 * These are not aspirational targets — they are the strongest referral surface
 * he has, and they were sitting unused in the CV. A former employer or client
 * opening a role is the closest thing to a warm introduction that exists, and
 * the system had no way to notice it.
 *
 * Sourced from CV/ATS Curriculum Andreus Timm 2026-07 - EN.md.
 */
const WORK_HISTORY: Array<{ company: string; note: string }> = [
  { company: "The Hackett Group", note: "Cliente atual via Master Timm — Senior AI Software Architect" },
  { company: "Quilt Software", note: "Cliente via Master Timm — modernização do POS legado" },
  { company: "PosNation", note: "Mesma operação da Quilt Software" },
  { company: "MPC", note: "Cliente via Revelo — User Management System em Laravel 12" },
  { company: "Mobile Price Card", note: "Mesma empresa que MPC" },
  { company: "Regal Rexnord", note: "Tech Lead — upgrade PHP 5.6 → 8.4" },
  { company: "Amber Studio", note: "Via Willdom — backend de jogos" },
  { company: "SciPlay", note: "Jackpot Party — sistema de indicação" },
  { company: "BairesDev", note: "Senior Software Engineer & IT Mentor, 2021–2023" },
  { company: "ADT Solar", note: "Via BairesDev — plataforma SaaS solar" },
  { company: "Sunpro", note: "Mesma operação da ADT Solar" },
  { company: "Red Ventures", note: "Via BairesDev — fintech e mortgage" },
  { company: "Revelo", note: "Marketplace por onde chegou à MPC" },
  { company: "Consulta Já", note: "CTO & sócio, 2014–2017" },
];

export type SeedResult = { inserted: number; updated: number };

/**
 * Idempotent: re-running refreshes notes but never duplicates.
 *
 * `WORK_HISTORY` is the owner's CV, so only the owner's candidate should be
 * seeded — the CLI passes its active candidate, and nothing on the web calls
 * this.
 */
export async function seedWorkHistory(candidateId: number): Promise<SeedResult> {
  let inserted = 0;
  let updated = 0;

  for (const entry of WORK_HISTORY) {
    const db = getDb();
    const existing = await db
      .select({ id: targetAccount.id })
      .from(targetAccount)
      .where(
        and(
          eq(targetAccount.candidateId, candidateId),
          eq(targetAccount.name, entry.company),
          eq(targetAccount.category, "former"),
        ),
      )
      .limit(1);

    const found = existing[0];
    if (found) {
      await db
        .update(targetAccount)
        .set({ notes: entry.note, company: entry.company })
        .where(eq(targetAccount.id, found.id));
      updated++;
    } else {
      await db.insert(targetAccount).values({
        candidateId,
        name: entry.company,
        company: entry.company,
        category: "former",
        notes: entry.note,
        status: "identified",
      });
      inserted++;
    }
  }

  return { inserted, updated };
}
