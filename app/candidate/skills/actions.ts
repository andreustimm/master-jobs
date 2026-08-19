"use server";

import { revalidatePath } from "next/cache";
import { guardOwnCandidate } from "../../auth";
import { syncCandidateFromProfile } from "../../../src/core/candidate.ts";
import { currentDocument } from "../../../src/core/candidate.ts";
import { auditSkill, seedCatalog } from "../../../src/core/skills.ts";
import { skillExtraction } from "../../../src/contexts/skills/index.ts";

export async function auditAction(formData: FormData) {
  // Auditing one's own detections is candidate work. Curating the GLOBAL
  // catalogue is `skill:audit` and belongs to an admin — separate actions,
  // separate permissions.
  const { candidateId: scoped } = await guardOwnCandidate("candidate:write");
  void scoped;
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  if (status !== "confirmed" && status !== "rejected") throw new Error("status inválido");
  await auditSkill(id, status, { by: "self" });
  revalidatePath("/candidate/skills");
}

/**
 * Re-run detection against the current CV.
 *
 * Skills a human already audited are preserved — re-detecting must never undo
 * a decision.
 */
export async function detectAction() {
  await guardOwnCandidate("candidate:write");
  await seedCatalog();
  const candidateId = await syncCandidateFromProfile();
  const doc = await currentDocument(candidateId, "cv");
  if (!doc) throw new Error("Nenhum currículo salvo.");
  await skillExtraction({ candidateId, text: doc.content, source: "cv" });
  revalidatePath("/candidate/skills");
}
