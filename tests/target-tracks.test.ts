import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveTrack,
  createTrack,
  ensureMatchingProfile,
  restoreTrack,
  setMatchingProfile,
  setPrimaryTrack,
  suggestTrack,
  targetOf,
  trackOverview,
  trackScope,
  updateTrack,
  type Track,
  type TrackTarget,
} from "../src/contexts/matching/index.ts";
import { seedCatalog } from "../src/contexts/skills/index.ts";
import { saveDocument } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  candidate,
  company,
  job,
  savedTerm,
  scoreTask,
  source,
  targetTrack,
} from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const LARAVEL = { slug: "laravel", name: "Laravel", category: "framework" as const, aliases: [] };

let db: DB;
let base: Profile;

beforeEach(async () => {
  db = await useTestDb();
  base = await loadProfile(true);
});

afterEach(async () => {
  await releaseTestDb();
});

async function owner(): Promise<{ id: number; primary: TrackTarget }> {
  const [row] = await db
    .insert(candidate)
    .values({ slug: "owner", name: "Owner", isDefault: true })
    .returning({ id: candidate.id });
  await setMatchingProfile(row!.id, base);
  return { id: row!.id, primary: targetOf(base) };
}

function phpTarget(primary: TrackTarget): TrackTarget {
  return suggestTrack({ term: "Laravel", catalog: [LARAVEL], primary }).target;
}

async function tracksOf(candidateId: number) {
  return db.select().from(targetTrack).where(eq(targetTrack.candidateId, candidateId));
}

async function scoreTasks(candidateId: number) {
  return db.select().from(scoreTask).where(eq(scoreTask.candidateId, candidateId));
}

async function accepted(candidateId: number, primary: TrackTarget, name = "Dev PHP"): Promise<Track> {
  const result = await createTrack(candidateId, { name, target: phpTarget(primary) });
  if (!result.ok) throw new Error(result.code);
  return result.track;
}

async function term(candidateId: number, trackId: number, key: string, status = "active", pausedReason: string | null = null) {
  const [row] = await db
    .insert(savedTerm)
    .values({ candidateId, trackId, term: key, termKey: key, status, pausedReason })
    .returning();
  return row!;
}

describe("target track lifecycle", () => {
  it("IT-006 creates an accepted track after the primary and enqueues scoring", async () => {
    const { id, primary } = await owner();
    await db.delete(scoreTask);
    const result = await createTrack(id, { name: "Dev PHP", target: phpTarget(primary) });
    expect(result).toMatchObject({ ok: true, track: { isPrimary: false, position: 2, status: "active" } });
    expect(await scoreTasks(id)).toHaveLength(1);
  });

  it("IT-007 refuses a name that differs only in case", async () => {
    const { id, primary } = await owner();
    await accepted(id, primary, "Dev PHP");
    expect(await createTrack(id, { name: "dev php", target: phpTarget(primary) }))
      .toEqual({ ok: false, code: "track_name_duplicate" });
  });

  it("IT-008 refuses a seventh active track", async () => {
    const { id, primary } = await owner();
    for (let n = 1; n <= 5; n++) await accepted(id, primary, `Track ${n}`);
    expect(await createTrack(id, { name: "Track 6", target: phpTarget(primary) }))
      .toEqual({ ok: false, code: "track_limit" });
  });

  it("IT-009 creates one track for two concurrent submissions", async () => {
    const { id, primary } = await owner();
    const results = await Promise.all([
      createTrack(id, { name: "Dev PHP", target: phpTarget(primary) }),
      createTrack(id, { name: "Dev PHP", target: phpTarget(primary) }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, code: "track_name_duplicate" });
    expect((await tracksOf(id)).filter((t) => t.name === "Dev PHP")).toHaveLength(1);
  });

  it("IT-010 refuses a stale edit and returns the current values", async () => {
    const { id, primary } = await owner();
    const track = await accepted(id, primary);
    const first = await updateTrack(id, track.id, { target: phpTarget(primary), expectedUpdatedAt: track.updatedAt });
    expect(first.ok).toBe(true);
    const changed = phpTarget(primary);
    changed.keywords.stack.push({ term: "symfony", weight: 4 });
    const stale = await updateTrack(id, track.id, { target: changed, expectedUpdatedAt: track.updatedAt });
    expect(stale).toMatchObject({ ok: false, code: "stale", current: { id: track.id } });
    const [row] = await db.select().from(targetTrack).where(eq(targetTrack.id, track.id));
    expect(JSON.parse(row!.targetJson!).keywords.stack).not.toContainEqual({ term: "symfony", weight: 4 });
  });

  it("IT-011 promotes an accepted track and keeps one primary", async () => {
    const { id, primary } = await owner();
    const php = await accepted(id, primary);
    expect(await setPrimaryTrack(id, php.id)).toMatchObject({ ok: true, track: { isPrimary: true } });
    const rows = await tracksOf(id);
    expect(rows.filter((t) => t.isPrimary).map((t) => t.id)).toEqual([php.id]);
  });

  it("IT-012 keeps one primary under concurrent promotions", async () => {
    const { id, primary } = await owner();
    const a = await accepted(id, primary, "A");
    const b = await accepted(id, primary, "B");
    await Promise.all([setPrimaryTrack(id, a.id), setPrimaryTrack(id, b.id)]);
    expect((await tracksOf(id)).filter((t) => t.isPrimary)).toHaveLength(1);
  });

  it("IT-013 refuses to promote an archived track", async () => {
    const { id, primary } = await owner();
    const php = await accepted(id, primary);
    await archiveTrack(id, php.id);
    expect(await setPrimaryTrack(id, php.id)).toEqual({ ok: false, code: "track_archived" });
  });

  it("IT-014 refuses to archive the primary track", async () => {
    const { id } = await owner();
    const primaryRow = (await tracksOf(id)).find((t) => t.isPrimary)!;
    expect(await archiveTrack(id, primaryRow.id)).toEqual({ ok: false, code: "primary_cannot_archive" });
  });

  it("IT-015 archives the only accepted track without touching jobs or applications", async () => {
    const { id, primary } = await owner();
    const php = await accepted(id, primary);
    const saved = await term(id, php.id, "laravel");
    await db.insert(source).values({ id: "manual:t", kind: "manual", handle: "t", label: "T" });
    const [employer] = await db.insert(company).values({ slug: "acme", name: "Acme" }).returning({ id: company.id });
    const [posting] = await db.insert(job).values({
      sourceId: "manual:t", companyId: employer!.id, companyName: "Acme", externalId: "1", title: "Laravel Developer",
      url: "https://acme/1", fingerprint: "f1", contentHash: "h1", raw: "{}",
    }).returning({ id: job.id });
    await db.insert(application).values({ candidateId: id, jobId: posting!.id, status: "applied" });

    expect(await archiveTrack(id, php.id)).toMatchObject({ ok: true, track: { status: "archived" } });
    const [termRow] = await db.select().from(savedTerm).where(eq(savedTerm.id, saved.id));
    expect(termRow).toMatchObject({ status: "paused", pausedReason: "track_archived" });
    expect(await db.select().from(job)).toHaveLength(1);
    expect(await db.select().from(application)).toHaveLength(1);
    const scope = await trackScope(id, { kind: "all" });
    expect(scope!.trackIds).not.toContain(php.id);
  });

  it("IT-016 restores within the limit and resumes only archive pauses", async () => {
    const { id, primary } = await owner();
    const php = await accepted(id, primary);
    const archivedTerm = await term(id, php.id, "laravel");
    const manualTerm = await term(id, php.id, "php", "paused", "manual");
    await archiveTrack(id, php.id);
    for (let n = 1; n <= 5; n++) await accepted(id, primary, `Track ${n}`);
    expect(await restoreTrack(id, php.id)).toEqual({ ok: false, code: "track_limit" });

    const extra = (await tracksOf(id)).find((t) => t.name === "Track 5")!;
    await archiveTrack(id, extra.id);
    await db.delete(scoreTask);
    expect(await restoreTrack(id, php.id)).toMatchObject({ ok: true, track: { status: "active" } });
    const terms = await db.select().from(savedTerm).where(eq(savedTerm.trackId, php.id));
    expect(terms.find((t) => t.id === archivedTerm.id)).toMatchObject({ status: "active", pausedReason: null });
    expect(terms.find((t) => t.id === manualTerm.id)).toMatchObject({ status: "paused", pausedReason: "manual" });
    expect(await scoreTasks(id)).toHaveLength(1);
  });

  it("IT-017 treats a second archive as a no-op", async () => {
    const { id, primary } = await owner();
    const php = await accepted(id, primary);
    const first = await archiveTrack(id, php.id);
    const second = await archiveTrack(id, php.id);
    expect(second).toEqual(first);
  });

  it("IT-018 derives the person profile and a not-reviewed primary from a CV", async () => {
    await seedCatalog();
    const [row] = await db.insert(candidate).values({ slug: "renata", name: "Renata" }).returning({ id: candidate.id });
    await saveDocument({
      candidateId: row!.id,
      label: "CV",
      content: "Senior data engineer. Python, Spark, Airflow, Kubernetes and PostgreSQL in production for years.",
    });
    expect((await ensureMatchingProfile(row!.id)).estado).toBe("derivado");
    const [primaryRow] = (await tracksOf(row!.id)).filter((t) => t.isPrimary);
    expect(primaryRow!.targetJson).not.toBeNull();
    expect(JSON.parse(primaryRow!.unreviewedJson)).toEqual(["targets", "compensation"]);
  });

  it("IT-019 falls back to the primary for a foreign or archived track", async () => {
    const { id, primary } = await owner();
    const php = await accepted(id, primary);
    await archiveTrack(id, php.id);
    const [other] = await db.insert(candidate).values({ slug: "other", name: "Other" }).returning({ id: candidate.id });
    await setMatchingProfile(other!.id, base);
    const foreign = (await tracksOf(other!.id))[0]!;
    const primaryId = (await tracksOf(id)).find((t) => t.isPrimary)!.id;
    for (const trackId of [foreign.id, php.id]) {
      expect(await trackScope(id, { kind: "track", trackId }))
        .toMatchObject({ trackIds: [primaryId], mode: "single", notice: "track_unknown" });
    }
  });

  it("IT-020 has no scope for a pending primary", async () => {
    const [row] = await db.insert(candidate).values({ slug: "bare", name: "Bare" }).returning({ id: candidate.id });
    await db.insert(targetTrack).values({
      candidateId: row!.id, name: "Principal", nameKey: "principal", isPrimary: true, position: 1, targetJson: null,
    });
    expect(await trackScope(row!.id, { kind: "primary" })).toBeNull();
  });

  it("IT-021 edits an archived track without recalculating", async () => {
    const { id, primary } = await owner();
    const php = await accepted(id, primary);
    const archived = await archiveTrack(id, php.id);
    await db.delete(scoreTask);
    const result = await updateTrack(id, php.id, {
      target: phpTarget(primary),
      expectedUpdatedAt: (archived as { track: Track }).track.updatedAt,
    });
    expect(result.ok).toBe(true);
    expect(await scoreTasks(id)).toHaveLength(0);
  });

  it("IT-022 recomputes evidence support on every overview", async () => {
    const { id, primary } = await owner();
    const target = phpTarget(primary);
    target.keywords.critical = [{ term: "vue", weight: 8 }];
    await createTrack(id, { name: "Frontend", target });
    const before = (await trackOverview(id)).tracks.find((t) => t.name === "Frontend")!;
    expect(before.support.gaps).toContain("vue");

    await setMatchingProfile(id, { ...base, evidence: { ...base.evidence, frontend: ["Built admin UIs in Vue 3"] } });
    const after = (await trackOverview(id)).tracks.find((t) => t.name === "Frontend")!;
    expect(after.support.supported).toContain("vue");
    expect(await tracksOf(id)).toHaveLength(2);
  });
});
