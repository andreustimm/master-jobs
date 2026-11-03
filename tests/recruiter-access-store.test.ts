/**
 * Suíte: concessões de recrutador no banco (#465, ADR-011, ADR-012;
 * `_tests.md` IT-002 – IT-014).
 *
 * Fronteira DENTRO: schema e migrações reais, `linkedCandidatesFor`,
 * `drizzleSessions.resolve`, o `UserDirectory` de Drizzle e a fachada
 * `linkRecruiterToCandidate`, com transações de verdade e chamadas
 * concorrentes.
 * Fronteira FORA: só o relógio, fixado em T0 = 2026-10-06T12:00:00Z.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  authUser,
  candidate,
  job,
  recruiterAccessEvent,
  recruiterGrant,
  recruiterInvite,
  recruiterSuggestion,
  recruiterSuggestionBy,
  source,
} from "../src/core/db/schema.ts";
import { linkRecruiterToCandidate } from "../src/contexts/auth/index.ts";
import { drizzleUserDirectory } from "../src/contexts/auth/infra/drizzle-directory.ts";
import { drizzleSessions, linkedCandidatesFor } from "../src/contexts/auth/infra/drizzle-store.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const T0 = "2026-10-06T12:00:00.000Z";

let db: DB;
let admin: number;
let recruiter: number;
let seven: number;

async function makeUser(email: string, roles: string[], fullName: string | null = null): Promise<number> {
  const [row] = await db.insert(authUser).values({ email, roles, fullName }).returning({ id: authUser.id });
  return row!.id;
}

async function makeCandidate(slug: string): Promise<number> {
  const [row] = await db.insert(candidate).values({ slug, name: slug }).returning({ id: candidate.id });
  return row!.id;
}

async function rawGrant(over: Partial<typeof recruiterGrant.$inferInsert> & { candidateId: number }): Promise<number> {
  const [row] = await db
    .insert(recruiterGrant)
    .values({ recruiterUserId: recruiter, recruiterEmail: "ana.rec@x.com", status: "active", ...over })
    .returning({ id: recruiterGrant.id });
  return row!.id;
}

async function grantsOf(candidateId: number) {
  return db.select().from(recruiterGrant).where(eq(recruiterGrant.candidateId, candidateId)).orderBy(recruiterGrant.id);
}

async function eventsOf(candidateId: number) {
  return db
    .select()
    .from(recruiterAccessEvent)
    .where(eq(recruiterAccessEvent.candidateId, candidateId))
    .orderBy(recruiterAccessEvent.id);
}

async function makeJob(fingerprint: string): Promise<number> {
  await db.insert(source).values({ id: "manual:m", kind: "manual", handle: "m", label: "M" }).onConflictDoNothing();
  const [row] = await db
    .insert(job)
    .values({
      fingerprint,
      contentHash: fingerprint,
      sourceId: "manual:m",
      externalId: fingerprint,
      companyName: "Acme",
      title: "Staff Engineer",
      url: `https://acme.test/${fingerprint}`,
      raw: {},
    })
    .returning({ id: job.id });
  return row!.id;
}

/** O código do Postgres na causa do erro que o Drizzle embrulha. */
async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

beforeEach(async () => {
  db = await useTestDb();
  setClock(fixedClock(T0));
  admin = await makeUser("dono@x.com", ["admin"], "Dona Admin");
  recruiter = await makeUser("ana.rec@x.com", ["recruiter"], "Ana Recrutadora");
  seven = await makeCandidate("sete");
});

afterEach(async () => {
  resetClock();
  await releaseTestDb();
});

describe("chaves estrangeiras e restrições", () => {
  it("IT-002 apagar o recrutador zera a concessão e o histórico guarda o e-mail", async () => {
    await linkRecruiterToCandidate(recruiter, seven, admin);

    await drizzleUserDirectory.remove(recruiter);

    const [grant] = await grantsOf(seven);
    expect(grant!.recruiterUserId).toBeNull();
    expect(grant!.recruiterEmail).toBe("ana.rec@x.com");
    const events = await eventsOf(seven);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.recruiterEmail === "ana.rec@x.com")).toBe(true);
  });

  it("IT-002 o CHECK impede apagar a conta por fora deixando concessão ativa sem recrutador", async () => {
    await linkRecruiterToCandidate(recruiter, seven, admin);
    expect(await pgCode(db.delete(authUser).where(eq(authUser.id, recruiter)))).toBe("23514");
    expect((await grantsOf(seven))[0]!.status).toBe("active");
  });

  it("IT-002 apagar o candidato leva concessões, convites, histórico e sugestões", async () => {
    await linkRecruiterToCandidate(recruiter, seven, admin);
    await db.insert(recruiterInvite).values({
      candidateId: seven,
      email: "bia@y.com",
      tokenHash: "hash-1",
      expiresAt: "2026-10-13T12:00:00.000Z",
    });
    const jobId = await makeJob("f1");
    const [suggestion] = await db
      .insert(recruiterSuggestion)
      .values({ candidateId: seven, jobId })
      .returning({ id: recruiterSuggestion.id });
    await db.insert(recruiterSuggestionBy).values({
      suggestionId: suggestion!.id,
      recruiterUserId: recruiter,
      recruiterEmail: "ana.rec@x.com",
    });

    await db.delete(candidate).where(eq(candidate.id, seven));

    const [left] = await db.execute<{ grants: number; invites: number; events: number; suggestions: number; by: number }>(sql`
      select (select count(*) from production.recruiter_grant)::int as grants,
             (select count(*) from production.recruiter_invite)::int as invites,
             (select count(*) from production.recruiter_access_event)::int as events,
             (select count(*) from production.recruiter_suggestion)::int as suggestions,
             (select count(*) from production.recruiter_suggestion_by)::int as by`);
    expect(left).toEqual({ grants: 0, invites: 0, events: 0, suggestions: 0, by: 0 });
  });

  it("IT-002 cada FK nova aplica no banco o ON DELETE declarado", async () => {
    const rows = await db.execute<{ fk: string; action: string }>(sql`
      select c.conname as fk, c.confdeltype as action from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      where c.contype = 'f' and t.relname like 'recruiter\_%' and t.relname <> 'recruiter_candidate'
      order by c.conname`);
    const byName = Object.fromEntries(rows.map((row) => [row.fk, row.action]));
    expect(byName).toEqual({
      recruiter_access_event_actor_user_id_auth_user_id_fk: "n",
      recruiter_access_event_candidate_id_candidate_id_fk: "c",
      recruiter_access_event_grant_id_recruiter_grant_id_fk: "n",
      recruiter_access_event_invite_id_recruiter_invite_id_fk: "n",
      recruiter_access_event_suggestion_id_recruiter_suggestion_id_fk: "n",
      recruiter_directory_query_recruiter_user_id_auth_user_id_fk: "c",
      recruiter_grant_candidate_id_candidate_id_fk: "c",
      recruiter_grant_created_by_auth_user_id_fk: "n",
      recruiter_grant_invite_id_recruiter_invite_id_fk: "n",
      recruiter_grant_recruiter_user_id_auth_user_id_fk: "n",
      recruiter_grant_revoked_by_auth_user_id_fk: "n",
      recruiter_invite_accepted_user_id_auth_user_id_fk: "n",
      recruiter_invite_cancelled_by_auth_user_id_fk: "n",
      recruiter_invite_candidate_id_candidate_id_fk: "c",
      recruiter_invite_created_by_auth_user_id_fk: "n",
      recruiter_suggestion_application_id_application_id_fk: "n",
      recruiter_suggestion_by_grant_id_recruiter_grant_id_fk: "n",
      recruiter_suggestion_by_recruiter_user_id_auth_user_id_fk: "n",
      recruiter_suggestion_by_suggestion_fk: "c",
      recruiter_suggestion_candidate_id_candidate_id_fk: "c",
      recruiter_suggestion_job_id_job_id_fk: "c",
    });
  });

  it("IT-003 uma concessão ativa por par; depois de revogada, outra pode nascer", async () => {
    const first = await rawGrant({ candidateId: seven });
    expect(await pgCode(rawGrant({ candidateId: seven }))).toBe("23505");

    await db.update(recruiterGrant).set({ status: "revoked", endedAt: T0 }).where(eq(recruiterGrant.id, first));
    const second = await rawGrant({ candidateId: seven });

    expect((await grantsOf(seven)).map((g) => [g.id, g.status])).toEqual([
      [first, "revoked"],
      [second, "active"],
    ]);
  });

  it("IT-004 os CHECKs recusam status desconhecido, nota longa e concessão ativa sem recrutador", async () => {
    expect(await pgCode(rawGrant({ candidateId: seven, status: "paused" }))).toBe("23514");
    expect(await pgCode(rawGrant({ candidateId: seven, recruiterUserId: null }))).toBe("23514");

    const jobId = await makeJob("f2");
    const [suggestion] = await db
      .insert(recruiterSuggestion)
      .values({ candidateId: seven, jobId })
      .returning({ id: recruiterSuggestion.id });
    const insertNote = (note: string) =>
      db.insert(recruiterSuggestionBy).values({
        suggestionId: suggestion!.id,
        recruiterUserId: recruiter,
        recruiterEmail: "ana.rec@x.com",
        note,
      });
    expect(await pgCode(insertNote("x".repeat(501)))).toBe("23514");
    await expect(insertNote("x".repeat(500))).resolves.toBeDefined();
  });
});

describe("predicado de acesso", () => {
  it("IT-005 concessão ativa sem fim aparece", async () => {
    await rawGrant({ candidateId: seven });
    expect(await linkedCandidatesFor(recruiter, ["recruiter"])).toEqual([seven]);
  });

  it("IT-006 revogada, expirada e encerrada por conta removida não aparecem", async () => {
    const others = await Promise.all(["oito", "nove", "dez"].map(makeCandidate));
    await rawGrant({ candidateId: seven });
    await rawGrant({ candidateId: others[0]!, status: "revoked", endedAt: T0 });
    await rawGrant({ candidateId: others[1]!, status: "expired", endedAt: T0 });
    await rawGrant({ candidateId: others[2]!, status: "ended_account_removed", endedAt: T0 });

    expect(await linkedCandidatesFor(recruiter, ["recruiter"])).toEqual([seven]);
  });

  it("IT-007 o prazo corta no instante, pelo relógio injetado", async () => {
    const later = await makeCandidate("oito");
    await rawGrant({ candidateId: seven, expiresAt: "2026-10-06T11:59:59.999Z" });
    await rawGrant({ candidateId: later, expiresAt: "2026-10-06T12:00:00.001Z" });

    expect(await linkedCandidatesFor(recruiter, ["recruiter"])).toEqual([later]);

    setClock(fixedClock("2026-10-06T12:00:00.001Z"));
    expect(await linkedCandidatesFor(recruiter, ["recruiter"])).toEqual([]);
  });

  it("IT-008 sem o papel de recrutador não há acesso, e a concessão continua ativa", async () => {
    await rawGrant({ candidateId: seven });
    expect(await linkedCandidatesFor(recruiter, ["candidate"])).toEqual([]);
    expect((await grantsOf(seven))[0]!.status).toBe("active");
  });

  it("IT-009 recrutador desabilitado perde a sessão inteira", async () => {
    await rawGrant({ candidateId: seven });
    const token = await drizzleSessions.create({ userId: recruiter, expiresAt: "2026-11-06T12:00:00.000Z" });
    expect((await drizzleSessions.resolve(token))!.linkedCandidateIds).toEqual([seven]);

    await drizzleUserDirectory.setDisabled(recruiter, true);

    expect(await drizzleSessions.resolve(token)).toBeNull();
  });

  it("IT-010 as leituras do admin usam o mesmo predicado", async () => {
    const [eight, nine, ten] = await Promise.all(["oito", "nove", "dez"].map(makeCandidate));
    const active = await rawGrant({ candidateId: seven });
    await rawGrant({ candidateId: eight!, status: "revoked", endedAt: T0 });
    await rawGrant({ candidateId: nine!, expiresAt: "2026-10-06T11:59:59.999Z" });
    const future = await rawGrant({ candidateId: ten!, expiresAt: "2026-10-06T12:00:00.001Z" });

    expect(await drizzleUserDirectory.linkedCandidates(recruiter)).toEqual([seven, ten]);
    expect(await drizzleUserDirectory.linksOf(recruiter)).toEqual([
      { id: active, candidateId: seven },
      { id: future, candidateId: ten },
    ]);
    expect(await linkedCandidatesFor(recruiter, ["recruiter"])).toEqual(
      await drizzleUserDirectory.linkedCandidates(recruiter),
    );
  });
});

describe("revogação, remoção de conta e fixture", () => {
  it("IT-011 o admin revoga: UPDATE com autor, data e nome dele no histórico; a sessão perde o candidato", async () => {
    const grantId = await rawGrant({ candidateId: seven });
    const token = await drizzleSessions.create({ userId: recruiter, expiresAt: "2026-11-06T12:00:00.000Z" });
    expect((await drizzleSessions.resolve(token))!.linkedCandidateIds).toEqual([seven]);

    expect(await drizzleUserDirectory.revokeGrant(grantId, admin)).toMatchObject({ ok: true });

    const [grant] = await grantsOf(seven);
    expect(grant).toMatchObject({ id: grantId, status: "revoked", revokedBy: admin, endedAt: T0 });
    const events = await eventsOf(seven);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      grantId,
      kind: "access_revoked",
      actor: "admin",
      actorUserId: admin,
      actorName: "Dona Admin",
      recruiterEmail: "ana.rec@x.com",
      at: T0,
    });
    expect((await drizzleSessions.resolve(token))!.linkedCandidateIds).toEqual([]);
  });

  it("IT-011 admin sem nome de exibição fica registrado pelo e-mail", async () => {
    const nameless = await makeUser("ops@x.com", ["admin"]);
    const grantId = await rawGrant({ candidateId: seven });
    await drizzleUserDirectory.revokeGrant(grantId, nameless);
    expect((await eventsOf(seven))[0]!.actorName).toBe("ops@x.com");
  });

  it("IT-012 duas revogações concorrentes: uma vence, a outra vê already_ended, um evento", async () => {
    const grantId = await rawGrant({ candidateId: seven });

    const results = await Promise.all([
      drizzleUserDirectory.revokeGrant(grantId, admin),
      drizzleUserDirectory.revokeGrant(grantId, admin),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "already_ended" }]);
    expect(await eventsOf(seven)).toHaveLength(1);
    expect(await drizzleUserDirectory.revokeGrant(grantId, admin)).toEqual({ ok: false, error: "already_ended" });
  });

  it("IT-013 remover a conta encerra a concessão, guarda o e-mail e deixa sugestões pendentes", async () => {
    const eight = await makeCandidate("oito");
    await linkRecruiterToCandidate(recruiter, seven, admin);
    const revoked = await rawGrant({ candidateId: eight, status: "revoked", endedAt: "2026-10-01T00:00:00.000Z" });
    const jobId = await makeJob("f3");
    const [suggestion] = await db
      .insert(recruiterSuggestion)
      .values({ candidateId: seven, jobId })
      .returning({ id: recruiterSuggestion.id });
    await db.insert(recruiterSuggestionBy).values({
      suggestionId: suggestion!.id,
      recruiterUserId: recruiter,
      recruiterEmail: "ana.rec@x.com",
    });

    await drizzleUserDirectory.remove(recruiter);

    const [grant] = await grantsOf(seven);
    expect(grant).toMatchObject({ status: "ended_account_removed", endedAt: T0, recruiterUserId: null });
    // A já encerrada não muda de causa.
    expect((await grantsOf(eight))[0]).toMatchObject({ id: revoked, status: "revoked" });
    const ended = (await eventsOf(seven)).filter((event) => event.kind === "access_ended_account_removed");
    expect(ended).toEqual([
      expect.objectContaining({ actor: "system", recruiterEmail: "ana.rec@x.com", grantId: grant!.id, at: T0 }),
    ]);
    expect(await eventsOf(eight)).toEqual([]);
    const [pending] = await db
      .select({ status: recruiterSuggestion.status })
      .from(recruiterSuggestion)
      .where(eq(recruiterSuggestion.id, suggestion!.id));
    expect(pending!.status).toBe("pending");
    expect(await drizzleUserDirectory.find(recruiter)).toBeNull();
  });

  it("IT-014 a fixture grava concessão ativa e evento system, uma vez só", async () => {
    await linkRecruiterToCandidate(recruiter, seven, admin);
    await linkRecruiterToCandidate(recruiter, seven, admin);

    const grants = await grantsOf(seven);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      status: "active",
      recruiterUserId: recruiter,
      recruiterEmail: "ana.rec@x.com",
      createdBy: admin,
      createdAt: T0,
      expiresAt: null,
    });
    const events = await db
      .select()
      .from(recruiterAccessEvent)
      .where(and(eq(recruiterAccessEvent.candidateId, seven), eq(recruiterAccessEvent.kind, "grant_created")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "system", actorUserId: null, grantId: grants[0]!.id });
    expect(await linkedCandidatesFor(recruiter, ["recruiter"])).toEqual([seven]);
  });

  it("IT-014 a fixture recusa conta que não existe", async () => {
    await expect(linkRecruiterToCandidate(424242, seven, admin)).rejects.toThrow(/não existe/);
  });
});
