/**
 * Drizzle implementations of the skills ports.
 *
 * This is the only file in the context that knows SQL exists.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { candidateSkill, skill } from "../../../core/db/schema.ts";
import type { Detection, SkillDefinition } from "../domain/types.ts";
import type { CandidateSkillPort, PersistedSkill, SkillCatalogPort } from "../ports.ts";

export const drizzleCatalog: SkillCatalogPort = {
  async all(): Promise<SkillDefinition[]> {
    const rows = await getDb().select().from(skill);
    return rows.map((r) => ({
      slug: r.slug,
      name: r.canonicalName,
      category: r.category as SkillDefinition["category"],
      aliases: (r.aliases as string[]) ?? [],
    }));
  },

  async idOf(slug: string): Promise<number | null> {
    const rows = await getDb()
      .select({ id: skill.id })
      .from(skill)
      .where(eq(skill.slug, slug))
      .limit(1);
    return rows[0]?.id ?? null;
  },
};

export const drizzleCandidateSkills: CandidateSkillPort = {
  async existing(candidateId: number): Promise<PersistedSkill[]> {
    const rows = await getDb()
      .select({ slug: skill.slug, status: candidateSkill.status })
      .from(candidateSkill)
      .innerJoin(skill, eq(skill.id, candidateSkill.skillId))
      .where(eq(candidateSkill.candidateId, candidateId));
    return rows.map((r) => ({
      skillSlug: r.slug,
      status: r.status as PersistedSkill["status"],
    }));
  },

  async add(candidateId: number, detection: Detection, source: string): Promise<void> {
    const skillId = await drizzleCatalog.idOf(detection.skill.slug);
    if (skillId === null) return;
    await getDb().insert(candidateSkill).values({
      candidateId,
      skillId,
      source,
      status: "detected",
      evidence: `${detection.evidence}\n— ${detection.rationale}`,
      occurrences: detection.occurrences,
    });
  },

  async refresh(candidateId: number, detection: Detection): Promise<void> {
    const skillId = await drizzleCatalog.idOf(detection.skill.slug);
    if (skillId === null) return;
    await getDb()
      .update(candidateSkill)
      .set({
        evidence: `${detection.evidence}\n— ${detection.rationale}`,
        occurrences: detection.occurrences,
      })
      .where(
        and(eq(candidateSkill.candidateId, candidateId), eq(candidateSkill.skillId, skillId)),
      );
  },
};
