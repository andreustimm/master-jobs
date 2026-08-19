/**
 * Use case: extract the candidate's skills from a document.
 *
 * Orchestration only. It fetches the catalogue through a port, calls the pure
 * extractor, and persists through a port — so the interesting logic stays
 * testable without a database and this file stays boring, which is what an
 * application service should be.
 */
import { extractSkills, type ExtractOptions } from "../domain/extractor.ts";
import type { Detection } from "../domain/types.ts";
import type { CandidateSkillPort, SkillCatalogPort } from "../ports.ts";

export type ExtractSkillsInput = {
  candidateId: number;
  text: string;
  /** cv | profile | manual | inferred */
  source?: string;
  options?: ExtractOptions;
};

export type ExtractSkillsResult = {
  detections: Detection[];
  added: number;
  refreshed: number;
  /** Rows a human already audited, left untouched. */
  preserved: number;
};

export type ExtractSkillsDeps = {
  catalog: SkillCatalogPort;
  store: CandidateSkillPort;
};

/**
 * > **Invariante:** re-running extraction never undoes a human decision. A row
 * > already `confirmed` or `rejected` is preserved as-is; only `detected` rows
 * > get their evidence and counts refreshed. Without this, every re-run would
 * > silently discard the audit work — the exact failure that makes people stop
 * > trusting a tool.
 */
export async function extractCandidateSkills(
  input: ExtractSkillsInput,
  deps: ExtractSkillsDeps,
): Promise<ExtractSkillsResult> {
  const catalog = await deps.catalog.all();
  const detections = extractSkills(input.text, catalog, input.options);

  const existing = await deps.store.existing(input.candidateId);
  const bySlug = new Map(existing.map((e) => [e.skillSlug, e.status]));

  let added = 0;
  let refreshed = 0;
  let preserved = 0;

  for (const detection of detections) {
    const status = bySlug.get(detection.skill.slug);

    if (status === undefined) {
      await deps.store.add(input.candidateId, detection, input.source ?? "cv");
      added++;
    } else if (status === "detected") {
      await deps.store.refresh(input.candidateId, detection);
      refreshed++;
    } else {
      preserved++;
    }
  }

  return { detections, added, refreshed, preserved };
}
