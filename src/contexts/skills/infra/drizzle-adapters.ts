/**
 * Drizzle implementations of the skills ports.
 *
 * This is the only file in the context that knows SQL exists.
 */
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { candidateSkill, job, jobScore, skill } from "../../../core/db/schema.ts";
import {
  parseSkillCategory,
  parseSkillSource,
  parseSkillStatus,
  type CandidateSkillView,
  type Detection,
  type SkillDefinition,
  type SkillSource,
} from "../domain/types.ts";
import type {
  CatalogSeedResult,
  CandidateSkillPort,
  PersistedSkill,
  SkillCatalogPort,
  TargetCorpusPort,
} from "../ports.ts";

function aliasesFromStorage(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((alias) => typeof alias === "string")) {
    throw new Error("Invalid skill aliases stored in the catalogue");
  }
  return value;
}

async function catalogIdOf(slug: string): Promise<number | null> {
  const rows = await getDb()
    .select({ id: skill.id })
    .from(skill)
    .where(eq(skill.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

export const drizzleCatalog: SkillCatalogPort = {
  async all(): Promise<SkillDefinition[]> {
    const rows = await getDb()
      .select()
      .from(skill)
      .orderBy(skill.category, skill.canonicalName);
    return rows.map((r) => ({
      slug: r.slug,
      name: r.canonicalName,
      category: parseSkillCategory(r.category),
      aliases: aliasesFromStorage(r.aliases),
    }));
  },

  async sync(entries: readonly SkillDefinition[]): Promise<CatalogSeedResult> {
    const db = getDb();
    let inserted = 0;
    let updated = 0;

    for (const entry of entries) {
      const existing = await db
        .select({ id: skill.id })
        .from(skill)
        .where(eq(skill.slug, entry.slug))
        .limit(1);

      const values = {
        canonicalName: entry.name,
        category: entry.category,
        aliases: [...entry.aliases],
      };
      if (existing[0]) {
        // verifiedAt is human-owned audit state and survives catalogue refreshes.
        await db.update(skill).set(values).where(eq(skill.id, existing[0].id));
        updated++;
      } else {
        await db.insert(skill).values({ slug: entry.slug, ...values });
        inserted++;
      }
    }

    return { inserted, updated };
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
      status: parseSkillStatus(r.status),
    }));
  },

  async list(candidateId: number): Promise<CandidateSkillView[]> {
    const rows = await getDb()
      .select({
        id: candidateSkill.id,
        slug: skill.slug,
        name: skill.canonicalName,
        category: skill.category,
        status: candidateSkill.status,
        source: candidateSkill.source,
        evidence: candidateSkill.evidence,
        occurrences: candidateSkill.occurrences,
        level: candidateSkill.level,
        auditedAt: candidateSkill.auditedAt,
      })
      .from(candidateSkill)
      .innerJoin(skill, eq(skill.id, candidateSkill.skillId))
      .where(eq(candidateSkill.candidateId, candidateId))
      .orderBy(desc(candidateSkill.occurrences));

    return rows.map((row) => ({
      ...row,
      category: parseSkillCategory(row.category),
      status: parseSkillStatus(row.status),
      source: parseSkillSource(row.source),
    }));
  },

  async add(candidateId: number, detection: Detection, source: SkillSource): Promise<void> {
    const skillId = await catalogIdOf(detection.skill.slug);
    if (skillId === null) {
      throw new Error(`Skill catalogue entry "${detection.skill.slug}" was not persisted`);
    }
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
    const skillId = await catalogIdOf(detection.skill.slug);
    if (skillId === null) {
      throw new Error(`Skill catalogue entry "${detection.skill.slug}" was not persisted`);
    }
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

  async audit(candidateId, id, status, opts): Promise<boolean> {
    const changed = await getDb()
      .update(candidateSkill)
      .set({
        status,
        level: opts.level ?? null,
        auditedAt: new Date().toISOString(),
        auditedBy: opts.by,
      })
      .where(and(eq(candidateSkill.id, id), eq(candidateSkill.candidateId, candidateId)))
      .returning({ id: candidateSkill.id });
    return changed.length === 1;
  },
};

export const drizzleTargetCorpus: TargetCorpusPort = {
  async targetTexts(opts) {
    const db = getDb();
    const rows = await db
      .select({ title: job.title, text: job.descriptionText })
      .from(job)
      .innerJoin(
        jobScore,
        and(eq(jobScore.jobId, job.id), eq(jobScore.candidateId, opts.candidateId)),
      )
      .where(
        and(
          isNull(job.closedAt),
          gte(jobScore.fit, opts.minFit),
          // A posting too short to read would dilute every frequency count
          // toward zero without carrying any vocabulary of its own.
          sql`length(${job.descriptionText}) >= 400`,
        ),
      )
      .orderBy(desc(jobScore.fit))
      .limit(opts.limit);

    // Title included: it carries the densest vocabulary in the whole posting.
    return rows.map((r) => `${r.title}\n${r.text ?? ""}`);
  },
};
