"use server";

import { revalidatePath } from "next/cache";
import { ensureCandidate, saveDocument, syncCandidateFromProfile } from "../../src/core/candidate.ts";

/**
 * Save the CV the candidate pasted.
 *
 * Versioned, never overwritten — knowing what was actually sent to a company
 * three weeks ago is the difference between answering an interview question
 * and guessing.
 */
export async function saveCvAction(formData: FormData) {
  const content = String(formData.get("content") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || `CV ${new Date().toISOString().slice(0, 10)}`;

  if (content.length < 100) {
    throw new Error("O texto é curto demais para ser um currículo (mínimo 100 caracteres).");
  }

  // Identity comes from profile.yaml so the two never drift on who this is.
  const candidateId = await syncCandidateFromProfile().catch(() =>
    ensureCandidate({ name: "Candidato" }),
  );

  await saveDocument({ candidateId, kind: "cv", label, content, format: "text" });

  revalidatePath("/candidate");
}

/**
 * Import a CV from an uploaded PDF.
 *
 * Extraction is not trusted: the result is saved as a new version like any
 * other, so the candidate reviews it in the editor before it feeds skill
 * detection. A scanned CV has no text layer at all, and failing loudly here is
 * better than silently storing three lines of header.
 */
export async function importPdfAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Selecione um arquivo PDF.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Arquivo acima de 10 MB. Currículo não deveria chegar perto disso.");
  }

  const { extractPdfText } = await import("../../src/core/pdf.ts");
  const extracted = await extractPdfText(await file.arrayBuffer());

  if (extracted.text.trim().length < 100) {
    throw new Error(
      "Quase nenhum texto no PDF. Provavelmente é digitalizado (imagem), sem camada de texto — cole o conteúdo manualmente.",
    );
  }

  const candidateId = await syncCandidateFromProfile().catch(() =>
    ensureCandidate({ name: "Candidato" }),
  );

  await saveDocument({
    candidateId,
    kind: "cv",
    label: file.name.replace(/\.pdf$/i, ""),
    content: extracted.text,
    format: "text",
  });

  revalidatePath("/candidate");
}
