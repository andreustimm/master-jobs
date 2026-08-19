/**
 * Ports for the skills context.
 *
 * Two exist, and only two, because only two absorb a variation that is real:
 *
 *  - `SkillCatalogPort` — today the catalogue is seeded from a file into
 *    SQLite; it could come from a shared service once more than one candidate
 *    exists. The extractor must not care.
 *  - `CandidateSkillPort` — persistence of the audit state.
 *
 * There is deliberately no port for "text source". The extractor takes a
 * string; where the string came from — pasted CV, extracted PDF, LinkedIn
 * profile — is the caller's problem, and wrapping that in an interface would
 * add a layer with one implementation and no variation to absorb.
 */
import type { Detection, SkillDefinition } from "./domain/types.ts";

export type SkillCatalogPort = {
  all(): Promise<SkillDefinition[]>;
  /** Returns the catalogue id for a slug, so persistence can reference it. */
  idOf(slug: string): Promise<number | null>;
};

export type PersistedSkill = {
  skillSlug: string;
  status: "detected" | "confirmed" | "rejected";
};

export type CandidateSkillPort = {
  existing(candidateId: number): Promise<PersistedSkill[]>;
  add(candidateId: number, detection: Detection, source: string): Promise<void>;
  refresh(candidateId: number, detection: Detection): Promise<void>;
};
