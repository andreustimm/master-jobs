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
import type {
  CandidateSkillView,
  Detection,
  SkillAuditStatus,
  SkillDefinition,
  SkillSource,
  SkillStatus,
} from "./domain/types.ts";

export type CatalogSeedResult = { inserted: number; updated: number };

export type SkillCatalogPort = {
  all(): Promise<SkillDefinition[]>;
  sync(entries: readonly SkillDefinition[]): Promise<CatalogSeedResult>;
};

export type PersistedSkill = {
  skillSlug: string;
  status: SkillStatus;
};

export type CandidateSkillPort = {
  existing(candidateId: number): Promise<PersistedSkill[]>;
  list(candidateId: number): Promise<CandidateSkillView[]>;
  add(candidateId: number, detection: Detection, source: SkillSource): Promise<void>;
  refresh(candidateId: number, detection: Detection): Promise<void>;
  audit(
    candidateId: number,
    id: number,
    status: SkillAuditStatus,
    opts: { level?: string; by: string },
  ): Promise<boolean>;
};

export type TargetCorpusPort = {
  /** Descriptions of jobs worth imitating the vocabulary of. */
  targetTexts(opts: { candidateId: number; minFit: number; limit: number }): Promise<string[]>;
};
