import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectDatabase, type DB } from "../src/core/db/client.ts";
import { deriveMatchingProfile } from "../src/contexts/matching/index.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import { provisionTestDatabase } from "./support/db.ts";

const SOURCE = "./drizzle/postgres";
const BACKFILL = "0005_backfill_primary_tracks";

type Journal = { entries: Array<{ tag: string }> };

let temp: string;
let target: Awaited<ReturnType<typeof provisionTestDatabase>>;
let connection: ReturnType<typeof connectDatabase>;
let db: DB;

/** A copy of the migration folder keeping only the first `upTo` entries. */
function folderUpTo(upTo: number, mutate?: (dir: string) => void): string {
  const dir = mkdtempSync(join(temp, "migrations-"));
  cpSync(SOURCE, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  journal.entries = journal.entries.slice(0, upTo);
  writeFileSync(journalPath, JSON.stringify(journal));
  mutate?.(dir);
  return dir;
}

function targetKeys(profile: Profile) {
  return {
    targets: profile.targets,
    keywords: profile.keywords,
    seniority: {
      min_years_expected: profile.seniority.min_years_expected,
      reject_below_years: profile.seniority.reject_below_years,
    },
    compensation: {
      reference_currency: profile.compensation.reference_currency,
      ranges: profile.compensation.ranges,
    },
  };
}

async function seedAtVersion3(): Promise<{ owner: number; derived: number; bare: number; defaultProfile: Profile; derivedProfile: Profile }> {
  const defaultProfile = await loadProfile(true);
  const derivedProfile = deriveMatchingProfile(defaultProfile, []);
  derivedProfile.keywords.strong = [{ term: "laravel", weight: 8 }];

  const candidates = await db.execute<{ id: number }>(sql`
    insert into production.candidate (slug, name, is_default) values
      ('owner', 'Owner', true), ('derived', 'Derived', false), ('bare', 'Bare', false)
    returning id`);
  const [owner, derived, bare] = candidates.map((row) => row.id) as [number, number, number];
  await db.execute(sql`
    insert into production.candidate_matching_profile (candidate_id, profile_json) values
      (${owner}, ${JSON.stringify(defaultProfile)}), (${derived}, ${JSON.stringify(derivedProfile)})`);
  await db.execute(sql`insert into production.source (id, kind, handle, label) values ('manual:m', 'manual', 'm', 'M')`);
  const jobs = await db.execute<{ id: number }>(sql`
    insert into production.job (fingerprint, content_hash, source_id, external_id, company_name, title, url, raw) values
      ('f1', 'h1', 'manual:m', '1', 'Acme', 'Architect', 'https://a/1', '{}'),
      ('f2', 'h2', 'manual:m', '2', 'Acme', 'Engineer', 'https://a/2', '{}')
    returning id`);
  for (const candidateId of [owner, derived, bare]) {
    for (const { id: jobId } of jobs) {
      await db.execute(sql`
        insert into production.job_score
          (candidate_id, job_id, fit, title_score, keyword_score, seniority_score, geo_score, comp_score,
           cluster, matched_keywords, missing_keywords, reasons, blockers, scorer_version)
        values (${candidateId}, ${jobId}, 50, 1, 1, 1, 1, 1, 'other', '[]', '[]', '[]', '[]', '1.3.0')`);
    }
  }
  return { owner, derived, bare, defaultProfile, derivedProfile };
}

beforeEach(async () => {
  temp = mkdtempSync(join(tmpdir(), "jho-migration-"));
  target = await provisionTestDatabase();
  connection = connectDatabase(target.url);
  db = connection.db;
  await migrate(db, { migrationsFolder: folderUpTo(4) });
});

afterEach(async () => {
  await connection.client.end();
  await target.drop();
  rmSync(temp, { recursive: true, force: true });
});

describe("target-track migrations 0004–0006", () => {
  it("gives an owner without a stored profile a NULL-target primary and keeps the owner's scores", async () => {
    const candidates = await db.execute<{ id: number }>(
      sql`insert into production.candidate (slug, name, is_default) values ('owner', 'Owner', true) returning id`,
    );
    const owner = candidates[0]!.id;
    await db.execute(sql`insert into production.source (id, kind, handle, label) values ('manual:m', 'manual', 'm', 'M')`);
    const jobs = await db.execute<{ id: number }>(sql`
      insert into production.job (fingerprint, content_hash, source_id, external_id, company_name, title, url, raw)
      values ('f1', 'h1', 'manual:m', '1', 'Acme', 'Architect', 'https://a/1', '{}') returning id`);
    const jobId = jobs[0]!.id;
    await db.execute(sql`
      insert into production.job_score
        (candidate_id, job_id, fit, title_score, keyword_score, seniority_score, geo_score, comp_score,
         cluster, matched_keywords, missing_keywords, reasons, blockers, scorer_version)
      values (${owner}, ${jobId}, 50, 1, 1, 1, 1, 1, 'other', '[]', '[]', '[]', '[]', '1.3.0')`);

    await migrate(db, { migrationsFolder: SOURCE });

    const tracks = await db.execute<{ id: number; target_json: string | null; unreviewed_json: string; is_primary: boolean }>(
      sql`select id, target_json, unreviewed_json, is_primary from production.target_track where candidate_id = ${owner}`,
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ target_json: null, unreviewed_json: "[]", is_primary: true });
    const scores = await db.execute<{ track_id: number }>(
      sql`select track_id from production.job_score where candidate_id = ${owner}`,
    );
    expect(scores.map((s) => s.track_id)).toEqual([tracks[0]!.id]);
  });

  it("IT-001 gives each profiled candidate one primary and keys job_score by track", async () => {
    const seeded = await seedAtVersion3();
    await migrate(db, { migrationsFolder: SOURCE });

    const tracks = await db.execute<{ candidate_id: number; id: number; target_json: string | null; is_primary: boolean }>(
      sql`select candidate_id, id, target_json, is_primary from production.target_track order by candidate_id`,
    );
    expect(tracks.map((t) => t.candidate_id)).toEqual([seeded.owner, seeded.derived]);
    expect(tracks.every((t) => t.is_primary)).toBe(true);
    expect(JSON.parse(tracks[0]!.target_json!)).toEqual(targetKeys(seeded.defaultProfile));
    expect(JSON.parse(tracks[1]!.target_json!)).toEqual(targetKeys(seeded.derivedProfile));

    const scores = await db.execute<{ candidate_id: number; track_id: number }>(
      sql`select candidate_id, track_id from production.job_score order by candidate_id, job_id`,
    );
    expect(scores.map((s) => s.candidate_id)).toEqual([seeded.owner, seeded.owner, seeded.derived, seeded.derived]);
    for (const score of scores) {
      expect(score.track_id).toBe(tracks.find((t) => t.candidate_id === score.candidate_id)!.id);
    }

    const [pk] = await db.execute<{ columns: string[] }>(sql`
      select array(select a.attname from unnest(c.conkey) with ordinality k(attnum, position)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.position) as columns
      from pg_constraint c where c.conname = 'job_score_candidate_track_job_pk'`);
    expect(pk!.columns).toEqual(["candidate_id", "track_id", "job_id"]);
  });

  it("IT-002 re-running the backfill keeps one primary per candidate", async () => {
    await seedAtVersion3();
    await migrate(db, { migrationsFolder: SOURCE });
    const before = await db.execute<{ tracks: number; scores: number }>(sql`
      select (select count(*) from production.target_track)::int as tracks,
             (select count(*) from production.job_score)::int as scores`);

    const statements = readFileSync(join(SOURCE, `${BACKFILL}.sql`), "utf8").split("--> statement-breakpoint");
    for (const statement of statements) await db.execute(sql.raw(statement));

    const after = await db.execute<{ tracks: number; scores: number }>(sql`
      select (select count(*) from production.target_track)::int as tracks,
             (select count(*) from production.job_score)::int as scores`);
    expect(after[0]).toEqual(before[0]);
    const [primaries] = await db.execute<{ n: number }>(sql`
      select max(n)::int as n from (select count(*) as n from production.target_track where is_primary group by candidate_id) x`);
    expect(primaries!.n).toBe(1);
  });

  it("IT-003 marks inherited target fields as not reviewed only for non-owners", async () => {
    const seeded = await seedAtVersion3();
    await migrate(db, { migrationsFolder: SOURCE });
    const rows = await db.execute<{ candidate_id: number; unreviewed_json: string }>(
      sql`select candidate_id, unreviewed_json from production.target_track`,
    );
    const byCandidate = new Map(rows.map((r) => [r.candidate_id, JSON.parse(r.unreviewed_json)]));
    expect(byCandidate.get(seeded.derived)).toEqual(["targets", "compensation"]);
    expect(byCandidate.get(seeded.owner)).toEqual([]);
  });

  it("IT-004 applies the declared ON DELETE actions to the new foreign keys", async () => {
    await migrate(db, { migrationsFolder: SOURCE });
    const rows = await db.execute<{ fk: string; action: string }>(sql`
      select c.conname as fk, c.confdeltype as action from pg_constraint c
      where c.contype = 'f' and c.conname in (
        'target_track_candidate_id_candidate_id_fk',
        'saved_term_candidate_id_candidate_id_fk',
        'saved_term_track_id_target_track_id_fk',
        'job_score_track_id_target_track_id_fk')`);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.action === "c")).toBe(true);
  });

  it("IT-005 rolls the whole batch back when the backfill fails midway", async () => {
    await seedAtVersion3();
    const broken = folderUpTo(7, (dir) => {
      const file = join(dir, `${BACKFILL}.sql`);
      const [insert, ...rest] = readFileSync(file, "utf8").split("--> statement-breakpoint");
      writeFileSync(file, [insert, "\nselect 1 / 0;\n", ...rest].join("--> statement-breakpoint"));
    });

    await expect(migrate(db, { migrationsFolder: broken })).rejects.toThrow();

    const [state] = await db.execute<{ table: string | null }>(
      sql`select to_regclass('production.target_track')::text as table`,
    );
    expect(state!.table).toBeNull();
    const [scores] = await db.execute<{ n: number }>(sql`select count(*)::int as n from production.job_score`);
    expect(scores!.n).toBe(6);
  });
});
