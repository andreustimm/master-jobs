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
