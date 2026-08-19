import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { setApplicationStatus } from "../src/core/db/repo.ts";
import { application, applicationEvent, company, job, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Characterization tests for the funnel's single write path.
 *
 * `setApplicationStatus` is the only function in the system allowed to record a
 * decision the user made, and its data is the only data here that cannot be
 * re-derived by re-running a sync. It had no test. These lock in the behaviour
 * that exists today so the ADR 0007 migration can move the code without
 * silently changing what it does.
 */

let db: DB;

async function seedJob(): Promise<number> {
  // Mirrors what an ingest run produces: source ids are human-readable
  // ("greenhouse:acme"), and the job carries both fingerprint and contentHash.
  await db
    .insert(source)
    .values({ id: "greenhouse:acme", kind: "greenhouse", handle: "acme", label: "Acme" });
  const [c] = await db
    .insert(company)
    .values({ slug: "acme", name: "Acme" })
    .returning({ id: company.id });
  const [j] = await db
    .insert(job)
    .values({
      sourceId: "greenhouse:acme",
      companyId: c!.id,
      companyName: "Acme",
      externalId: "job-1",
      title: "Staff AI Engineer",
      url: "https://example.test/job-1",
      fingerprint: "fp-1",
      contentHash: "ch-1",
      raw: "{}",
    })
    .returning({ id: job.id });
  return j!.id;
}

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

describe("setApplicationStatus", () => {
  it("creates the application on first call", async () => {
    const jobId = await seedJob();
    await setApplicationStatus(jobId, "shortlisted");

    const rows = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("shortlisted");
    // Only `applied` stamps a date — a shortlist is not a candidacy.
    expect(rows[0]!.appliedAt).toBeNull();
  });

  it("stamps appliedAt when it first reaches applied", async () => {
    const jobId = await seedJob();
    await setApplicationStatus(jobId, "applied");

    const [row] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(row!.appliedAt).toBeTruthy();
  });

  it("never moves appliedAt once set", async () => {
    // This is the invariant that matters: the application date is evidence of
    // when the user actually applied. A later status change must not rewrite it,
    // or every funnel-velocity number downstream becomes fiction.
    const jobId = await seedJob();
    await setApplicationStatus(jobId, "applied");
    const [first] = await db.select().from(application).where(eq(application.jobId, jobId));

    await setApplicationStatus(jobId, "interviewing");
    await setApplicationStatus(jobId, "applied");

    const [after] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(after!.appliedAt).toBe(first!.appliedAt);
  });

  it("keeps exactly one application row per job", async () => {
    const jobId = await seedJob();
    for (const s of ["shortlisted", "preparing", "applied", "screening"] as const) {
      await setApplicationStatus(jobId, s);
    }
    const rows = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("screening");
  });

  it("records an event for every transition, with the previous status", async () => {
    // The event log is the audit trail. Losing `fromStatus` would make it
    // impossible to reconstruct the funnel after the fact.
    const jobId = await seedJob();
    await setApplicationStatus(jobId, "shortlisted");
    await setApplicationStatus(jobId, "applied", "via referral");

    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));

    expect(events).toHaveLength(2);
    expect(events[0]!.fromStatus).toBeNull();
    expect(events[0]!.toStatus).toBe("shortlisted");
    expect(events[1]!.fromStatus).toBe("shortlisted");
    expect(events[1]!.toStatus).toBe("applied");
    expect(events[1]!.detail).toBe("via referral");
  });

  it("allows moving backwards without losing history", async () => {
    const jobId = await seedJob();
    await setApplicationStatus(jobId, "applied");
    await setApplicationStatus(jobId, "rejected");
    await setApplicationStatus(jobId, "backlog");

    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(app!.status).toBe("backlog");
    expect(app!.appliedAt).toBeTruthy();

    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));
    expect(events).toHaveLength(3);
  });

  it("advances updatedAt on every call", async () => {
    const jobId = await seedJob();
    await setApplicationStatus(jobId, "shortlisted");
    const [before] = await db.select().from(application).where(eq(application.jobId, jobId));

    await new Promise((r) => setTimeout(r, 5));
    await setApplicationStatus(jobId, "preparing");
    const [after] = await db.select().from(application).where(eq(application.jobId, jobId));

    expect(after!.updatedAt >= before!.updatedAt).toBe(true);
  });
});
