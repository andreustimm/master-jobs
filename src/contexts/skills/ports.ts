/**
 * Ports for the skills context.
 *
 * Three exist, and only three, because only three absorb a variation that is real:
 *
 *  - `SkillCatalogPort` — today the catalogue is seeded from a file into
 *    SQLite; it could come from a shared service once more than one candidate
 *    exists. The extractor must not care.
 *  - `CandidateSkillPort` — persistence of the audit state.
 *  - `TargetCorpusPort` — the job texts that define "what the market says".
 *    Today that is the local corpus filtered by fit; it could be a shared
 *    market dataset, or one narrowed to a single employer before an interview.
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

export type TargetCorpusPort = {
  /** Descriptions of jobs worth imitating the vocabulary of. */
  targetTexts(opts: { minFit: number; limit: number }): Promise<string[]>;
};
