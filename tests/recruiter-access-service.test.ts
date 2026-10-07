/**
 * Suíte: casos de uso do acesso de recrutador contra o PostgreSQL (#465,
 * task_02; `_tests.md` IT-016 – IT-023, IT-025 – IT-069, IT-074).
 *
 * Fronteira DENTRO: `app/recruiter-access.ts` com o store de Drizzle, as
 * migrações e transações reais, a trava por candidato e o histórico.
 * Fronteira FORA: o relógio (T0 = 2026-10-06T12:00:00Z), o `Mailer` (que
 * grava ou que lança) e a origem dos links.
 */
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clock, fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  authEvent,
  authUser,
  candidate,
  job,
  recruiterAccessEvent,
  recruiterDirectoryQuery,
  recruiterGrant,
  recruiterInvite,
  recruiterSuggestion,
  source,
} from "../src/core/db/schema.ts";
import { runDatabaseCleanup } from "../src/core/db/retention.ts";
import { translator } from "../src/core/i18n/index.ts";
import {
  cancelInvite,
  candidateAccessView,
  changeEndDate,
  dismissInvite,
  expireRecruiterAccess,
  grantAccess,
  historyPageOf,
  resendInvite,
  revokeAccess,
  type RecruiterAccessDeps,
} from "../src/contexts/auth/app/recruiter-access.ts";
import { inviteCompletion, type InviteStatus } from "../src/contexts/auth/domain/recruiter-access.ts";
import { appendHistory, drizzleRecruiterAccess } from "../src/contexts/auth/infra/drizzle-recruiter-access.ts";
import { drizzleAuthRepository, drizzleSessions, hashToken, linkedCandidatesFor } from "../src/contexts/auth/infra/drizzle-store.ts";
import { drizzleUserDirectory } from "../src/contexts/auth/infra/drizzle-directory.ts";
import type { Mailer, OutgoingMail } from "../src/contexts/auth/ports-mailer.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const T0 = "2026-10-06T12:00:00.000Z";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ORIGIN = "https://jobs.test";
const pt = translator("pt-BR").t;
const en = translator("en").t;

let db: DB;
let time: ReturnType<typeof fixedClock>;
let sent: OutgoingMail[];
let mailer: Mailer;
let tokens: string[];
let admin: number;
let ana: number;
let bruno: number;
let rui: number;
let seven: number;
let eight: number;

const recording: Mailer = {
  name: "recording",
  async send(mail) {
    sent.push(mail);
    return { ok: true, id: String(sent.length) };
  },
};

const throwing: Mailer = {
  name: "throwing",
  async send() {
    throw new Error("provedor fora do ar");
  },
};

function deps(over: Partial<RecruiterAccessDeps> = {}): RecruiterAccessDeps {
  return {
    store: drizzleRecruiterAccess,
    mailer: () => mailer,
    audit: drizzleAuthRepository,
    now: () => clock().now(),
    origin: ORIGIN,
    newToken: () => {
      const token = randomBytes(32).toString("base64url");
      tokens.push(token);
      return { token, hash: hashToken(token) };
    },
    ...over,
  };
}

async function makeUser(
  email: string,
  roles: string[],
  extra: Partial<typeof authUser.$inferInsert> = {},
): Promise<number> {
  const [row] = await db.insert(authUser).values({ email, roles, ...extra }).returning({ id: authUser.id });
  return row!.id;
}

async function makeCandidate(name: string): Promise<number> {
  const [row] = await db
    .insert(candidate)
    .values({ slug: name.toLowerCase(), name })
    .returning({ id: candidate.id });
  return row!.id;
}

function grant(email: string, over: { candidateId?: number; actorUserId?: number; endDate?: string; tz?: string } = {}) {
  return grantAccess(
    {
      candidateId: over.candidateId ?? seven,
      actorUserId: over.actorUserId ?? ana,
      email,
      endDate: over.endDate ?? "",
      tz: over.tz ?? "",
    },
    deps(),
  );
}

async function grantsOf(candidateId = seven) {
  return db.select().from(recruiterGrant).where(eq(recruiterGrant.candidateId, candidateId)).orderBy(recruiterGrant.id);
}

async function invitesOf(candidateId = seven) {
  return db.select().from(recruiterInvite).where(eq(recruiterInvite.candidateId, candidateId)).orderBy(recruiterInvite.id);
}

async function eventsOf(candidateId = seven) {
  return db
    .select()
    .from(recruiterAccessEvent)
    .where(eq(recruiterAccessEvent.candidateId, candidateId))
    .orderBy(recruiterAccessEvent.id);
}

async function failures(detail: string) {
  return db
    .select()
    .from(authEvent)
    .where(and(eq(authEvent.kind, "email_send_failed"), eq(authEvent.detail, detail)));
}

/** Uma concessão ativa crua, sem e-mail nem histórico. */
async function rawGrant(over: Partial<typeof recruiterGrant.$inferInsert> = {}): Promise<number> {
  const [row] = await db
    .insert(recruiterGrant)
    .values({ candidateId: seven, recruiterUserId: rui, recruiterEmail: "rui@x.com", status: "active", ...over })
    .returning({ id: recruiterGrant.id });
  return row!.id;
}

async function rawInvite(email: string, over: Partial<typeof recruiterInvite.$inferInsert> = {}): Promise<number> {
  const [row] = await db
    .insert(recruiterInvite)
    .values({
      candidateId: seven,
      email,
      tokenHash: `hash-${email}-${randomBytes(4).toString("hex")}`,
      expiresAt: new Date(Date.parse(T0) + DAY).toISOString(),
      createdAt: T0,
      ...over,
    })
    .returning({ id: recruiterInvite.id });
  return row!.id;
}

/** `n` ações contadas do candidato, a mais antiga em `oldest`, uma por minuto. */
async function counted(n: number, oldest: string, candidateId = seven): Promise<void> {
  await appendHistory(
    db,
    Array.from({ length: n }, (_, i) => ({
      candidateId,
      recruiterEmail: `antes${i}@x.com`,
      kind: "grant_created" as const,
      actor: "candidate" as const,
      actorUserId: ana,
      at: new Date(Date.parse(oldest) + i * 60_000).toISOString(),
    })),
  );
}

/**
 * Abre as três conexões do pool antes de uma corrida. Sem isto a primeira
 * transação termina na conexão já aberta enquanto as outras ainda conectam, e
 * a corrida não acontece — o teste passaria até sem a trava.
 */
async function warmPool(): Promise<void> {
  await Promise.all([1, 2, 3].map(() => db.execute(sql`select pg_sleep(0.05)`)));
}

/** O estado que a página `/signup/invite` vai ler de um token (task_03). */
async function tokenState(token: string) {
  const [invite] = await db.select().from(recruiterInvite).where(eq(recruiterInvite.tokenHash, hashToken(token)));
  return inviteCompletion({
    invite: invite
      ? {
          status: invite.status as InviteStatus,
          email: invite.email,
          expiresAt: invite.expiresAt,
          accessExpiresAt: invite.accessExpiresAt,
        }
      : null,
    candidateEnabled: true,
    account: { email: invite?.email ?? "x@x.com", roles: ["recruiter"], disabled: false, emailVerified: true },
    now: clock().now(),
  });
}

beforeEach(async () => {
  db = await useTestDb();
  time = fixedClock(T0);
  setClock(time);
  sent = [];
  tokens = [];
  mailer = recording;
  seven = await makeCandidate("Ana");
  eight = await makeCandidate("Bruno");
  admin = await makeUser("dono@x.com", ["admin"], { fullName: "Dona Admin" });
  ana = await makeUser("ana@x.com", ["candidate"], { candidateId: seven, fullName: "Ana" });
  bruno = await makeUser("bruno@x.com", ["candidate"], { candidateId: eight });
  rui = await makeUser("rui@x.com", ["recruiter"], { fullName: "Rui", emailVerifiedAt: "2026-01-01T00:00:00.000Z" });
});

afterEach(async () => {
  resetClock();
  await releaseTestDb();
});

describe("conceder", () => {
  it("IT-016 concede a recrutador com conta verificada: ativa, histórico do candidato e um e-mail com o link da página", async () => {
    expect(await grant("rui@x.com")).toEqual({ ok: true, kind: "grant" });

    const [row] = await grantsOf();
    expect(row).toMatchObject({ status: "active", recruiterUserId: rui, recruiterEmail: "rui@x.com", createdBy: ana, expiresAt: null });
    expect(await eventsOf()).toEqual([
      expect.objectContaining({ kind: "grant_created", actor: "candidate", actorUserId: ana, grantId: row!.id }),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("rui@x.com");
    expect(sent[0]!.subject).toBe(pt("email.recruiterGrantedSubject", { candidate: "Ana" }));
    expect(sent[0]!.text).toContain(`${ORIGIN}/recruiter/${seven}`);
  });

  it("IT-017 a sessão já aberta do recrutador passa a ver o candidato sem novo login", async () => {
    const token = await drizzleSessions.create({ userId: rui, expiresAt: "2026-11-06T12:00:00.000Z" });
    expect((await drizzleSessions.resolve(token))!.linkedCandidateIds).toEqual([]);

    await grant("rui@x.com");

    expect((await drizzleSessions.resolve(token))!.linkedCandidateIds).toEqual([seven]);
  });

  it("IT-018 caixa e espaço não importam: o endereço normalizado acha a conta e detecta a duplicata", async () => {
    expect(await grant("  RUI@X.com ")).toEqual({ ok: true, kind: "grant" });
    expect(await grant("rui@x.com")).toEqual({ ok: false, error: "already_active" });
    expect(await grantsOf()).toHaveLength(1);
  });

  it("IT-019 o próprio e-mail do candidato é recusado sem linha nem e-mail", async () => {
    expect(await grant("ANA@x.com")).toEqual({ ok: false, error: "self" });
    expect(await grantsOf()).toEqual([]);
    expect(await invitesOf()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("IT-020 concessão ativa: a segunda é already_active, sem evento nem e-mail", async () => {
    await grant("rui@x.com");
    expect(await grant("rui@x.com")).toEqual({ ok: false, error: "already_active" });
    expect(await eventsOf()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("IT-021 convite pendente: conceder ao mesmo e-mail é already_invited, sem e-mail", async () => {
    expect(await grant("bia@y.com")).toEqual({ ok: true, kind: "invite" });
    expect(await grant("bia@y.com")).toEqual({ ok: false, error: "already_invited" });
    expect(sent).toHaveLength(1);
  });

  it("IT-022 conta desabilitada vira convite; nenhuma concessão e o acesso não muda", async () => {
    await db.update(authUser).set({ disabledAt: T0 }).where(eq(authUser.id, rui));
    expect(await grant("rui@x.com")).toEqual({ ok: true, kind: "invite" });
    expect(await grantsOf()).toEqual([]);
    expect(await invitesOf()).toHaveLength(1);
    expect(await linkedCandidatesFor(rui, ["recruiter"])).toEqual([]);
  });

  it("IT-022 conta de recrutador sem e-mail provado também vira convite", async () => {
    await db.update(authUser).set({ emailVerifiedAt: null }).where(eq(authUser.id, rui));
    expect(await grant("rui@x.com")).toEqual({ ok: true, kind: "invite" });
    expect(await grantsOf()).toEqual([]);
  });

  it("IT-023 conta só de candidato recebe o convite que pede conta de recrutador, e a tela responde igual a endereço sem conta", async () => {
    await makeUser("cand@x.com", ["candidate"]);
    const withAccount = await grant("cand@x.com");
    const withoutAccount = await grant("ninguem@x.com");

    expect(withAccount).toEqual(withoutAccount);
    expect(withAccount).toEqual({ ok: true, kind: "invite" });
    const needs = pt("email.recruiterInviteNeedsRecruiter");
    expect(sent.find((mail) => mail.to === "cand@x.com")!.text).toContain(needs);
    expect(sent.find((mail) => mail.to === "ninguem@x.com")!.text).not.toContain(needs);
  });

  it("IT-025 duas concessões simultâneas ao mesmo recrutador: uma concessão, um e-mail", async () => {
    await warmPool();
    const results = await Promise.all([grant("rui@x.com"), grant("rui@x.com")]);
    expect(results).toEqual(expect.arrayContaining([{ ok: true, kind: "grant" }, { ok: false, error: "already_active" }]));
    expect(await grantsOf()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("IT-026 falha no envio não desfaz a concessão: fica o registro para o operador e o acesso vale", async () => {
    mailer = throwing;
    expect(await grant("rui@x.com")).toEqual({ ok: true, kind: "grant" });
    expect((await grantsOf())[0]!.status).toBe("active");
    expect(await failures("access_granted")).toHaveLength(1);
    expect(await linkedCandidatesFor(rui, ["recruiter"])).toEqual([seven]);
  });

  it("IT-026 sem origem pública confiável o e-mail com link não sai e conta como falha (G17)", async () => {
    const result = await grantAccess(
      { candidateId: seven, actorUserId: ana, email: "rui@x.com", endDate: "", tz: "" },
      deps({ origin: null }),
    );
    expect(result).toEqual({ ok: true, kind: "grant" });
    expect(sent).toEqual([]);
    expect(await failures("access_granted")).toHaveLength(1);
  });

  it("IT-027 data de fim hoje é date_past; e-mail e data inválidos recusam antes do banco", async () => {
    expect(await grant("rui@x.com", { endDate: "2026-10-06", tz: "America/Sao_Paulo" })).toEqual({
      ok: false,
      error: "date_past",
    });
    expect(await grant("rui@x.com", { endDate: "06/10/2026" })).toEqual({ ok: false, error: "date_invalid" });
    expect(await grant("ana.x.com")).toEqual({ ok: false, error: "invalid_email" });
    expect(await grant("   ")).toEqual({ ok: false, error: "blank_email" });
    expect(await grantsOf()).toEqual([]);
    expect(await eventsOf()).toEqual([]);
  });
});

describe("convidar", () => {
  it("IT-028 sem conta: convite de 7 dias, só o hash do token gravado, histórico e e-mail no idioma da conta do candidato", async () => {
    await db.update(authUser).set({ locale: "en" }).where(eq(authUser.id, ana));

    expect(await grant("bia@y.com")).toEqual({ ok: true, kind: "invite" });

    const [invite] = await invitesOf();
    expect(invite).toMatchObject({
      status: "pending",
      email: "bia@y.com",
      expiresAt: new Date(Date.parse(T0) + 7 * DAY).toISOString(),
      createdBy: ana,
    });
    expect(invite!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(invite!.tokenHash).toBe(hashToken(tokens[0]!));
    expect(JSON.stringify(invite)).not.toContain(tokens[0]!);
    expect(await eventsOf()).toEqual([
      expect.objectContaining({ kind: "invite_sent", actor: "candidate", inviteId: invite!.id, recruiterEmail: "bia@y.com" }),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(en("email.recruiterInviteSubject", { candidate: "Ana" }));
    expect(sent[0]!.text).toContain(`${ORIGIN}/signup/invite?token=${tokens[0]}`);
  });

  it("IT-029 falha no envio do convite: segue pendente, marcado como não entregue, e a falha fica registrada", async () => {
    mailer = throwing;
    await grant("bia@y.com");
    const [invite] = await invitesOf();
    expect(invite).toMatchObject({ status: "pending", deliveryFailedAt: T0 });
    expect(await failures("recruiter_invite")).toHaveLength(1);
  });

  it("IT-030 vinte convites pendentes no prazo: o 21º é too_many_pending; com um vencido, passa", async () => {
    for (let i = 0; i < 20; i++) await rawInvite(`p${i}@y.com`);
    expect(await grant("bia@y.com")).toEqual({ ok: false, error: "too_many_pending" });

    const [first] = await invitesOf();
    await db.update(recruiterInvite).set({ expiresAt: "2026-10-06T11:59:59.999Z" }).where(eq(recruiterInvite.id, first!.id));
    expect(await grant("bia@y.com")).toEqual({ ok: true, kind: "invite" });
  });

  it("IT-031 dois candidatos convidam o mesmo e-mail: dois convites independentes, tokens diferentes", async () => {
    await grant("bia@y.com");
    await grant("bia@y.com", { candidateId: eight, actorUserId: bruno });
    const [a] = await invitesOf(seven);
    const [b] = await invitesOf(eight);
    expect(a!.status).toBe("pending");
    expect(b!.status).toBe("pending");
    expect(a!.tokenHash).not.toBe(b!.tokenHash);
  });

  it("IT-032 dois convites simultâneos ao mesmo e-mail: um convite, um e-mail", async () => {
    await warmPool();
    const results = await Promise.all([grant("bia@y.com"), grant("bia@y.com")]);
    expect(results).toEqual(expect.arrayContaining([{ ok: true, kind: "invite" }, { ok: false, error: "already_invited" }]));
    expect(await invitesOf()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});

describe("limites", () => {
  it("IT-033 dez ações contadas nas últimas 24 h: a 11ª é cap_reached com a hora da vaga; nada gravado", async () => {
    const oldest = new Date(Date.parse(T0) - 23 * HOUR).toISOString();
    await counted(10, oldest);
    const before = await eventsOf();

    expect(await grant("rui@x.com")).toEqual({
      ok: false,
      error: "cap_reached",
      retryAt: new Date(Date.parse(oldest) + DAY).toISOString(),
    });
    expect(await grantsOf()).toEqual([]);
    expect(await eventsOf()).toEqual(before);
    expect(sent).toEqual([]);
  });

  it("IT-034 quando a mais antiga sai da janela de 24 h, a 11ª passa", async () => {
    const oldest = new Date(Date.parse(T0) - 23 * HOUR).toISOString();
    await counted(10, oldest);
    time.set(new Date(Date.parse(oldest) + DAY + 1).toISOString());
    expect(await grant("rui@x.com")).toEqual({ ok: true, kind: "grant" });
  });

  it("IT-035 com nove contadas, três concessões simultâneas a e-mails diferentes: só uma passa", async () => {
    await counted(9, new Date(Date.parse(T0) - HOUR).toISOString());
    await warmPool();
    const results = await Promise.all([grant("a@y.com"), grant("b@y.com"), grant("c@y.com")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ error: "cap_reached" }),
      expect.objectContaining({ error: "cap_reached" }),
    ]);
    expect(await invitesOf()).toHaveLength(1);
  });

  it("IT-036 revogação, cancelamento, recusa e ato do admin não gastam o limite", async () => {
    const r1 = await makeUser("r1@x.com", ["recruiter"]);
    const r2 = await makeUser("r2@x.com", ["recruiter"]);
    const r3 = await makeUser("r3@x.com", ["recruiter"]);
    const g1 = await rawGrant({ recruiterUserId: r1, recruiterEmail: "r1@x.com" });
    const g2 = await rawGrant({ recruiterUserId: r2, recruiterEmail: "r2@x.com" });
    const g3 = await rawGrant({ recruiterUserId: r3, recruiterEmail: "r3@x.com" });
    await rawGrant();
    const pending = await rawInvite("velho@y.com");
    await counted(9, new Date(Date.parse(T0) - HOUR).toISOString());

    for (const grantId of [g1, g2]) {
      expect(await revokeAccess({ grantId, candidateId: seven, actor: "candidate", actorUserId: ana }, deps())).toEqual({ ok: true });
    }
    expect(await cancelInvite({ inviteId: pending, candidateId: seven, actor: "candidate", actorUserId: ana }, deps())).toEqual({ ok: true });
    expect(await grant("ana@x.com")).toMatchObject({ error: "self" });
    expect(await grant("sem-arroba")).toMatchObject({ error: "invalid_email" });
    expect(await grant("rui@x.com")).toMatchObject({ error: "already_active" });
    expect(await revokeAccess({ grantId: g3, candidateId: null, actor: "admin", actorUserId: admin }, deps())).toEqual({ ok: true });

    expect(await grant("bia@y.com")).toEqual({ ok: true, kind: "invite" });
    expect(await grant("caio@y.com")).toMatchObject({ ok: false, error: "cap_reached" });
  });

  it("IT-037 reenviar grava invite_resent do candidato e gasta o limite", async () => {
    await grant("bia@y.com");
    await counted(8, new Date(Date.parse(T0) - HOUR).toISOString());
    const [invite] = await invitesOf();

    expect(await resendInvite({ inviteId: invite!.id, candidateId: seven, actorUserId: ana }, deps())).toEqual({ ok: true });
    expect((await eventsOf()).filter((e) => e.kind === "invite_resent")).toEqual([
      expect.objectContaining({ actor: "candidate", actorUserId: ana }),
    ]);
    expect(await grant("caio@y.com")).toMatchObject({ ok: false, error: "cap_reached" });
  });
});

describe("revogar", () => {
  const revoke = (grantId: number, candidateId: number | null = seven, actorUserId = ana) =>
    revokeAccess({ grantId, candidateId, actor: candidateId === null ? "admin" : "candidate", actorUserId }, deps());

  it("IT-038 revogar encerra, grava access_revoked do candidato, avisa o recrutador e corta na próxima resolução", async () => {
    await grant("rui@x.com");
    const [row] = await grantsOf();
    const token = await drizzleSessions.create({ userId: rui, expiresAt: "2026-11-06T12:00:00.000Z" });
    const before = await drizzleSessions.resolve(token);
    sent = [];

    expect(await revoke(row!.id)).toEqual({ ok: true });

    expect((await grantsOf())[0]).toMatchObject({ status: "revoked", revokedBy: ana, endedAt: T0 });
    expect((await eventsOf()).at(-1)).toMatchObject({ kind: "access_revoked", actor: "candidate", actorUserId: ana });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(pt("email.recruiterEndedByCandidate", { candidate: "Ana" }));
    expect(before!.linkedCandidateIds).toEqual([seven]);
    expect((await drizzleSessions.resolve(token))!.linkedCandidateIds).toEqual([]);
  });

  it("IT-039 duas revogações simultâneas: uma vence, a outra already_ended; um e-mail, um evento", async () => {
    const grantId = await rawGrant();
    await warmPool();
    const results = await Promise.all([revoke(grantId), revoke(grantId)]);
    expect(results).toEqual(expect.arrayContaining([{ ok: true }, { ok: false, error: "already_ended" }]));
    expect(sent).toHaveLength(1);
    expect((await eventsOf()).filter((e) => e.kind === "access_revoked")).toHaveLength(1);
  });

  it("IT-040 o id da concessão de outro candidato é not_found e nada muda", async () => {
    const grantId = await rawGrant();
    expect(await revoke(grantId, eight, bruno)).toEqual({ ok: false, error: "not_found" });
    expect((await grantsOf())[0]!.status).toBe("active");
    expect(sent).toEqual([]);
  });

  it("IT-041 concessão vencida um segundo antes, ainda active: already_ended e nenhum aviso pela revogação", async () => {
    const grantId = await rawGrant({ expiresAt: "2026-10-06T11:59:59.000Z" });
    expect(await revoke(grantId)).toEqual({ ok: false, error: "already_ended" });
    expect(sent).toEqual([]);
  });

  it("IT-042 falha no aviso de fim: a revogação vale e a falha fica registrada", async () => {
    const grantId = await rawGrant();
    mailer = throwing;
    expect(await revoke(grantId)).toEqual({ ok: true });
    expect((await grantsOf())[0]!.status).toBe("revoked");
    expect(await failures("access_ended")).toHaveLength(1);
  });

  it("IT-043 as sugestões pendentes do recrutador continuam pendentes", async () => {
    const grantId = await rawGrant();
    await db.insert(source).values({ id: "manual:m", kind: "manual", handle: "m", label: "M" });
    const [posting] = await db
      .insert(job)
      .values({ fingerprint: "f", contentHash: "f", sourceId: "manual:m", externalId: "f", companyName: "Acme", title: "Staff", url: "https://a.test/f", raw: {} })
      .returning({ id: job.id });
    const [suggestion] = await db.insert(recruiterSuggestion).values({ candidateId: seven, jobId: posting!.id }).returning();

    await revoke(grantId);

    const [after] = await db.select().from(recruiterSuggestion).where(eq(recruiterSuggestion.id, suggestion!.id));
    expect(after!.status).toBe("pending");
  });

  it("IT-074 revogação do candidato e do admin ao mesmo tempo: um fim, um e-mail, um evento com o autor que venceu", async () => {
    const grantId = await rawGrant();
    await warmPool();
    const results = await Promise.all([revoke(grantId), revoke(grantId, null, admin)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const ended = (await eventsOf()).filter((e) => e.kind === "access_revoked");
    expect(ended).toHaveLength(1);
    expect((await grantsOf())[0]!.revokedBy).toBe(ended[0]!.actorUserId);
  });
});

describe("data de fim", () => {
  const setEnd = (grantId: number, endDate: string, tz = "America/Sao_Paulo") =>
    changeEndDate({ grantId, candidateId: seven, actorUserId: ana, endDate, tz }, deps());

  it("IT-044 pôr data de fim: fim do dia no fuso escolhido, histórico com o instante e um e-mail", async () => {
    const grantId = await rawGrant();
    expect(await setEnd(grantId, "2026-10-20")).toEqual({ ok: true });
    expect((await grantsOf())[0]).toMatchObject({ expiresAt: "2026-10-21T02:59:59.999Z", expiryTz: "America/Sao_Paulo" });
    expect(await eventsOf()).toEqual([
      expect.objectContaining({ kind: "end_date_changed", detail: "2026-10-21T02:59:59.999Z", actor: "candidate" }),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(pt("email.recruiterEndChangedSubject", { candidate: "Ana" }));
  });

  it("IT-045 tirar a data: sem fim, histórico `none` e e-mail dizendo que não termina mais", async () => {
    const grantId = await rawGrant({ expiresAt: "2026-10-21T02:59:59.999Z", expiryTz: "America/Sao_Paulo" });
    expect(await setEnd(grantId, "")).toEqual({ ok: true });
    expect((await grantsOf())[0]).toMatchObject({ expiresAt: null, expiryTz: null });
    expect((await eventsOf())[0]).toMatchObject({ detail: "none" });
    expect(sent[0]!.text).toContain(pt("email.recruiterNoLongerEnds"));
  });

  it("IT-046 concessão revogada: already_ended e nada gravado", async () => {
    const grantId = await rawGrant({ status: "revoked", endedAt: T0 });
    expect(await setEnd(grantId, "2026-10-20")).toEqual({ ok: false, error: "already_ended" });
    expect(await eventsOf()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("IT-047 a mesma mudança duas vezes, em sequência e ao mesmo tempo: um evento e um e-mail por mudança", async () => {
    const grantId = await rawGrant();
    await setEnd(grantId, "2026-10-20");
    await setEnd(grantId, "2026-10-20");
    expect(await eventsOf()).toHaveLength(1);
    expect(sent).toHaveLength(1);

    await warmPool();
    await Promise.all([setEnd(grantId, "2026-11-20"), setEnd(grantId, "2026-11-20")]);
    expect(await eventsOf()).toHaveLength(2);
    expect(sent).toHaveLength(2);
  });

  it("IT-048 adiar antes do fim mantém o acesso e a varredura não manda aviso de fim", async () => {
    const grantId = await rawGrant();
    await setEnd(grantId, "2026-10-10");
    time.set("2026-10-10T20:00:00.000Z");
    expect(await setEnd(grantId, "2026-10-20")).toEqual({ ok: true });
    time.set("2026-10-11T12:00:00.000Z");
    sent = [];

    expect(await linkedCandidatesFor(rui, ["recruiter"])).toEqual([seven]);
    expect(await expireRecruiterAccess(deps())).toEqual({ expired: 0, invitesExpired: 0 });
    expect(sent).toEqual([]);
  });

  it("IT-049 depois que o fim passou, mudar a data é already_ended", async () => {
    const grantId = await rawGrant();
    await setEnd(grantId, "2026-10-10");
    time.set("2026-10-11T03:00:00.000Z");
    expect(await setEnd(grantId, "2026-10-20")).toEqual({ ok: false, error: "already_ended" });
    expect(await setEnd(grantId + 1000, "2026-10-20")).toEqual({ ok: false, error: "not_found" });
  });
});

describe("reenviar, cancelar e dispensar", () => {
  const resend = (inviteId: number) => resendInvite({ inviteId, candidateId: seven, actorUserId: ana }, deps());
  const cancel = (inviteId: number) => cancelInvite({ inviteId, candidateId: seven, actor: "candidate", actorUserId: ana }, deps());

  it("IT-050 reenviar substitui o convite: o antigo vira superseded, o novo tem outro token e mais 7 dias; o link velho não vale", async () => {
    await grant("bia@y.com", { endDate: "2026-12-01", tz: "America/Sao_Paulo" });
    const [old] = await invitesOf();
    time.advance(HOUR);

    expect(await resend(old!.id)).toEqual({ ok: true });

    const [superseded, fresh] = await invitesOf();
    expect(superseded).toMatchObject({ id: old!.id, status: "superseded" });
    expect(fresh).toMatchObject({
      status: "pending",
      expiresAt: new Date(clock().now() + 7 * DAY).toISOString(),
      accessExpiresAt: old!.accessExpiresAt,
      expiryTz: "America/Sao_Paulo",
    });
    expect(fresh!.tokenHash).not.toBe(old!.tokenHash);
    const view = await candidateAccessView({ candidateId: seven, historyPage: 1 }, deps());
    expect(view.invites.map((row) => row.id)).toEqual([fresh!.id]);
    expect((await eventsOf()).at(-1)).toMatchObject({ kind: "invite_resent", inviteId: fresh!.id });
    expect(sent).toHaveLength(2);
    expect(await tokenState(tokens[0]!)).toBe("invalid");
    expect(await tokenState(tokens[1]!)).toBe("completed");
  });

  it("IT-051 reenviar convite já aceito é already_active", async () => {
    const inviteId = await rawInvite("bia@y.com", { status: "accepted" });
    expect(await resend(inviteId)).toEqual({ ok: false, error: "already_active" });
  });

  it("IT-052 reenviar convite pendente com link vencido gera um novo; o velho vira superseded", async () => {
    const inviteId = await rawInvite("bia@y.com", { expiresAt: "2026-10-05T00:00:00.000Z" });
    expect(await resend(inviteId)).toEqual({ ok: true });
    const rows = await invitesOf();
    expect(rows.map((row) => row.status)).toEqual(["superseded", "pending"]);
  });

  it("IT-052 reenviar convite cancelado ou de outro candidato não acha nada", async () => {
    const cancelled = await rawInvite("bia@y.com", { status: "cancelled" });
    const other = await rawInvite("caio@y.com", { candidateId: eight });
    expect(await resend(cancelled)).toEqual({ ok: false, error: "not_found" });
    expect(await resend(other)).toEqual({ ok: false, error: "not_found" });
  });

  it("IT-053 cancelar: cancelled pelo candidato, histórico, nenhum e-mail; o link não vale mais", async () => {
    await grant("bia@y.com");
    const [invite] = await invitesOf();
    sent = [];

    expect(await cancel(invite!.id)).toEqual({ ok: true });

    expect((await invitesOf())[0]).toMatchObject({ status: "cancelled", cancelledBy: ana, decidedAt: T0 });
    expect((await eventsOf()).at(-1)).toMatchObject({ kind: "invite_cancelled", actor: "candidate", actorUserId: ana });
    expect(sent).toEqual([]);
    expect(await tokenState(tokens[0]!)).toBe("invalid");
  });

  it("IT-054 cancelar duas vezes: um evento, e a segunda devolve ok sem mudar nada", async () => {
    const inviteId = await rawInvite("bia@y.com");
    expect(await cancel(inviteId)).toEqual({ ok: true });
    expect(await cancel(inviteId)).toEqual({ ok: true });
    expect(await eventsOf()).toHaveLength(1);
    expect(await cancel(inviteId + 1000)).toEqual({ ok: false, error: "not_found" });
  });

  it("IT-055 dispensar convite vencido tira da lista e não mexe no histórico", async () => {
    const expired = await rawInvite("bia@y.com", { status: "expired", decidedAt: T0 });
    const live = await rawInvite("caio@y.com");
    const before = await eventsOf();

    expect(await dismissInvite({ inviteId: expired, candidateId: seven }, deps())).toEqual({ ok: true });
    expect(await dismissInvite({ inviteId: expired, candidateId: seven }, deps())).toEqual({ ok: true });
    expect(await dismissInvite({ inviteId: live, candidateId: seven }, deps())).toEqual({ ok: false, error: "not_found" });

    expect((await invitesOf()).find((row) => row.id === expired)!.dismissedAt).toBe(T0);
    const view = await candidateAccessView({ candidateId: seven, historyPage: 1 }, deps());
    expect(view.invites.map((invite) => invite.email)).toEqual(["caio@y.com"]);
    expect(await eventsOf()).toEqual(before);
  });
});

describe("nova concessão, histórico e listas", () => {
  it("IT-056 conceder de novo depois de revogar: nova concessão sem o fim antigo, novo e-mail, histórico separado", async () => {
    await grant("rui@x.com", { endDate: "2026-12-01", tz: "America/Sao_Paulo" });
    const [first] = await grantsOf();
    await revokeAccess({ grantId: first!.id, candidateId: seven, actor: "candidate", actorUserId: ana }, deps());

    expect(await grant("rui@x.com")).toEqual({ ok: true, kind: "grant" });

    const [, second] = await grantsOf();
    expect(second).toMatchObject({ status: "active", expiresAt: null });
    expect(sent.filter((mail) => mail.subject === pt("email.recruiterGrantedSubject", { candidate: "Ana" }))).toHaveLength(2);
    const view = await candidateAccessView({ candidateId: seven, historyPage: 1 }, deps());
    expect(view.history.rows.map((row) => [row.kind, row.recruiterEmail])).toEqual([
      ["grant_created", "rui@x.com"],
      ["access_revoked", "rui@x.com"],
      ["grant_created", "rui@x.com"],
    ]);
  });

  it("IT-056 concessão vencida que a varredura não marcou é encerrada na hora de conceder de novo, com o aviso de fim", async () => {
    await rawGrant({ expiresAt: "2026-10-06T11:00:00.000Z", expiryTz: "UTC" });
    expect(await grant("rui@x.com")).toEqual({ ok: true, kind: "grant" });
    expect((await grantsOf()).map((row) => row.status)).toEqual(["expired", "active"]);
    expect(sent.map((mail) => mail.subject)).toEqual([
      pt("email.recruiterEndedSubject", { candidate: "Ana" }),
      pt("email.recruiterGrantedSubject", { candidate: "Ana" }),
    ]);
  });

  it("IT-057 conceder de novo depois da revogação pelo admin é permitido", async () => {
    const grantId = await rawGrant();
    await revokeAccess({ grantId, candidateId: null, actor: "admin", actorUserId: admin }, deps());
    expect(await grant("rui@x.com")).toEqual({ ok: true, kind: "grant" });
  });

  it("IT-058 histórico pagina de 20 em 20, mais novo primeiro e empate pelo id; o e-mail sobrevive à conta", async () => {
    const empty = await candidateAccessView({ candidateId: seven, historyPage: 1 }, deps());
    expect(empty.history).toEqual({ rows: [], page: 1, pages: 1, total: 0 });

    await appendHistory(
      db,
      Array.from({ length: 45 }, (_, i) => ({
        candidateId: seven,
        recruiterEmail: "rui@x.com",
        kind: "grant_created" as const,
        actor: "candidate" as const,
        // Pares com o mesmo instante: o desempate é o id, decrescente.
        at: new Date(Date.parse(T0) - Math.floor(i / 2) * 60_000).toISOString(),
      })),
    );
    await db.delete(authUser).where(eq(authUser.id, rui));

    const first = await candidateAccessView({ candidateId: seven, historyPage: 1 }, deps());
    const third = await candidateAccessView({ candidateId: seven, historyPage: 3 }, deps());
    expect(first.history).toMatchObject({ page: 1, pages: 3, total: 45 });
    expect(first.history.rows).toHaveLength(20);
    expect(third.history.rows).toHaveLength(5);
    const ids = first.history.rows.map((row) => row.id);
    expect(first.history.rows[0]).toMatchObject({ at: T0, kind: "grant_created", actor: "candidate", recruiterEmail: "rui@x.com" });
    expect(ids[0]! > ids[1]!).toBe(true);
    const ats = first.history.rows.map((row) => row.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });

  it("IT-058 a página do histórico vem da URL: inteiro de 1 em diante, o resto vira 1", () => {
    expect(historyPageOf("3")).toBe(3);
    for (const raw of [undefined, "", "0", "-2", "1.5", "abc"]) expect(historyPageOf(raw)).toBe(1);
  });

  it("IT-059 a lista mostra as ativas, mais novas primeiro, com nome atual, último acesso e a marca do recrutador", async () => {
    const off = await makeUser("off@x.com", ["recruiter"], { disabledAt: T0 });
    const former = await makeUser("ex@x.com", ["candidate"]);
    await rawGrant({ createdAt: "2026-10-01T00:00:00.000Z", lastAccessedAt: "2026-10-05T10:00:00.000Z" });
    await rawGrant({ recruiterUserId: off, recruiterEmail: "off@x.com", createdAt: "2026-10-02T00:00:00.000Z" });
    await rawGrant({ recruiterUserId: former, recruiterEmail: "ex@x.com", createdAt: "2026-10-03T00:00:00.000Z" });
    await rawGrant({ recruiterUserId: admin, recruiterEmail: "x@x.com", status: "revoked", endedAt: T0 });
    await db.update(authUser).set({ fullName: "Rui Renomeado" }).where(eq(authUser.id, rui));

    const view = await candidateAccessView({ candidateId: seven, historyPage: 1 }, deps());
    expect(view.grants.map((row) => [row.recruiterEmail, row.display])).toEqual([
      ["ex@x.com", "not_recruiter"],
      ["off@x.com", "account_disabled"],
      ["rui@x.com", "active"],
    ]);
    expect(view.grants[2]).toMatchObject({ recruiterName: "Rui Renomeado", lastAccessedAt: "2026-10-05T10:00:00.000Z" });
    expect(view.grants[0]!.lastAccessedAt).toBeNull();
  });

  it("IT-059 vinte e cinco concessões ativas aparecem todas", async () => {
    for (let i = 0; i < 25; i++) {
      const id = await makeUser(`r${i}@x.com`, ["recruiter"]);
      await rawGrant({ recruiterUserId: id, recruiterEmail: `r${i}@x.com` });
    }
    const view = await candidateAccessView({ candidateId: seven, historyPage: 1 }, deps());
    expect(view.grants).toHaveLength(25);
  });

  it("IT-060 os convites mostram envio, validade, falha de entrega e o vencido como expirado até dispensar", async () => {
    await rawInvite("bia@y.com", { deliveryFailedAt: T0 });
    await rawInvite("caio@y.com", { expiresAt: "2026-10-06T11:00:00.000Z" });
    await rawInvite("dani@y.com", { status: "expired", decidedAt: T0 });
    await rawInvite("eva@y.com", { status: "cancelled" });

    const view = await candidateAccessView({ candidateId: seven, historyPage: 1 }, deps());
    const byEmail = Object.fromEntries(view.invites.map((row) => [row.email, row]));
    expect(Object.keys(byEmail).sort()).toEqual(["bia@y.com", "caio@y.com", "dani@y.com"]);
    expect(byEmail["bia@y.com"]).toMatchObject({ status: "pending", deliveryFailed: true, createdAt: T0 });
    expect(byEmail["caio@y.com"]).toMatchObject({ status: "expired", deliveryFailed: false });
    expect(byEmail["dani@y.com"]!.status).toBe("expired");
  });
});

describe("varredura e expurgo", () => {
  it("IT-061 a varredura fecha a concessão vencida, grava access_expired do sistema e avisa uma vez; rodar de novo não faz nada", async () => {
    await rawGrant({ expiresAt: "2026-10-06T11:00:00.000Z", expiryTz: "UTC" });
    await db.insert(source).values({ id: "manual:m", kind: "manual", handle: "m", label: "M" });
    const [posting] = await db
      .insert(job)
      .values({ fingerprint: "f", contentHash: "f", sourceId: "manual:m", externalId: "f", companyName: "Acme", title: "Staff", url: "https://a.test/f", raw: {} })
      .returning({ id: job.id });
    await db.insert(recruiterSuggestion).values({ candidateId: seven, jobId: posting!.id });

    expect(await expireRecruiterAccess(deps())).toEqual({ expired: 1, invitesExpired: 0 });

    expect((await grantsOf())[0]).toMatchObject({ status: "expired", endedAt: T0 });
    expect(await eventsOf()).toEqual([expect.objectContaining({ kind: "access_expired", actor: "system" })]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(pt("email.recruiterEndedExpired", { candidate: "Ana" }));
    expect((await db.select().from(recruiterSuggestion))[0]!.status).toBe("pending");

    expect(await expireRecruiterAccess(deps())).toEqual({ expired: 0, invitesExpired: 0 });
    expect(sent).toHaveLength(1);
  });

  it("IT-062 cinco concessões com o mesmo fim: cinco encerradas, um e-mail cada", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await makeUser(`r${i}@x.com`, ["recruiter"], { locale: i === 0 ? "en" : null });
      await rawGrant({ recruiterUserId: id, recruiterEmail: `r${i}@x.com`, expiresAt: "2026-10-06T11:00:00.000Z" });
    }
    expect(await expireRecruiterAccess(deps())).toEqual({ expired: 5, invitesExpired: 0 });
    expect(sent.map((mail) => mail.to).sort()).toEqual(["r0@x.com", "r1@x.com", "r2@x.com", "r3@x.com", "r4@x.com"]);
    expect(sent.find((mail) => mail.to === "r0@x.com")!.subject).toBe(en("email.recruiterEndedSubject", { candidate: "Ana" }));
  });

  it("IT-063 convite pendente vencido vira expired com invite_expired, sem e-mail nem concessão", async () => {
    await rawInvite("bia@y.com", { expiresAt: "2026-10-06T11:00:00.000Z" });
    expect(await expireRecruiterAccess(deps())).toEqual({ expired: 0, invitesExpired: 1 });
    expect((await invitesOf())[0]).toMatchObject({ status: "expired", decidedAt: T0 });
    expect(await eventsOf()).toEqual([expect.objectContaining({ kind: "invite_expired", actor: "system", recruiterEmail: "bia@y.com" })]);
    expect(sent).toEqual([]);
    expect(await grantsOf()).toEqual([]);
  });

  it("IT-065 a limpeza semanal apaga convites mortos há mais de 30 dias e buscas do diretório com mais de um dia", async () => {
    const old = new Date(Date.parse(T0) - 31 * DAY).toISOString();
    const recent = new Date(Date.parse(T0) - 29 * DAY).toISOString();
    const gone = await Promise.all(
      (["expired", "cancelled", "superseded"] as const).map((status) => rawInvite(`${status}@y.com`, { status, decidedAt: old })),
    );
    const kept = [
      await rawInvite("recente@y.com", { status: "expired", decidedAt: recent }),
      await rawInvite("pendente@y.com", { createdAt: old, expiresAt: old }),
      await rawInvite("aceito@y.com", { status: "accepted", decidedAt: old }),
    ];
    await appendHistory(db, [
      { candidateId: seven, inviteId: gone[0]!, recruiterEmail: "expired@y.com", kind: "invite_expired", actor: "system", at: old },
    ]);
    await db.insert(recruiterDirectoryQuery).values([
      { recruiterUserId: rui, at: new Date(Date.parse(T0) - 2 * DAY).toISOString() },
      { recruiterUserId: rui, at: new Date(Date.parse(T0) - HOUR).toISOString() },
    ]);

    const dry = await runDatabaseCleanup({ now: new Date(T0) });
    expect(dry.candidates.deadInvites).toBe(3);
    const result = await runDatabaseCleanup({ apply: true, now: new Date(T0) });

    expect(result.applied).toMatchObject({ purgedInvites: 3, purgedDirectoryQueries: 1 });
    expect((await invitesOf()).map((row) => row.id).sort()).toEqual([...kept].sort());
    expect(await eventsOf()).toEqual([expect.objectContaining({ inviteId: null, recruiterEmail: "expired@y.com" })]);
    expect(await db.select().from(recruiterDirectoryQuery)).toHaveLength(1);
  });
});

describe("recusas e caminhos sem origem", () => {
  it("IT-037 reenviar também respeita o limite diário e o teto de pendentes", async () => {
    const expired = await rawInvite("bia@y.com", { expiresAt: "2026-10-05T00:00:00.000Z" });
    for (let i = 0; i < 20; i++) await rawInvite(`p${i}@y.com`);
    expect(await resendInvite({ inviteId: expired, candidateId: seven, actorUserId: ana }, deps())).toEqual({
      ok: false,
      error: "too_many_pending",
    });

    await counted(10, new Date(Date.parse(T0) - HOUR).toISOString());
    expect(await resendInvite({ inviteId: expired, candidateId: seven, actorUserId: ana }, deps())).toMatchObject({
      ok: false,
      error: "cap_reached",
    });
  });

  it("IT-051 reenviar convite cujo e-mail já recebeu concessão por outro caminho é already_active", async () => {
    const inviteId = await rawInvite("rui@x.com");
    await rawGrant();
    expect(await resendInvite({ inviteId, candidateId: seven, actorUserId: ana }, deps())).toEqual({
      ok: false,
      error: "already_active",
    });
  });

  it("IT-029 sem origem pública o convite não sai: fica pendente, marcado como não entregue", async () => {
    await grantAccess({ candidateId: seven, actorUserId: ana, email: "bia@y.com", endDate: "", tz: "" }, deps({ origin: null }));
    expect((await invitesOf())[0]).toMatchObject({ status: "pending", deliveryFailedAt: T0 });
    expect(sent).toEqual([]);
  });

  it("IT-044 data de fim inválida recusa antes do banco; sem origem, a mudança vale e o e-mail conta como falha", async () => {
    const grantId = await rawGrant();
    expect(
      await changeEndDate({ grantId, candidateId: seven, actorUserId: ana, endDate: "2040-01-01", tz: "UTC" }, deps()),
    ).toEqual({ ok: false, error: "date_too_far" });
    expect(
      await changeEndDate({ grantId, candidateId: seven, actorUserId: ana, endDate: "2026-10-20", tz: "UTC" }, deps({ origin: null })),
    ).toEqual({ ok: true });
    expect((await grantsOf())[0]!.expiresAt).toBe("2026-10-20T23:59:59.999Z");
    expect(await failures("end_date_changed")).toHaveLength(1);
  });

  it("IT-033 a recusa por limite também fecha a concessão vencida do par e manda o aviso de fim dela", async () => {
    await rawGrant({ expiresAt: "2026-10-06T11:00:00.000Z" });
    await counted(10, new Date(Date.parse(T0) - HOUR).toISOString());
    expect(await grant("rui@x.com")).toMatchObject({ ok: false, error: "cap_reached" });
    expect((await grantsOf())[0]!.status).toBe("expired");
    expect(sent.map((mail) => mail.subject)).toEqual([pt("email.recruiterEndedSubject", { candidate: "Ana" })]);
  });

  it("IT-061 concessão de conta já apagada que vence: aviso no idioma padrão e nome do candidato sem conta", async () => {
    const orphan = await makeCandidate("Sem Conta");
    await rawGrant({ candidateId: orphan, recruiterUserId: null, recruiterEmail: "foi@x.com", status: "revoked", endedAt: T0 });
    await rawGrant({ candidateId: orphan, expiresAt: "2026-10-06T11:00:00.000Z" });
    expect(await expireRecruiterAccess(deps())).toEqual({ expired: 1, invitesExpired: 0 });
    expect(sent[0]!.subject).toBe(pt("email.recruiterEndedSubject", { candidate: "Sem Conta" }));
  });
});

describe("administração", () => {
  it("IT-066 a visão do admin lista concessões ativas e convites pendentes por candidato", async () => {
    const grantId = await rawGrant({ createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T02:59:59.999Z" });
    await rawGrant({ recruiterUserId: admin, recruiterEmail: "dono@x.com", status: "revoked", endedAt: T0 });
    const inviteId = await rawInvite("bia@y.com");
    await rawInvite("caio@y.com", { status: "cancelled" });

    const overview = await drizzleRecruiterAccess.adminOverview([seven, eight], T0);
    expect(overview.get(seven)).toEqual({
      grants: [
        {
          id: grantId,
          recruiterEmail: "rui@x.com",
          recruiterName: "Rui",
          createdAt: "2026-10-01T00:00:00.000Z",
          expiresAt: "2026-12-01T02:59:59.999Z",
          expiryTz: null,
        },
      ],
      invites: [{ id: inviteId, email: "bia@y.com", createdAt: T0, expiresAt: new Date(Date.parse(T0) + DAY).toISOString() }],
    });
    expect(overview.has(eight)).toBe(false);
    expect((await drizzleRecruiterAccess.adminOverview([], T0)).size).toBe(0);
  });

  it("IT-067 o admin revoga: histórico com o nome dele, e-mail de encerramento pela administração, limite do candidato intacto", async () => {
    await counted(3, new Date(Date.parse(T0) - HOUR).toISOString());
    const countedBefore = (await eventsOf()).filter((e) => e.actor === "candidate").length;
    const grantId = await rawGrant();

    expect(await revokeAccess({ grantId, candidateId: null, actor: "admin", actorUserId: admin }, deps())).toEqual({ ok: true });

    expect((await grantsOf())[0]).toMatchObject({ status: "revoked", revokedBy: admin });
    expect((await eventsOf()).at(-1)).toMatchObject({ kind: "access_revoked", actor: "admin", actorName: "Dona Admin" });
    expect(sent[0]!.text).toContain(pt("email.recruiterEndedByAdmin", { candidate: "Ana" }));
    expect((await eventsOf()).filter((e) => e.actor === "candidate")).toHaveLength(countedBefore);
  });

  it("IT-068 o admin cancela o convite em nome próprio", async () => {
    const inviteId = await rawInvite("bia@y.com");
    expect(await cancelInvite({ inviteId, candidateId: null, actor: "admin", actorUserId: admin }, deps())).toEqual({ ok: true });
    expect((await invitesOf())[0]).toMatchObject({ status: "cancelled", cancelledBy: admin });
    expect((await eventsOf())[0]).toMatchObject({ kind: "invite_cancelled", actor: "admin", actorName: "Dona Admin" });
  });

  it("IT-069 ato do admin sobre o que já terminou é already_ended", async () => {
    const grantId = await rawGrant({ status: "revoked", endedAt: T0 });
    const inviteId = await rawInvite("bia@y.com", { status: "accepted" });
    expect(await revokeAccess({ grantId, candidateId: null, actor: "admin", actorUserId: admin }, deps())).toEqual({
      ok: false,
      error: "already_ended",
    });
    expect(await cancelInvite({ inviteId, candidateId: null, actor: "admin", actorUserId: admin }, deps())).toEqual({
      ok: false,
      error: "already_ended",
    });
    expect(sent).toEqual([]);
  });

  it("IT-059 apagar a conta do recrutador tira a concessão da lista, e o histórico guarda o e-mail", async () => {
    await grant("rui@x.com");
    await drizzleUserDirectory.remove(rui);
    const view = await candidateAccessView({ candidateId: seven, historyPage: 1 }, deps());
    expect(view.grants).toEqual([]);
    expect(view.history.rows[0]).toMatchObject({ kind: "access_ended_account_removed", recruiterEmail: "rui@x.com" });
  });
});
