import { z } from "zod";
import { currentDocument } from "../../../core/candidate.ts";
import { getJobScoringDetail } from "../../../core/db/repo.ts";
import {
  JobDocumentError,
  MAX_JOB_DESCRIPTION_CHARS,
  MIN_JOB_DESCRIPTION_CHARS,
  extractJobDocument,
} from "../../../core/ingest/job-document.ts";
import { addManualDescriptionJob } from "../../../core/ingest/manual.ts";
import { publicPostingUrl } from "../../../core/job-url.ts";
import { scoreOne } from "../../../core/scoring/apply.ts";
import { jobVocabularyComparison } from "../../skills/index.ts";

export type ComparisonField =
  | "title"
  | "companyName"
  | "location"
  | "url"
  | "description"
  | "file";

export type ComparisonErrorCode =
  | "required"
  | "too-long"
  | "invalid-url"
  | "missing-source"
  | "multiple-sources"
  | "file-empty"
  | "file-too-large"
  | "unsupported-file"
  | "file-not-text"
  | "description-too-short"
  | "description-too-long"
  | "extraction-failed"
  | "unexpected";

export class ComparisonInputError extends Error {
  readonly field?: ComparisonField;
  readonly code: ComparisonErrorCode;

  constructor(code: ComparisonErrorCode, field?: ComparisonField) {
    super(`Invalid comparison input: ${field ?? "form"}.${code}`);
    this.name = "ComparisonInputError";
    this.field = field;
    this.code = code;
  }
}

const optionalField = (max: number) => z.string().trim().max(max, "too-long");
const inputSchema = z.object({
  title: z.string().trim().min(2, "required").max(180, "too-long"),
  companyName: z.string().trim().min(2, "required").max(180, "too-long"),
  location: optionalField(240),
  url: optionalField(2_000).refine((value) => {
    if (!value) return true;
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "invalid-url"),
  description: optionalField(MAX_JOB_DESCRIPTION_CHARS).refine(
    (value) => value.length === 0 || value.length >= MIN_JOB_DESCRIPTION_CHARS,
    "description-too-short",
  ),
});

export type ManualComparisonInput = {
  title: string;
  companyName: string;
  location: string;
  url: string;
  description: string;
  document?: { name: string; type: string; data: ArrayBuffer };
};

function inputError(error: z.ZodError): ComparisonInputError {
  const issue = error.issues[0];
  const field = issue?.path[0];
  const code = issue?.message;
  const knownField = typeof field === "string" && [
    "title", "companyName", "location", "url", "description", "file",
  ].includes(field)
    ? field as ComparisonField
    : undefined;
  const knownCode = code === "required" || code === "too-long" ||
      code === "invalid-url" || code === "description-too-short"
    ? code
    : "unexpected";
  return new ComparisonInputError(knownCode, knownField);
}

/** Validation, extraction, observation and canonical scoring in one use case. */
export async function createManualComparison(
  candidateId: number,
  input: ManualComparisonInput,
): Promise<{ jobId: number }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw inputError(parsed.error);
  const hasText = parsed.data.description.length > 0;
  if (!input.document && !hasText) throw new ComparisonInputError("missing-source");
  if (input.document && hasText) throw new ComparisonInputError("multiple-sources");

  let description = parsed.data.description;
  let sourceFilename: string | undefined;
  let documentFormat: "pdf" | "text" | "markdown" | undefined;
  let pages: number | null | undefined;
  let extractionWarnings: string[] | undefined;
  if (input.document) {
    try {
      const extracted = await extractJobDocument(input.document);
      description = extracted.text;
      sourceFilename = extracted.sourceFilename;
      documentFormat = extracted.format;
      pages = extracted.pages;
      extractionWarnings = extracted.warnings;
    } catch (error) {
      if (error instanceof JobDocumentError) {
        throw new ComparisonInputError(error.code, "file");
      }
      throw new ComparisonInputError("extraction-failed", "file");
    }
  }

  const observed = await addManualDescriptionJob({
    title: parsed.data.title,
    companyName: parsed.data.companyName,
    description,
    location: parsed.data.location || undefined,
    url: parsed.data.url || undefined,
    inputMethod: input.document ? "file" : "paste",
    sourceFilename,
    documentFormat,
    pages,
    extractionWarnings,
  });
  if (!await scoreOne(candidateId, observed.jobId)) {
    throw new ComparisonInputError("unexpected");
  }
  return { jobId: observed.jobId };
}

type ManualMetadata = {
  sourceFilename: string | null;
  documentFormat: string | null;
  pages: number | null;
  warningCount: number;
};

function metadataFrom(raw: unknown): ManualMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const nested = root.manualComparison;
  const data = root.manual === true
    ? root
    : nested && typeof nested === "object"
      ? nested as Record<string, unknown>
      : null;
  if (!data || data.manual !== true) return null;
  return {
    sourceFilename: typeof data.sourceFilename === "string" ? data.sourceFilename : null,
    documentFormat: typeof data.documentFormat === "string" ? data.documentFormat : null,
    pages: typeof data.pages === "number" ? data.pages : null,
    warningCount: Array.isArray(data.extractionWarnings) ? data.extractionWarnings.length : 0,
  };
}

/** Typed read model; the UI never interprets persistence JSON. */
export async function getComparisonDetail(candidateId: number, jobId: number) {
  const [cv, detail] = await Promise.all([
    currentDocument(candidateId, "cv"),
    getJobScoringDetail(candidateId, jobId),
  ]);
  if (!detail) return null;
  const vocabulary = cv
    ? await jobVocabularyComparison({
        cvText: cv.content,
        jobText: `${detail.job.title}\n${detail.job.descriptionText ?? ""}`,
      })
    : null;
  return {
    ...detail,
    cv,
    vocabulary,
    metadata: metadataFrom(detail.job.raw),
    manualJob: detail.job.sourceId.startsWith("manual:"),
    // A URL, e não um booleano dizendo que existe uma.
    //
    // O campo devolvia `isPublicJobUrl(...)` — um `true`/`false` sob um nome que
    // promete endereço. O consumidor de hoje trata como bandeira e funciona,
    // mas o nome é armadilha: quem escrever `href={detail.externalUrl}` gera
    // `href="true"`, e o link leva a lugar nenhum sem quebrar nada. Pior, o
    // mesmo nome já designa uma URL de verdade em `app/referrals/page.tsx`.
    //
    // `publicPostingUrl` devolve a URL ou `null`, e `null` continua sendo falso
    // — quem usava como bandeira não muda de comportamento.
    externalUrl: publicPostingUrl(detail.job),
  };
}
