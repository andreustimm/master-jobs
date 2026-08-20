/**
 * Text extraction for a manually supplied job description.
 *
 * The binary is deliberately transient: the job table stores the extracted
 * text and enough provenance to audit it, never the uploaded file. That keeps
 * the database useful without turning it into an unbounded document store.
 */
import { extractPdfText } from "../pdf.ts";

export const MAX_JOB_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_JOB_DESCRIPTION_CHARS = 200_000;
export const MIN_JOB_DESCRIPTION_CHARS = 100;

export type JobDocumentErrorCode =
  | "file-empty"
  | "file-too-large"
  | "unsupported-file"
  | "file-not-text"
  | "description-too-short"
  | "description-too-long"
  | "extraction-failed";

export class JobDocumentError extends Error {
  readonly code: JobDocumentErrorCode;

  constructor(code: JobDocumentErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "JobDocumentError";
    this.code = code;
  }
}

export type JobDocumentExtraction = {
  text: string;
  format: "pdf" | "text" | "markdown";
  pages: number | null;
  warnings: string[];
  sourceFilename: string;
};

type JobDocumentInput = {
  name: string;
  type?: string;
  data: Uint8Array | ArrayBuffer;
};

function bytesOf(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function safeFilename(name: string): string {
  return name.split(/[\\/]/).pop()?.slice(0, 255) || "job-description";
}

function extensionOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name.toLowerCase());
  return match?.[1] ?? "";
}

function assertTextLength(text: string): void {
  if (text.length < MIN_JOB_DESCRIPTION_CHARS) {
    throw new JobDocumentError("description-too-short");
  }
  if (text.length > MAX_JOB_DESCRIPTION_CHARS) {
    throw new JobDocumentError("description-too-long");
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/\r\n?/g, "\n")
      .trim();
    if (text.includes("\0")) throw new JobDocumentError("file-not-text");
    return text;
  } catch (error) {
    if (error instanceof JobDocumentError) throw error;
    throw new JobDocumentError("file-not-text", error);
  }
}

/** Extracts only formats whose semantics are deterministic and offline. */
export async function extractJobDocument(
  input: JobDocumentInput,
): Promise<JobDocumentExtraction> {
  const bytes = bytesOf(input.data);
  if (bytes.byteLength === 0) throw new JobDocumentError("file-empty");
  if (bytes.byteLength > MAX_JOB_DOCUMENT_BYTES) {
    throw new JobDocumentError("file-too-large");
  }

  const sourceFilename = safeFilename(input.name);
  const extension = extensionOf(sourceFilename);

  if (extension === "pdf") {
    try {
      const extracted = await extractPdfText(bytes, { documentKind: "job" });
      assertTextLength(extracted.text);
      return {
        text: extracted.text,
        format: "pdf",
        pages: extracted.pages,
        warnings: extracted.warnings,
        sourceFilename,
      };
    } catch (error) {
      if (error instanceof JobDocumentError) throw error;
      throw new JobDocumentError("extraction-failed", error);
    }
  }

  if (extension !== "txt" && extension !== "md" && extension !== "markdown") {
    throw new JobDocumentError("unsupported-file");
  }

  const text = decodeUtf8(bytes);
  assertTextLength(text);
  return {
    text,
    format: extension === "txt" ? "text" : "markdown",
    pages: null,
    warnings: [],
    sourceFilename,
  };
}
