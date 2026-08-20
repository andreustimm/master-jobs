import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  transitionApplication,
  type ApplicationStatus,
} from "../src/contexts/pursuit/domain/application.ts";
import type { DB } from "../src/core/db/client.ts";
import { listBoard, pipelineCounts, setApplicationStatus } from "../src/core/db/repo.ts";
import {
  application,
  applicationEvent,
  candidate,
  company,
  job,
  jobScore,
  source,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Suite: candidate-scoped Pursuit aggregate
 * Invariant: one candidate can never read or mutate another candidate's score or application.
 * Boundary IN: pure transition policy plus the real libSQL/Drizzle repository and transaction.
 * Boundary OUT: session authorization and browser wiring, owned by auth and E2E suites.
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

async function seedCandidate(slug: string, isDefault = false): Promise<number> {
  const [row] = await db
    .insert(candidate)
    .values({ slug, name: `Candidate ${slug}`, isDefault })
    .returning({ id: candidate.id });
  return row!.id;
}

async function seedScore(candidateId: number, jobId: number, fit: number): Promise<void> {
  await db.insert(jobScore).values({
    candidateId,
    jobId,
    fit,
    titleScore: fit,
    keywordScore: 0,
    seniorityScore: 0,
    geoScore: 0,
    compScore: 0,
    freshnessScore: 0,
    benefitScore: 0,
    penalty: 0,
    cluster: "architect",
    matchedKeywords: [],
    missingKeywords: [],
    detectedBenefits: [],
    ageDays: null,
    reasons: [],
    blockers: [],
    scorerVersion: "test",
  });
}

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

describe("setApplicationStatus", () => {
  it("creates the application on first call", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");

    const rows = await db
      .select()
      .from(application)
      .where(and(eq(application.candidateId, candidateId), eq(application.jobId, jobId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("shortlisted");
    // Only `applied` stamps a date — a shortlist is not a candidacy.
    expect(rows[0]!.appliedAt).toBeNull();
  });

  it("stamps appliedAt when it first reaches applied", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "applied");

    const [row] = await db
      .select()
      .from(application)
      .where(and(eq(application.candidateId, candidateId), eq(application.jobId, jobId)));
    expect(row!.appliedAt).toBeTruthy();
  });

  it("never moves appliedAt once set", async () => {
    // This is the invariant that matters: the application date is evidence of
    // when the user actually applied. A later status change must not rewrite it,
    // or every funnel-velocity number downstream becomes fiction.
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "applied");
    const [first] = await db.select().from(application).where(eq(application.jobId, jobId));

    await setApplicationStatus(candidateId, jobId, "screening");
    await setApplicationStatus(candidateId, jobId, "interviewing");

    const [after] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(after!.appliedAt).toBe(first!.appliedAt);
  });

  it("keeps exactly one application row per candidate and job", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    for (const s of ["shortlisted", "preparing", "applied", "screening"] as const) {
      await setApplicationStatus(candidateId, jobId, s);
    }
    const rows = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("screening");
  });

  it("records an event for every transition, with the previous status", async () => {
    // The event log is the audit trail. Losing `fromStatus` would make it
    // impossible to reconstruct the funnel after the fact.
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");
    await setApplicationStatus(candidateId, jobId, "preparing");
    await setApplicationStatus(candidateId, jobId, "applied", "via referral");

    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));

    expect(events).toHaveLength(3);
    expect(events[0]!.fromStatus).toBeNull();
    expect(events[0]!.toStatus).toBe("shortlisted");
    expect(events[2]!.fromStatus).toBe("preparing");
    expect(events[2]!.toStatus).toBe("applied");
    expect(events[2]!.detail).toBe("via referral");
  });

  it("is idempotent when the requested status is already current", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");

    await setApplicationStatus(candidateId, jobId, "shortlisted");

    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));
    expect(app!.status).toBe("shortlisted");
    expect(events).toHaveLength(1);
  });

  it("rejects an illegal backwards transition without changing history", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "applied");
    await setApplicationStatus(candidateId, jobId, "rejected");

    await expect(setApplicationStatus(candidateId, jobId, "backlog")).rejects.toMatchObject({
      code: "illegal_transition",
      from: "rejected",
      to: "backlog",
    });

    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(app!.status).toBe("rejected");
    expect(app!.appliedAt).toBeTruthy();

    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));
    expect(events).toHaveLength(2);
  });

  it("rolls the application update back when the event insert fails", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");

    await db.run(sql.raw(`
      create trigger reject_application_event
      before insert on application_event
      begin
        select raise(abort, 'forced event failure');
      end
    `));

    await expect(
      setApplicationStatus(candidateId, jobId, "preparing"),
    ).rejects.toThrow();

    const [after] = await db
      .select()
      .from(application)
      .where(and(eq(application.candidateId, candidateId), eq(application.jobId, jobId)));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, after!.id));

    expect(after!.status).toBe("shortlisted");
    expect(events).toHaveLength(1);
  });

  it("commits only one of two competing transitions", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");

    const outcomes = await Promise.allSettled([
      setApplicationStatus(candidateId, jobId, "preparing"),
      setApplicationStatus(candidateId, jobId, "archived"),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));
    expect(["preparing", "archived"]).toContain(app!.status);
    expect(events).toHaveLength(2);
    expect(events[1]!.toStatus).toBe(app!.status);
  });
});

describe("transitionApplication", () => {
  it("returns the next state for a legal transition", () => {
    const result = transitionApplication(
      { status: "shortlisted", appliedAt: null },
      "preparing",
      "2026-08-20T01:00:00.000Z",
    );

    expect(result).toEqual({
      ok: true,
      changed: true,
      state: { status: "preparing", appliedAt: null },
      event: {
        kind: "status_change",
        fromStatus: "shortlisted",
        toStatus: "preparing",
        at: "2026-08-20T01:00:00.000Z",
      },
    });
  });

  it("rejects transitions out of terminal states", () => {
    const result = transitionApplication(
      { status: "archived", appliedAt: null },
      "shortlisted",
      "2026-08-20T01:00:00.000Z",
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "illegal_transition", from: "archived", to: "shortlisted" },
    });
  });

  it("covers every persisted status pair", () => {
    const legal: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
      backlog: ["shortlisted", "archived"],
      shortlisted: ["preparing", "archived"],
      preparing: ["applied"],
      applied: ["screening", "rejected", "withdrawn", "archived"],
      screening: ["interviewing", "rejected", "withdrawn"],
      interviewing: ["offer", "rejected", "withdrawn"],
      offer: ["withdrawn", "archived"],
      rejected: [],
      withdrawn: [],
      archived: [],
    };

    for (const from of APPLICATION_STATUSES) {
      for (const to of APPLICATION_STATUSES) {
        const result = transitionApplication(
          { status: from, appliedAt: null },
          to,
          "2026-08-20T01:00:00.000Z",
        );
        expect(result.ok, `${from} -> ${to}`).toBe(from === to || legal[from].includes(to));
      }
    }
  });
});

describe("candidate-scoped read models", () => {
  it("isolates scores, applications and funnel counts for the same job", async () => {
    const firstCandidate = await seedCandidate("first", true);
    const secondCandidate = await seedCandidate("second");
    const jobId = await seedJob();

    await seedScore(firstCandidate, jobId, 91);
    await seedScore(secondCandidate, jobId, 17);
    await setApplicationStatus(firstCandidate, jobId, "shortlisted");
    await setApplicationStatus(secondCandidate, jobId, "applied");

    const [firstBoard, secondBoard, firstCounts, secondCounts] = await Promise.all([
      listBoard(firstCandidate, { minFit: 0 }),
      listBoard(secondCandidate, { minFit: 0 }),
      pipelineCounts(firstCandidate),
      pipelineCounts(secondCandidate),
    ]);

    expect(firstBoard[0]).toMatchObject({ jobId, fit: 91, status: "shortlisted" });
    expect(secondBoard[0]).toMatchObject({ jobId, fit: 17, status: "applied" });
    expect(firstCounts).toEqual({ shortlisted: 1 });
    expect(secondCounts).toEqual({ applied: 1 });
  });
});
