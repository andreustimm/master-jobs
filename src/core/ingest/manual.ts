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
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { source } from "../db/schema.ts";
import { getAdapter } from "../sources/registry.ts";
import type { RawJob } from "../sources/types.ts";
import { fingerprint } from "./normalize.ts";
import { describeUnfetchable, detectJobUrl } from "./detect.ts";
import {
  observeRawJob,
  type JobObservation,
  type JobObservationOutcome,
  type ObserveRawJobOptions,
} from "./observe.ts";

export type ManualJobInput = {
  url: string;
  title?: string;
  companyName?: string;
  location?: string;
  description?: string;
  postedAt?: string;
  notes?: string;
};

/**
 * A job supplied as text rather than resolved from an ATS.
 *
 * This is separate from `ManualJobInput`: the CLI path starts from a required
 * URL and tries a public adapter first, while the compare screen starts from
 * content and may have no public URL at all.
 */
export type ManualDescriptionJobInput = {
  title: string;
  companyName: string;
  description: string;
  location?: string;
  url?: string;
  inputMethod: "paste" | "file";
  sourceFilename?: string;
  documentFormat?: "pdf" | "text" | "markdown";
  pages?: number | null;
  extractionWarnings?: string[];
};

export type AddJobResult = {
  jobId: number;
  created: boolean;
  outcome: JobObservationOutcome;
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
      rationale: "Criada automaticamente por ingestão manual",
    })
    .onConflictDoNothing({ target: source.id });
}

/** @deprecated Use `observeRawJob`; kept as a compatibility facade. */
export async function upsertRawJob(
  raw: RawJob,
  sourceId: string,
  options: ObserveRawJobOptions = {},
): Promise<JobObservation & { created: boolean }> {
  const observation = await observeRawJob(raw, sourceId, options);
  return { ...observation, created: observation.outcome === "inserted" };
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
        const observation = await observeRawJob(match, sourceId);
        return {
          jobId: observation.jobId,
          created: observation.outcome === "inserted",
          outcome: observation.outcome,
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

  const observation = await observeRawJob(raw, sourceId);
  return {
    jobId: observation.jobId,
    created: observation.outcome === "inserted",
    outcome: observation.outcome,
    via: "manual",
    kind: "manual",
    title: raw.title,
    companyName: raw.companyName,
    unfetchableHost,
    warnings,
  };
}

/**
 * Stores pasted or uploaded text as a first-class job.
 *
 * The synthetic URL exists only because the schema requires a stable origin.
 * It is never rendered as an external link. Comparison jobs use an explicit
 * fingerprint namespace: a user's pasted observation must never overwrite or
 * reopen a canonical ATS observation that happens to share company/title/place.
 */
export async function addManualDescriptionJob(
  input: ManualDescriptionJobInput,
): Promise<AddJobResult> {
  const title = input.title.trim();
  const companyName = input.companyName.trim();
  const description = input.description.trim();
  const location = input.location?.trim() || null;

  if (!title) throw new Error("Informe o cargo da vaga manual.");
  if (!companyName) throw new Error("Informe a empresa da vaga manual.");
  if (!description) throw new Error("Informe a descrição da vaga manual.");

  let publicUrl: string | null = null;
  let handle = "local";
  if (input.url?.trim()) {
    const parsed = new URL(input.url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("A URL pública precisa usar HTTP ou HTTPS.");
    }
    publicUrl = parsed.toString();
    handle = parsed.hostname.replace(/^www\./, "");
  }

  const identity: RawJob = {
    externalId: "pending",
    companyName,
    title,
    url: "manual://pending",
    locationRaw: location,
    descriptionText: description,
    raw: {},
  };
  const stableId = fingerprint(identity);
  const comparisonFingerprint = createHash("sha256")
    .update(`manual-comparison|${stableId}`)
    .digest("hex")
    .slice(0, 32);
  const canonicalUrl = publicUrl ?? `manual://local/${stableId}`;
  const sourceId = `manual:${handle}`;

  const warnings = input.extractionWarnings ?? [];
  const comparisonMetadata = {
    manual: true,
    addedAt: new Date().toISOString(),
    inputMethod: input.inputMethod,
    sourceFilename: input.sourceFilename ?? null,
    documentFormat: input.documentFormat ?? null,
    pages: input.pages ?? null,
    extractionWarnings: warnings,
    publicUrl,
  };
  const raw: RawJob = {
    ...identity,
    externalId: canonicalUrl,
    url: canonicalUrl,
    applyUrl: canonicalUrl,
    raw: comparisonMetadata,
  };

  await ensureImportSource(sourceId, "manual", handle, publicUrl ? handle : "Manual");
  const observation = await observeRawJob(raw, sourceId, {
    fingerprintOverride: comparisonFingerprint,
  });
  return {
    jobId: observation.jobId,
    created: observation.outcome === "inserted",
    outcome: observation.outcome,
    via: "manual",
    kind: "manual",
    title,
    companyName,
    warnings,
  };
}
