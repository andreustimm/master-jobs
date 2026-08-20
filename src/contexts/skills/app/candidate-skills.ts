import type {
  CandidateSkillView,
  SkillAuditStatus,
  SkillStatus,
} from "../domain/types.ts";
import type { CandidateSkillPort } from "../ports.ts";

export async function listCandidateSkills(
  input: { candidateId: number; status?: SkillStatus },
  deps: { store: Pick<CandidateSkillPort, "list"> },
): Promise<CandidateSkillView[]> {
  const rows = await deps.store.list(input.candidateId);
  return input.status ? rows.filter((row) => row.status === input.status) : rows;
}

export async function auditCandidateSkill(
  input: {
    candidateId: number;
    id: number;
    status: SkillAuditStatus;
    level?: string;
    by?: string;
  },
  deps: { store: Pick<CandidateSkillPort, "audit"> },
): Promise<void> {
  const changed = await deps.store.audit(input.candidateId, input.id, input.status, {
    level: input.level,
    by: input.by ?? "self",
  });
  if (!changed) {
    throw new Error(`Skill ${input.id} not found for candidate ${input.candidateId}`);
  }
}
