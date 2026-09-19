import { and, eq } from "drizzle-orm";
import { targetOf } from "../../src/contexts/matching/domain/track.ts";
import type { DB } from "../../src/core/db/client.ts";
import { targetTrack } from "../../src/core/db/schema.ts";
import { loadProfile } from "../../src/core/profile/load.ts";
import type { Profile } from "../../src/core/profile/schema.ts";

/**
 * The candidate's primary track id, creating it when missing.
 *
 * Fixtures that insert `job_score` rows directly need a track: the primary key
 * is `(candidate_id, track_id, job_id)`. The target defaults to profile.yaml,
 * which is what a fixture candidate would be scored with.
 */
export async function primaryTrackId(db: DB, candidateId: number, profile?: Profile): Promise<number> {
  const [existing] = await db
    .select({ id: targetTrack.id })
    .from(targetTrack)
    .where(and(eq(targetTrack.candidateId, candidateId), eq(targetTrack.isPrimary, true)))
    .limit(1);
  if (existing) return existing.id;
  const target = targetOf(profile ?? (await loadProfile(true)));
  const [row] = await db
    .insert(targetTrack)
    .values({
      candidateId,
      name: "Principal",
      nameKey: "principal",
      isPrimary: true,
      status: "active",
      position: 1,
      targetJson: JSON.stringify(target),
    })
    .returning({ id: targetTrack.id });
  return row!.id;
}
