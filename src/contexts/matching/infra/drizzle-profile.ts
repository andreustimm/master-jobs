import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { candidateMatchingProfile } from "../../../core/db/schema.ts";
import { loadProfile } from "../../../core/profile/load.ts";
import { ProfileSchema, type Profile } from "../../../core/profile/schema.ts";

export function profileHash(profile: Profile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

export async function loadCandidateMatchingProfile(
  candidateId: number,
): Promise<{ profile: Profile; hash: string; source: "candidate" | "default" }> {
  const [stored] = await getDb()
    .select({ profileJson: candidateMatchingProfile.profileJson })
    .from(candidateMatchingProfile)
    .where(eq(candidateMatchingProfile.candidateId, candidateId))
    .limit(1);
  if (stored) {
    const profile = ProfileSchema.parse(JSON.parse(stored.profileJson));
    return { profile, hash: profileHash(profile), source: "candidate" };
  }
  const profile = await loadProfile(true);
  return { profile, hash: profileHash(profile), source: "default" };
}

export async function saveCandidateMatchingProfile(
  candidateId: number,
  input: unknown,
): Promise<{ hash: string }> {
  const profile = ProfileSchema.parse(input);
  const hash = profileHash(profile);
  await getDb()
    .insert(candidateMatchingProfile)
    .values({
      candidateId,
      profileJson: JSON.stringify(profile),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: candidateMatchingProfile.candidateId,
      set: { profileJson: JSON.stringify(profile), updatedAt: new Date().toISOString() },
    });
  return { hash };
}
