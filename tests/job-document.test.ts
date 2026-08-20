import { describe, expect, it } from "vitest";
import {
  JobDocumentError,
  MAX_JOB_DOCUMENT_BYTES,
  extractJobDocument,
} from "../src/core/ingest/job-document.ts";

const LONG_TEXT =
  "Senior platform role responsible for TypeScript services, distributed systems, cloud architecture, observability, and technical leadership across a remote engineering organisation.";

async function errorCode(input: Parameters<typeof extractJobDocument>[0]) {
  try {
    await extractJobDocument(input);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(JobDocumentError);
    return (error as JobDocumentError).code;
  }
}

describe("job document extraction", () => {
  it("decodes UTF-8 text and normalises line endings", async () => {
    const result = await extractJobDocument({
      name: "job.txt",
      type: "text/plain",
      data: new TextEncoder().encode(`${LONG_TEXT}\r\n\r\nRemote in Brazil.`),
    });

    expect(result.format).toBe("text");
    expect(result.pages).toBeNull();
    expect(result.text).toContain("\n\nRemote in Brazil.");
    expect(result.sourceFilename).toBe("job.txt");
  });

  it("preserves Markdown as text", async () => {
    const result = await extractJobDocument({
      name: "role.md",
      data: new TextEncoder().encode(`# Role\n\n${LONG_TEXT}`),
    });
    expect(result.format).toBe("markdown");
    expect(result.text).toContain("# Role");
  });

  it("rejects unsupported, binary, short and oversized files with stable codes", async () => {
    expect(await errorCode({ name: "role.txt", data: new Uint8Array() })).toBe("file-empty");
    expect(
      await errorCode({ name: "role.docx", data: new TextEncoder().encode(LONG_TEXT) }),
    ).toBe("unsupported-file");
    expect(await errorCode({ name: "role.txt", data: new Uint8Array([0xff, 0xfe]) })).toBe(
      "file-not-text",
    );
    expect(
      await errorCode({ name: "role.txt", data: new TextEncoder().encode("too short") }),
    ).toBe("description-too-short");
    expect(
      await errorCode({
        name: "role.txt",
        data: new Uint8Array(MAX_JOB_DOCUMENT_BYTES + 1),
      }),
    ).toBe("file-too-large");
  });

  it("routes PDF files through the PDF extractor", async () => {
    const emptyPdf =
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
      "trailer<</Root 1 0 R>>";
    expect(
      await errorCode({
        name: "role.pdf",
        type: "application/pdf",
        data: new TextEncoder().encode(emptyPdf),
      }),
    ).toBe("description-too-short");
  });
});
