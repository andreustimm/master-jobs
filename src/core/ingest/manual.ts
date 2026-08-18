/**
 * Adding a job by hand.
 *
 * Three paths, in order of how much we can recover automatically:
 *  1. The URL belongs to an ATS we have an adapter for -> fetch the real
 *     posting and store it exactly as a sync would have.
 *  2. The URL is recognisable but unfetchable (LinkedIn, Workday, Indeed) ->
 *     store what the user gives us, flagged so it is obvious the description
 *     is partial and the score is therefore weaker.
 *  3. Anything else -> same as 2.
 *
 * A manually added job is a first-class row: same table, same fingerprint, same
 * scorer. That matters because it must dedupe against the same posting arriving
 * later through a sync.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { company, job, source } from "../db/schema.ts";
import { getAdapter } from "../sources/registry.ts";
import type { RawJob } from "../sources/types.ts";
import { contentHash, fingerprint, slugifyCompany, toIsoDate } from "./normalize.ts";
import { describeUnfetchable, detectJobUrl } from "./detect.ts";

export type ManualJobInput = {
  url: string;
  title?: string;
  companyName?: string;
  location?: string;
  description?: string;
  postedAt?: string;
  notes?: string;
};

export type AddJobResult = {
  jobId: number;
  created: boolean;
  /** How the posting was resolved. */
  via: "ats" | "manual";
  kind: string;
  title: string;
  companyName: string;
  /** Set when the URL was recognised but could not be fetched. */
  unfetchableHost?: string;
  warnings: string[];
};

export async function ensureImportSource(id: string, kind: string, handle: string, label: string) {
  const db = getDb();
  await db
    .insert(source)
    .values({
      id,
      kind,
      handle,
      label,
      enabled: false, // manual sources are not swept by `jobs sync`
      rationale: "Criada automaticamente por `jho jobs add`",
    })
    .onConflictDoNothing({ target: source.id });
}

async function ensureCompany(name: string): Promise<number | null> {
  const db = getDb();
  const slug = slugifyCompany(name);
  if (!slug) return null;
  await db.insert(company).values({ slug, name }).onConflictDoNothing({ target: company.slug });
  const found = await db.select({ id: company.id }).from(company).where(eq(company.slug, slug)).limit(1);
  return found[0]?.id ?? null;
}

export async function upsertRawJob(
  raw: RawJob,
  sourceId: string,
): Promise<{ jobId: number; created: boolean }> {
  const db = getDb();
  const fp = fingerprint(raw);
  const stamp = new Date().toISOString();

  const existing = await db
    .select({ id: job.id })
    .from(job)
    .where(eq(job.fingerprint, fp))
    .limit(1);

  const companyId = await ensureCompany(raw.companyName);
  const values = {
    fingerprint: fp,
    contentHash: contentHash(raw),
    sourceId,
    externalId: raw.externalId,
    companyId,
    companyName: raw.companyName,
    title: raw.title,
    descriptionHtml: raw.descriptionHtml ?? null,
    descriptionText: raw.descriptionText ?? null,
    locationRaw: raw.locationRaw ?? null,
    remote: raw.remote ?? null,
    employmentType: raw.employmentType ?? null,
    seniorityRaw: raw.seniorityRaw ?? null,
    compMin: raw.compMin ?? null,
    compMax: raw.compMax ?? null,
    compCurrency: raw.compCurrency ?? null,
    compPeriod: raw.compPeriod ?? null,
    url: raw.url,
    applyUrl: raw.applyUrl ?? raw.url,
    postedAt: toIsoDate(raw.postedAt),
    lastSeenAt: stamp,
    raw: raw.raw,
  };

  const found = existing[0];
  if (found) {
    // Re-adding a known posting reopens it rather than duplicating.
    await db.update(job).set({ ...values, closedAt: null }).where(eq(job.id, found.id));
    return { jobId: found.id, created: false };
  }

  const inserted = await db
    .insert(job)
    .values({ ...values, firstSeenAt: stamp })
    .returning({ id: job.id });
  const created = inserted[0];
  if (!created) throw new Error("insert returned no row");
  return { jobId: created.id, created: true };
}

export async function addJob(input: ManualJobInput): Promise<AddJobResult> {
  const warnings: string[] = [];
  const detected = detectJobUrl(input.url);

  /* ---- Path 1: a board we can actually read -------------------------- */
  if (detected) {
    const sourceId = `${detected.kind}:${detected.handle}`;

    // A board already in config/sources.yaml carries a curated company name.
    // Deriving one from the URL handle would downgrade "TextLayer" to
    // "Textlayer" and, worse, change the fingerprint of every job on it.
    const configured = await getDb()
      .select({ label: source.label })
      .from(source)
      .where(eq(source.id, sourceId))
      .limit(1);
    const label = input.companyName ?? configured[0]?.label ?? detected.label;

    await ensureImportSource(sourceId, detected.kind, detected.handle, label);

    try {
      const adapter = getAdapter(detected.kind);
      const { jobs } = await adapter.fetchJobs({
        kind: detected.kind,
        handle: detected.handle,
        label,
      });

      // Prefer the exact posting; fall back to a URL match.
      const match =
        (detected.externalId && jobs.find((j) => j.externalId === detected.externalId)) ||
        jobs.find((j) => j.url === input.url || j.applyUrl === input.url);

      if (match) {
        const { jobId, created } = await upsertRawJob(match, sourceId);
        return {
          jobId,
          created,
          via: "ats",
          kind: detected.kind,
          title: match.title,
          companyName: match.companyName,
          warnings,
        };
      }

      warnings.push(
        `A vaga não apareceu no board ${detected.kind}:${detected.handle} (${jobs.length} vagas listadas) — pode ter sido fechada. Registrando manualmente.`,
      );
    } catch (error) {
      warnings.push(
        `Falha ao consultar ${detected.kind}:${detected.handle}: ${error instanceof Error ? error.message : String(error)}. Registrando manualmente.`,
      );
    }
  }

  /* ---- Paths 2 and 3: store what we were given ----------------------- */
  const host = (() => {
    try {
      return new URL(input.url).hostname.replace(/^www\./, "");
    } catch {
      throw new Error(`URL inválida: ${input.url}`);
    }
  })();

  const unfetchableHost = describeUnfetchable(input.url) ?? undefined;
  if (unfetchableHost && !detected) {
    warnings.push(
      `${unfetchableHost} não expõe API pública de vaga. O score usará só o que você informar — passe --description para melhorar a pontuação.`,
    );
  }

  if (!input.title) {
    throw new Error(
      "Não consegui resolver a vaga pela URL. Informe pelo menos --title e --company.",
    );
  }
  if (!input.companyName) {
    throw new Error("Informe --company para uma vaga registrada manualmente.");
  }

  const sourceId = `manual:${host}`;
  await ensureImportSource(sourceId, "manual", host, unfetchableHost ?? host);

  const raw: RawJob = {
    externalId: input.url,
    companyName: input.companyName,
    title: input.title,
    url: input.url,
    applyUrl: input.url,
    locationRaw: input.location ?? null,
    remote: null,
    descriptionText: input.description ?? null,
    descriptionHtml: null,
    postedAt: input.postedAt ?? null,
    raw: { manual: true, addedAt: new Date().toISOString(), notes: input.notes ?? null },
  };

  if (!input.description) {
    warnings.push(
      "Sem descrição, o componente de keywords fica em zero e o fit sai artificialmente baixo.",
    );
  }

  const { jobId, created } = await upsertRawJob(raw, sourceId);
  return {
    jobId,
    created,
    via: "manual",
    kind: "manual",
    title: raw.title,
    companyName: raw.companyName,
    unfetchableHost,
    warnings,
  };
}
