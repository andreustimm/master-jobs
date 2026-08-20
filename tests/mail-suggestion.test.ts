import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { setApplicationStatus } from "../src/core/db/repo.ts";
import {
  application,
  applicationEvent,
  candidate,
  company,
  job,
  mailMessage,
  mailSuggestion,
  source,
} from "../src/core/db/schema.ts";
import { decideSuggestion } from "../src/core/mail/run.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

async function seedTrackedSuggestion(options: { matched?: boolean } = {}) {
  const [owner] = await db
    .insert(candidate)
    .values({ slug: "owner", name: "Owner", isDefault: true })
    .returning({ id: candidate.id });
  await db.insert(source).values({
    id: "manual:test",
    kind: "manual",
    handle: "test",
    label: "Test",
  });
  const [employer] = await db
    .insert(company)
    .values({ slug: "acme", name: "Acme" })
    .returning({ id: company.id });
  const [posting] = await db
    .insert(job)
    .values({
      sourceId: "manual:test",
      companyId: employer!.id,
      companyName: "Acme",
      externalId: "mail-job",
      title: "Architect",
      url: "manual://mail-job",
      fingerprint: "mail-job",
      contentHash: "mail-job",
      raw: "{}",
    })
    .returning({ id: job.id });
  await setApplicationStatus(owner!.id, posting!.id, "applied");
  const [tracked] = await db
    .select({ id: application.id })
    .from(application)
    .where(
      and(
        eq(application.candidateId, owner!.id),
        eq(application.jobId, posting!.id),
      ),
    );
  const [message] = await db
    .insert(mailMessage)
    .values({ messageId: "message-1", kind: "ats_screening" })
    .returning({ id: mailMessage.id });
  const matched = options.matched ?? true;
  const [suggestion] = await db
    .insert(mailSuggestion)
    .values({
      mailId: message!.id,
      applicationId: matched ? tracked!.id : null,
      jobId: matched ? posting!.id : null,
      suggestedStatus: "screening",
      confidence: 0.9,
    })
    .returning({ id: mailSuggestion.id });
  return { candidateId: owner!.id, jobId: posting!.id, suggestionId: suggestion!.id };
}

describe("decideSuggestion", () => {
  it("commits the suggestion, application and event as one decision", async () => {
    const seeded = await seedTrackedSuggestion();

    await expect(
      decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted"),
    ).resolves.toEqual({ jobId: seeded.jobId, status: "screening" });

    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    const [tracked] = await db
      .select()
      .from(application)
      .where(eq(application.jobId, seeded.jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, tracked!.id));

    expect(suggestion).toMatchObject({ status: "accepted" });
    expect(suggestion!.decidedAt).toBeTruthy();
    expect(tracked!.status).toBe("screening");
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      fromStatus: "applied",
      toStatus: "screening",
      detail: `via e-mail (sugestão #${seeded.suggestionId})`,
    });
  });

  it("does not accept a suggestion without a matched application", async () => {
    const seeded = await seedTrackedSuggestion({ matched: false });

    await expect(
      decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted"),
    ).rejects.toThrow("não possui candidatura correspondente");

    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    expect(suggestion).toMatchObject({ status: "pending", decidedAt: null });
  });

  it("rolls the suggestion back when the application event cannot be written", async () => {
    const seeded = await seedTrackedSuggestion();
    await db.run(sql.raw(`
      create trigger reject_mail_application_event
      before insert on application_event
      begin
        select raise(abort, 'forced event failure');
      end
    `));

    await expect(
      decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted"),
    ).rejects.toThrow();

    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    const [tracked] = await db
      .select()
      .from(application)
      .where(eq(application.jobId, seeded.jobId));
    expect(suggestion).toMatchObject({ status: "pending", decidedAt: null });
    expect(tracked!.status).toBe("applied");
  });

  it("is idempotent when an accepted decision is replayed", async () => {
    const seeded = await seedTrackedSuggestion();

    await decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted");
    await decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted");

    const [tracked] = await db
      .select()
      .from(application)
      .where(eq(application.jobId, seeded.jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, tracked!.id));
    expect(events).toHaveLength(2);
  });
});
