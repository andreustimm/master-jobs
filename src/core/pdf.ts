/**
 * PDF text extraction for candidate documents and job descriptions.
 *
 * The extraction itself is one library call. Everything else in this file is
 * cleanup, and the cleanup is the part that matters: this text feeds skill
 * detection and the vocabulary gap analysis, so garbage in is a wrong answer
 * out — a mangled "Kuber-\nnetes" is a skill the candidate silently loses.
 *
 * `unpdf` is used because it is pure JavaScript. A native binding would break
 * the "no native dependency" rule in CLAUDE.md, which exists so the project
 * stays deployable on a serverless runtime.
 */
import { extractText, getDocumentProxy } from "unpdf";

export type PdfExtraction = {
  text: string;
  pages: number;
  /** Problems worth telling the user about rather than silently swallowing. */
  warnings: string[];
};

/**
 * Rejoins words split across a line break by hyphenation.
 *
 * A CV rendered at a narrow column width produces "observ-\nability", and the
 * word-boundary matcher would then find neither half. This is the single
 * highest-impact cleanup step for our purposes.
 */
function dehyphenate(text: string): string {
  return text.replace(/([a-zà-ÿ])-\n([a-zà-ÿ])/g, "$1$2");
}

/**
 * Turns a hard-wrapped paragraph back into one line.
 *
 * PDF extraction breaks a line wherever the renderer did. A line that ends
 * mid-sentence and continues in lowercase was never a real break — joining
 * them is what lets sentence-level evidence ("used X to deliver Y") survive,
 * and that evidence is what the `applied` strategy weighs highest.
 */
function unwrapParagraphs(text: string): string {
  return text.replace(/([^\n.:;•\-–—])\n(?=[a-zà-ÿ(])/g, "$1 ");
}

/**
 * Normalises the several bullet glyphs a PDF may carry into "- ".
 *
 * Bullets matter beyond cosmetics: the extractor's section detection and its
 * "used in N experience bullets" rationale both key off line starts.
 */
function normalizeBullets(text: string): string {
  return text
    .replace(/^[ \t]*[•▪◦‣·]\s*/gm, "- ")
    .replace(/^[ \t]*[–—]\s+/gm, "- ");
}

function collapseWhitespace(text: string): string {
  return text
    // Non-breaking and zero-width characters survive extraction and break
    // literal term matching in ways that are invisible on screen.
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanPdfText(raw: string): string {
  return collapseWhitespace(normalizeBullets(unwrapParagraphs(dehyphenate(raw))));
}

/** Heuristics for "this extraction produced something unusable". */
function inspect(text: string, pages: number, documentKind: "cv" | "job"): string[] {
  const warnings: string[] = [];

  if (text.length < 200) {
    // Almost always a scanned document: the pages are images and carry no text layer.
    warnings.push(
      "Quase nenhum texto extraído. O PDF provavelmente é digitalizado (imagem) — " +
        "não há camada de texto para ler. Cole o conteúdo manualmente.",
    );
  }

  const letters = text.replace(/[^a-zà-ÿ]/gi, "").length;
  if (text.length > 200 && letters / text.length < 0.5) {
    warnings.push("Texto extraído com pouca proporção de letras — a formatação pode ter se perdido.");
  }

  // A CV that extracts as one giant line usually means the layout was columnar
  // and the reading order is scrambled.
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 0 && text.length / lines.length > 400) {
    warnings.push("Linhas muito longas — o PDF pode ter layout em colunas e a ordem de leitura pode estar trocada.");
  }

  if (documentKind === "cv" && pages > 6) {
    warnings.push(`${pages} páginas. Currículos longos diluem o vocabulário na análise de lacuna.`);
  }

  return warnings;
}

export async function extractPdfText(
  data: Uint8Array | ArrayBuffer,
  options: { documentKind?: "cv" | "job" } = {},
): Promise<PdfExtraction> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  const pdf = await getDocumentProxy(bytes);
  // Per-page extraction, then joined by us: `mergePages` concatenates without a
  // separator, which glues the last word of one page to the first of the next.
  const { text, totalPages } = await extractText(pdf, { mergePages: false });

  const pages = Array.isArray(text) ? text : [text];
  const cleaned = cleanPdfText(pages.join("\n\n"));

  return {
    text: cleaned,
    pages: totalPages,
    warnings: inspect(cleaned, totalPages, options.documentKind ?? "cv"),
  };
}
