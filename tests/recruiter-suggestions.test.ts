/**
 * Suíte: sugestões de vaga do recrutador e a decisão do candidato (#465,
 * task_04; `_tests.md` IT-115 – IT-140, IT-143).
 *
 * Fronteira DENTRO: o serviço (`app/recruiter-suggestions.ts`) com o store de
 * Drizzle, as migrações e transações reais, a trava por candidato e o
 * histórico; as Server Actions (`suggestJobAction`, `createRecruiterJobAction`,
 * aceitar e recusar) e a tela `/suggestions` com `app/auth.ts` real e a sessão
 * resolvida contra o PostgreSQL de teste. Fronteira FORA: o relógio (meio-dia
 * de hoje), o `Mailer` (que grava ou que lança) e a borda do Next.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type HTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginImpersonation,
  createUser,
  finishLogin,
  recordEmailSendFailure,
  resolveSession,
  startLogin,
  type Mailer,
  type OutgoingMail,
  type Role,
  type Session,
} from "../src/contexts/auth/index.ts";
import {
  candidateSuggestionsView,
  decideSuggestion,
  recruiterSuggestionsView,
  sendDueDigests,
  suggestJob,
  type SuggestionDeps,
} from "../src/contexts/pursuit/app/recruiter-suggestions.ts";
import { drizzleRecruiterSuggestions } from "../src/contexts/pursuit/infra/drizzle-recruiter-suggestions.ts";
import {
  candidateSuggestionsFor,
  decideRecruiterSuggestion,
  followedCandidateName,
  pendingSuggestionCount,
  recruiterCandidateCv,
  recruiterCandidateList,
  recruiterCandidateWorkspace,
  searchJobsToSuggest,
  sendSuggestionDigests,
} from "../src/contexts/pursuit/index.ts";
import { pipelineRows } from "../src/core/db/repo.ts";
import { clock, fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import { ensureCandidate } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  authEvent,
  authUser,
  job,
  jobScore,
  recruiterAccessEvent,
  recruiterGrant,
  recruiterSuggestion,
  recruiterSuggestionBy,
  source,
} from "../src/core/db/schema.ts";
import { UNMEASURED_PAGES, ENGLISH_OWNER_SWEEP } from "./e2e/routes.mjs";
import { discoverEntries, guardComesFirst, SELECTOR_ID_BY_DESIGN } from "./support/entry-inventory.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

const boundary = vi.hoisted(() => ({ token: undefined as string | undefined, effects: [] as string[] }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "jho_session" && boundary.token !== undefined ? { name, value: boundary.token } : undefined,
    getAll: () => [],
    has: (name: string) => name === "jho_session" && boundary.token !== undefined,
    set: (name: string) => void boundary.effects.push(`cookies.set(${name})`),
    delete: (name: string) => void boundary.effects.push(`cookies.delete(${name})`),
  }),
  headers: async () => new Headers({ host: "127.0.0.1:3000" }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    boundary.effects.push(`redirect(${to})`);
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
  forbidden: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  },
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => void boundary.effects.push(`revalidatePath(${path})`),
  revalidateTag: () => {},
  refresh: () => {},
}));
vi.mock("../app/transition-link.tsx", () => ({
  TransitionLink: (props: HTMLAttributes<HTMLElement> & { href: string }) => createElement("a", props),
}));
vi.mock("../app/mutation-feedback.tsx", () => ({ publishMutationFeedback: () => {} }));

const { suggestJobAction } = await import("../app/recruiter/[candidateId]/suggest/actions.ts");
const { createRecruiterJobAction } = await import("../app/jobs/new/actions.ts");
const { acceptSuggestionAction, declineSuggestionAction } = await import("../app/suggestions/actions.ts");
const { default: SuggestionsPage } = await import("../app/suggestions/page.tsx");

const T0 = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000 + 12 * 3_600_000).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ORIGIN = "https://jobs.test";
const at = (offsetMs: number) => new Date(Date.parse(T0) + offsetMs).toISOString();

type Account = { id: number; email: string; token: string };

let db: DB;
let time: ReturnType<typeof fixedClock>;
let sent: OutgoingMail[];
let mailer: Mailer;
let ana: number;
let bruno: number;
let anaUser: Account;
let brunoUser: Account;
let rui: Account;
let sara: Account;
let ruiGrant: number;
let saraGrant: number;

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

function deps(over: Partial<SuggestionDeps> = {}): SuggestionDeps {
  return {
    store: drizzleRecruiterSuggestions,
    mailer: () => mailer,
    recordFailure: recordEmailSendFailure,
    now: () => clock().now(),
    origin: ORIGIN,
    ...over,
  };
}

async function login(email: string, roles: Role[], candidateId: number | null = null): Promise<Account> {
  const { id } = await createUser({ email, fullName: email.split("@")[0], roles, candidateId });
  const { token } = await startLogin(email);
  const result = await finishLogin(token);
  if (!result) throw new Error(`login de ${email} falhou`);
  return { id, email, token: result.token };
}

async function grant(recruiter: Account, candidateId: number): Promise<number> {
  const [row] = await db
    .insert(recruiterGrant)
    .values({ candidateId, recruiterUserId: recruiter.id, recruiterEmail: recruiter.email, createdAt: at(-HOUR) })
    .returning({ id: recruiterGrant.id });
  return row!.id;
}

async function session(token: string): Promise<Session> {
  const resolved = await resolveSession(token);
  if (!resolved) throw new Error("sessão não resolveu");
  return resolved;
}

let jobSeq = 0;
async function seedJob(title?: string, over: Partial<typeof job.$inferInsert> = {}): Promise<number> {
  const n = ++jobSeq;
  const [row] = await db
    .insert(job)
    .values({
      fingerprint: `fp:${n}`,
      contentHash: `h:${n}`,
      sourceId: "web:test",
      externalId: String(n),
      companyName: `Empresa ${n}`,
      title: title ?? `Vaga ${n}`,
      url: `https://example.test/${n}`,
      raw: {},
      ...over,
    })
    .returning({ id: job.id });
  return row!.id;
}

function suggest(recruiter: Account, jobId: number, note = "", candidateId = ana, over: Partial<SuggestionDeps> = {}) {
  return suggestJob({ candidateId, jobId, recruiterUserId: recruiter.id, recruiterEmail: recruiter.email, note }, deps(over));
}

function form(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  return data;
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify((await run()) ?? null);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function render(page: Promise<unknown>): Promise<string> {
  try {
    return renderToStaticMarkup((await page) as Parameters<typeof renderToStaticMarkup>[0]);
  } catch (error) {
    return `THROWN:${error instanceof Error ? error.message : String(error)}`;
  }
}

const suggestionsPage = (params: Record<string, string> = {}) => render(SuggestionsPage({ searchParams: Promise.resolve(params) }));

async function suggestions() {
  return db.select().from(recruiterSuggestion).orderBy(recruiterSuggestion.id);
}
async function authors() {
  return db.select().from(recruiterSuggestionBy).orderBy(recruiterSuggestionBy.id);
}
async function eventsOf(kind: string) {
  return db.select().from(recruiterAccessEvent).where(eq(recruiterAccessEvent.kind, kind));
}

/** Uma sugestão já gravada, sem passar pelo limite: para montar listas grandes. */
async function seedSuggestion(input: {
  recruiter: Account;
  grantId: number | null;
  jobId: number;
  candidateId?: number;
  status?: "pending" | "accepted" | "declined";
  createdAt?: string;
  note?: string | null;
  notifiedAt?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(recruiterSuggestion)
    .values({
      candidateId: input.candidateId ?? ana,
      jobId: input.jobId,
      status: input.status ?? "pending",
      createdAt: input.createdAt ?? T0,
      decidedAt: input.status && input.status !== "pending" ? T0 : null,
    })
    .returning({ id: recruiterSuggestion.id });
  await db.insert(recruiterSuggestionBy).values({
    suggestionId: row!.id,
    recruiterUserId: input.recruiter.id,
    recruiterEmail: input.recruiter.email,
    grantId: input.grantId,
    note: input.note ?? null,
    createdAt: input.createdAt ?? T0,
    notifiedAt: input.notifiedAt === undefined ? T0 : input.notifiedAt,
  });
  return row!.id;
}

beforeEach(async () => {
  db = await useTestDb();
  time = fixedClock(T0);
  setClock(time);
  sent = [];
  mailer = recording;
  boundary.token = undefined;
  boundary.effects = [];
  await db.insert(source).values({ id: "web:test", kind: "greenhouse", handle: "test", label: "Fonte de teste" });
  ana = await ensureCandidate({ slug: "ana", name: "Ana" });
  bruno = await ensureCandidate({ slug: "bruno", name: "Bruno" });
  anaUser = await login("ana@x.com", ["candidate"], ana);
  brunoUser = await login("bruno@x.com", ["candidate"], bruno);
  rui = await login("rui@x.com", ["recruiter"]);
  sara = await login("sara@x.com", ["recruiter"]);
  ruiGrant = await grant(rui, ana);
  saraGrant = await grant(sara, ana);
});

afterEach(async () => {
  resetClock();
  await releaseTestDb();
});

describe("criar a sugestão", () => {
  it("IT-115 sugestão pendente, autor com a concessão vigente, evento, nenhuma candidatura e um aviso à Ana", async () => {
    const jobId = await seedJob("Backend Sênior");
    expect(await suggest(rui, jobId, "Fits you")).toEqual({ ok: true, kind: "create" });

    const [row] = await suggestions();
    expect(row).toMatchObject({ candidateId: ana, jobId, status: "pending", applicationId: null });
    const [by] = await authors();
    expect(by).toMatchObject({ recruiterUserId: rui.id, grantId: ruiGrant, note: "Fits you", notifiedAt: T0 });
    const [event] = await eventsOf("suggestion_received");
    expect(event).toMatchObject({ candidateId: ana, actor: "recruiter", suggestionId: row!.id, recruiterEmail: "rui@x.com" });
    expect(await db.select().from(application)).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("ana@x.com");
    expect(sent[0]!.text).toContain("Backend Sênior");
    expect(sent[0]!.text).toContain(`${ORIGIN}/suggestions`);
    // A nota fica na tela, nunca no e-mail.
    expect(sent[0]!.text).not.toContain("Fits you");
  });

  it("IT-116 a segunda em 10 min não avisa; a varredura uma hora depois manda um aviso só, e os dois ficam avisados", async () => {
    const first = await seedJob("Primeira vaga");
    const second = await seedJob("Segunda vaga");
    await suggest(rui, first);
    time.advance(10 * MINUTE);
    await suggest(rui, second);
    expect(sent).toHaveLength(1);
    expect((await authors()).map((row) => row.notifiedAt)).toEqual([T0, null]);

    time.set(at(59 * MINUTE));
    expect(await sendDueDigests(deps())).toEqual({ digests: 0 });
    time.set(at(60 * MINUTE));
    expect(await sendDueDigests(deps())).toEqual({ digests: 1 });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain("Segunda vaga");
    expect((await authors()).every((row) => row.notifiedAt !== null)).toBe(true);
    expect(await sendDueDigests(deps())).toEqual({ digests: 0 });
  });

  it("IT-117 a mesma vaga ainda pendente: already_suggested e nenhum e-mail", async () => {
    const jobId = await seedJob();
    await suggest(rui, jobId);
    time.advance(2 * HOUR);
    expect(await suggest(rui, jobId)).toEqual({ ok: false, error: "already_suggested" });
    expect(sent).toHaveLength(1);
    expect(await authors()).toHaveLength(1);
  });

  it("IT-118 Rui e Sara sugerem a mesma vaga: uma sugestão, dois autores, os dois nomes para a Ana", async () => {
    const jobId = await seedJob();
    expect(await suggest(rui, jobId)).toEqual({ ok: true, kind: "create" });
    expect(await suggest(sara, jobId, "Também acho")).toEqual({ ok: true, kind: "join" });
    expect(await suggestions()).toHaveLength(1);
    expect(await authors()).toHaveLength(2);
    const view = await candidateSuggestionsView(
      { candidateId: ana, page: undefined, activeGrantIds: [] },
      { store: drizzleRecruiterSuggestions },
    );
    expect(view.rows[0]!.recruiters.map((author) => author.name)).toEqual(["rui", "sara"]);
  });

  it("IT-119 vaga que já está no funil: sugestão pendente, resposta igual à de quem não está", async () => {
    const inFunnel = await seedJob();
    const outside = await seedJob();
    await db.insert(application).values({ candidateId: ana, jobId: inFunnel, status: "interviewing" });
    const a = await suggest(rui, inFunnel);
    const b = await suggest(rui, outside);
    expect(a).toEqual(b);
    expect((await suggestions()).map((row) => row.status)).toEqual(["pending", "pending"]);
  });

  it("IT-120 vaga fechada e vaga arquivada: job_closed", async () => {
    const closed = await seedJob(undefined, { closedAt: at(-HOUR) });
    const archived = await seedJob(undefined, { closedAt: at(-2 * HOUR), archivedAt: at(-HOUR) });
    expect(await suggest(rui, closed)).toEqual({ ok: false, error: "job_closed" });
    expect(await suggest(rui, archived)).toEqual({ ok: false, error: "job_closed" });
    expect(await suggestions()).toEqual([]);
  });

  it("IT-121 concessão revogada entre abrir e enviar: a action responde 404 e nada é criado", async () => {
    const jobId = await seedJob();
    boundary.token = rui.token;
    await db.update(recruiterGrant).set({ status: "revoked", endedAt: T0 }).where(eq(recruiterGrant.id, ruiGrant));
    expect(await outcome(() => suggestJobAction(form({ candidateId: ana, jobId, note: "" })))).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
    // E sob a trava: a sessão ainda viu a concessão, o store já não.
    expect(await suggest(rui, jobId)).toEqual({ ok: false, error: "not_found" });
    expect(await suggestions()).toEqual([]);
  });

  it("IT-122 vinte em 24 h: a 21ª recusa com retryAt; com 19, dois envios simultâneos e só um passa", async () => {
    for (let i = 0; i < 20; i++) {
      await seedSuggestion({ recruiter: rui, grantId: ruiGrant, jobId: await seedJob(), createdAt: at(-23 * HOUR + i * MINUTE) });
    }
    expect(await suggest(rui, await seedJob())).toEqual({ ok: false, error: "cap_reached", retryAt: at(HOUR) });

    const ruiOnBruno = await grant(rui, bruno);
    for (let i = 0; i < 19; i++) {
      await seedSuggestion({ recruiter: rui, grantId: ruiOnBruno, candidateId: bruno, jobId: await seedJob(), createdAt: at(-HOUR) });
    }
    const results = await Promise.all([
      suggest(rui, await seedJob(), "", bruno),
      suggest(rui, await seedJob(), "", bruno),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, error: "cap_reached" });
  });

  it("IT-123 dois envios idênticos simultâneos: uma sugestão e um e-mail", async () => {
    const jobId = await seedJob();
    const results = await Promise.all([suggest(rui, jobId), suggest(rui, jobId)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, error: "already_suggested" });
    expect(await suggestions()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("IT-124 /jobs/new com suggestFor: vaga e sugestão e volta à Ana; título vazio não sugere; candidato sem vínculo é 404 sem vaga", async () => {
    boundary.token = rui.token;
    const valid = { title: "Engenheira de Dados", companyName: "Acme", description: "Pipelines de dados em escala.", note: "Olha esta" };
    expect(await outcome(() => createRecruiterJobAction(form({ ...valid, suggestFor: ana })))).toBe(`NEXT_REDIRECT;/recruiter/${ana}`);
    const [row] = await suggestions();
    expect(row).toMatchObject({ candidateId: ana, status: "pending" });
    const [created] = await db.select().from(job).where(eq(job.id, row!.jobId));
    expect(created!.title).toBe("Engenheira de Dados");

    const jobsBefore = (await db.select({ n: count() }).from(job))[0]!.n;
    expect(await outcome(() => createRecruiterJobAction(form({ ...valid, title: "", suggestFor: ana })))).toMatch(/cargo/);
    expect(await outcome(() => createRecruiterJobAction(form({ ...valid, suggestFor: bruno })))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect((await db.select({ n: count() }).from(job))[0]!.n).toBe(jobsBefore);
    expect(await suggestions()).toHaveLength(1);
  });

  it("IT-125 aviso que falha: a sugestão fica, a falha é registrada e o lote volta a ficar sem aviso", async () => {
    const jobId = await seedJob();
    expect(await suggest(rui, jobId, "", ana, { mailer: () => throwing })).toEqual({ ok: true, kind: "create" });
    expect(await suggestions()).toHaveLength(1);
    const failures = await db.select().from(authEvent).where(eq(authEvent.kind, "email_send_failed"));
    expect(failures.map((row) => row.detail)).toEqual(["suggestions"]);
    expect((await authors())[0]!.notifiedAt).toBeNull();
  });

  it("IT-126 nota de 501 caracteres não grava nada; `<b>hi</b>` é guardada como veio e aparece escapada", async () => {
    const jobId = await seedJob();
    expect(await suggest(rui, jobId, "x".repeat(501))).toEqual({ ok: false, error: "note_too_long" });
    expect(await suggestions()).toEqual([]);
    expect(await eventsOf("suggestion_received")).toEqual([]);

    expect(await suggest(rui, jobId, "<b>hi</b>")).toEqual({ ok: true, kind: "create" });
    expect((await authors())[0]!.note).toBe("<b>hi</b>");
    boundary.token = anaUser.token;
    const html = await suggestionsPage();
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).not.toContain("<b>hi</b>");
  });
});

describe("as sugestões do recrutador", () => {
  it("IT-127 só as dele na concessão vigente, mais novas primeiro, 20 por página, com estado, decisão e 'encerrada'", async () => {
    const s = await session(rui.token);
    const empty = await recruiterCandidateWorkspace(s, ana, { page: undefined, suggestionsPage: undefined });
    expect(empty!.suggestions.rows).toEqual([]);

    const ids: number[] = [];
    for (let i = 0; i < 22; i++) {
      ids.push(await seedSuggestion({ recruiter: rui, grantId: ruiGrant, jobId: await seedJob(`Rui ${i}`), createdAt: at(-(30 - i) * HOUR) }));
    }
    await seedSuggestion({ recruiter: sara, grantId: null, jobId: await seedJob("Da Sara") });
    const [newest] = await db.select({ jobId: recruiterSuggestion.jobId }).from(recruiterSuggestion).where(eq(recruiterSuggestion.id, ids[21]!));
    await db.update(job).set({ closedAt: T0 }).where(eq(job.id, newest!.jobId));
    await db.update(recruiterSuggestion).set({ status: "accepted", decidedAt: T0 }).where(eq(recruiterSuggestion.id, ids[20]!));

    const first = await recruiterCandidateWorkspace(s, ana, { page: undefined, suggestionsPage: undefined });
    const second = await recruiterCandidateWorkspace(s, ana, { page: undefined, suggestionsPage: "2" });
    expect(first!.suggestions.total).toBe(22);
    expect(first!.suggestions.rows).toHaveLength(20);
    expect(second!.suggestions.rows).toHaveLength(2);
    expect(first!.suggestions.rows.map((row) => row.title).slice(0, 2)).toEqual(["Rui 21", "Rui 20"]);
    expect(first!.suggestions.rows[0]).toMatchObject({ status: "pending", jobClosed: true });
    expect(first!.suggestions.rows[1]).toMatchObject({ status: "accepted", decidedAt: T0 });
    expect([...first!.suggestions.rows, ...second!.suggestions.rows].some((row) => row.title === "Da Sara")).toBe(false);
  });

  it("IT-128 acabada a concessão, a lista dele some; numa concessão nova, só o que veio nela", async () => {
    await seedSuggestion({ recruiter: rui, grantId: ruiGrant, jobId: await seedJob("Da concessão antiga") });
    await db.update(recruiterGrant).set({ status: "revoked", endedAt: T0 }).where(eq(recruiterGrant.id, ruiGrant));
    const ended = await recruiterSuggestionsView(
      { recruiterUserId: rui.id, candidateId: ana, grantId: null, page: undefined },
      { store: drizzleRecruiterSuggestions },
    );
    expect(ended.rows).toEqual([]);

    await grant(rui, ana);
    time.advance(MINUTE);
    expect(await suggest(rui, await seedJob("Da concessão nova"))).toMatchObject({ ok: true });
    const view = await recruiterCandidateWorkspace(await session(rui.token), ana, { page: undefined, suggestionsPage: undefined });
    expect(view!.suggestions.rows.map((row) => row.title)).toEqual(["Da concessão nova"]);
  });
});

describe("aceitar e recusar", () => {
  async function pending(recruiter = rui, jobId?: number): Promise<number> {
    const id = jobId ?? (await seedJob());
    await suggest(recruiter, id);
    const [row] = await db
      .select({ id: recruiterSuggestion.id })
      .from(recruiterSuggestion)
      .where(and(eq(recruiterSuggestion.jobId, id), eq(recruiterSuggestion.candidateId, ana)));
    return row!.id;
  }

  const decide = (suggestionId: number, decision: "accept" | "decline", candidateId = ana, actorUserId = anaUser.id) =>
    decideSuggestion({ suggestionId, candidateId, actorUserId, decision }, deps());

  it("IT-129 aceitar sem candidatura: Backlog com canal recrutador, sugestão aceita, evento, marcador no funil, Rui vê Aceita", async () => {
    const id = await pending();
    boundary.token = anaUser.token;
    expect(await acceptSuggestionAction(form({ suggestionId: id }))).toEqual({ ok: true });
    const [created] = await db.select().from(application);
    expect(created).toMatchObject({ candidateId: ana, status: "backlog", channel: "recruiter" });
    const [row] = await suggestions();
    expect(row).toMatchObject({ status: "accepted", applicationId: created!.id, decidedAt: T0 });
    expect(await eventsOf("suggestion_accepted")).toHaveLength(1);
    const [funnel] = await pipelineRows(ana);
    expect(funnel!.suggestedByRecruiter).toBe(true);
    const mine = await recruiterSuggestionsView(
      { recruiterUserId: rui.id, candidateId: ana, grantId: ruiGrant, page: undefined },
      { store: drizzleRecruiterSuggestions },
    );
    expect(mine.rows[0]!.status).toBe("accepted");
  });

  it("IT-130 dois aceites simultâneos: uma candidatura e um evento", async () => {
    const id = await pending();
    const results = await Promise.all([decide(id, "accept"), decide(id, "accept")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.select().from(application)).toHaveLength(1);
    expect(await eventsOf("suggestion_accepted")).toHaveLength(1);
  });

  it("IT-131 candidatura em entrevista por indicação: fica como estava; a sugestão é aceita", async () => {
    const jobId = await seedJob();
    const [existing] = await db
      .insert(application)
      .values({ candidateId: ana, jobId, status: "interviewing", channel: "referral" })
      .returning();
    const id = await pending(rui, jobId);
    expect(await decide(id, "accept")).toEqual({ ok: true });
    const [after] = await db.select().from(application);
    expect(after).toEqual(existing);
    expect((await suggestions())[0]).toMatchObject({ status: "accepted", applicationId: existing!.id });
  });

  it("IT-132 aceitar uma recusada: already_decided", async () => {
    const id = await pending();
    await decide(id, "decline");
    expect(await decide(id, "accept")).toEqual({ ok: false, error: "already_decided" });
    expect(await db.select().from(application)).toEqual([]);
  });

  it("IT-133 aceitar depois de revogado o acesso do Rui: funciona", async () => {
    const id = await pending();
    await db.update(recruiterGrant).set({ status: "revoked", endedAt: T0 }).where(eq(recruiterGrant.id, ruiGrant));
    expect(await decide(id, "accept")).toEqual({ ok: true });
    expect(await db.select().from(application)).toHaveLength(1);
  });

  it("IT-134 Bruno aceitando a sugestão da Ana: not_found, nada muda", async () => {
    const id = await pending();
    boundary.token = brunoUser.token;
    expect(await acceptSuggestionAction(form({ suggestionId: id }))).toEqual({ ok: false, error: "not_found" });
    expect((await suggestions())[0]!.status).toBe("pending");
    expect(await db.select().from(application)).toEqual([]);
  });

  it("IT-135 recusar: recusada, evento, funil intocado; recusar de novo não decide duas vezes; recusar a aceita é already_decided", async () => {
    const jobId = await seedJob();
    await db.insert(application).values({ candidateId: ana, jobId: await seedJob(), status: "applied" });
    const before = await db.select().from(application);
    const id = await pending(rui, jobId);
    expect(await decide(id, "decline")).toEqual({ ok: true });
    expect(await decide(id, "decline")).toEqual({ ok: false, error: "already_decided" });
    expect((await suggestions())[0]).toMatchObject({ status: "declined", applicationId: null, decidedAt: T0 });
    expect(await eventsOf("suggestion_declined")).toHaveLength(1);
    expect(await db.select().from(application)).toEqual(before);

    const accepted = await pending();
    await decide(accepted, "accept");
    expect(await decide(accepted, "decline")).toEqual({ ok: false, error: "already_decided" });
  });

  it("IT-136 depois de recusada, o mesmo recrutador sugerindo a mesma vaga: already_decided_by_candidate", async () => {
    const jobId = await seedJob();
    const id = await pending(rui, jobId);
    await decide(id, "decline");
    expect(await suggest(rui, jobId)).toEqual({ ok: false, error: "already_decided_by_candidate" });
  });

  it("IT-137 Bruno recusando a sugestão da Ana: not_found", async () => {
    const id = await pending();
    boundary.token = brunoUser.token;
    expect(await declineSuggestionAction(form({ suggestionId: id }))).toEqual({ ok: false, error: "not_found" });
    expect((await suggestions())[0]!.status).toBe("pending");
  });

  it("IT-138 sessão emprestada: aceitar e recusar são negados, e /suggestions não tem os botões", async () => {
    const id = await pending();
    const admin = await login("admin@x.com", ["admin"]);
    const borrowed = await beginImpersonation(await session(admin.token), anaUser.id);
    if (!borrowed.ok) throw new Error(borrowed.reason);
    boundary.token = borrowed.token;
    boundary.effects = [];
    expect(await outcome(() => acceptSuggestionAction(form({ suggestionId: id })))).toMatch(/^negado: suggestion:decide — sessão emprestada/);
    expect(await outcome(() => declineSuggestionAction(form({ suggestionId: id })))).toMatch(/^negado: suggestion:decide — sessão emprestada/);
    expect(boundary.effects).toEqual([]);
    expect((await suggestions())[0]!.status).toBe("pending");
    const html = await suggestionsPage();
    expect(html).toContain('data-testid="suggestion-item"');
    expect(html).toContain('data-testid="suggestions-borrowed"');
    expect(html).not.toContain('data-testid="suggestion-accept"');
    expect(html).not.toContain('data-testid="suggestion-decline"');
  });
});

describe("a tela do candidato", () => {
  it("IT-139 cem pendentes: 20 por página com vaga, empresa, nota, recrutador, nota dele e data; acesso encerrado e vaga fechada marcados; vazio explica", async () => {
    boundary.token = anaUser.token;
    expect(await suggestionsPage()).toContain('data-testid="suggestions-empty"');

    const trackId = await primaryTrackId(db, ana);
    const scored = await seedJob("Vaga com nota");
    await db.insert(jobScore).values({
      candidateId: ana, trackId, jobId: scored, fit: 77, titleScore: 1, keywordScore: 1, seniorityScore: 1, geoScore: 1,
      compScore: 1, freshnessScore: 1, benefitScore: 1, penalty: 0, cluster: "x", matchedKeywords: [], missingKeywords: [],
      reasons: [], blockers: [], scorerVersion: "t", profileHash: "t",
    });
    await seedSuggestion({ recruiter: rui, grantId: ruiGrant, jobId: scored, createdAt: at(MINUTE), note: "Nota do Rui" });
    const closedJob = await seedJob("Vaga fechada", { closedAt: T0 });
    await seedSuggestion({ recruiter: rui, grantId: ruiGrant, jobId: closedJob, createdAt: at(2 * MINUTE) });
    await seedSuggestion({ recruiter: sara, grantId: saraGrant, jobId: await seedJob("De acesso encerrado"), createdAt: at(3 * MINUTE) });
    await db.update(recruiterGrant).set({ status: "revoked", endedAt: T0 }).where(eq(recruiterGrant.id, saraGrant));
    for (let i = 0; i < 97; i++) {
      await seedSuggestion({ recruiter: rui, grantId: ruiGrant, jobId: await seedJob(`Lote ${i}`), createdAt: at(-i * MINUTE) });
    }

    const html = await suggestionsPage();
    expect(html.match(/data-testid="suggestion-item"/g)).toHaveLength(20);
    expect(html).toContain("Página 1 de 5");
    const ended = html.slice(html.indexOf("De acesso encerrado"));
    expect(ended).toContain('data-testid="suggestion-access-ended"');
    expect(ended.slice(0, ended.indexOf("</li>"))).toContain('data-testid="suggestion-accept"');
    const closed = html.slice(html.indexOf("Vaga fechada"));
    expect(closed.slice(0, closed.indexOf("</li>"))).toContain("vaga encerrada");
    const withScore = html.slice(html.indexOf("Vaga com nota"));
    const item = withScore.slice(0, withScore.indexOf("</li>"));
    expect(item).toContain("Nota: 77");
    expect(item).toContain("Nota do Rui");
    expect(item).toContain(">rui<");
    expect(item).toContain('data-testid="suggestion-company"');
    expect(item).toContain("sugerida em");
  }, 30_000);

  it("IT-140 a contagem da navegação é a das pendentes do candidato da sessão (3 pendentes, 2 decididas → 3)", async () => {
    for (const status of ["pending", "pending", "pending", "accepted", "declined"] as const) {
      await seedSuggestion({ recruiter: rui, grantId: ruiGrant, jobId: await seedJob(), status });
    }
    await seedSuggestion({ recruiter: rui, grantId: null, jobId: await seedJob(), candidateId: bruno });
    expect(await pendingSuggestionCount(await session(anaUser.token))).toBe(3);
    expect(await pendingSuggestionCount(await session(rui.token))).toBe(0);
    expect(await pendingSuggestionCount(null)).toBe(0);
  });
});

describe("bordas da fachada e do aviso", () => {
  it("a busca de sugerir acha vagas abertas por título ou empresa, com curinga literal; vazia, as mais novas", async () => {
    const s = await session(rui.token);
    const byTitle = await seedJob("Backend Pleno");
    await seedJob("Backend Fechada", { closedAt: T0 });
    const byCompany = await seedJob("Plataforma", { companyName: "Backline" });
    const percent = await seedJob("Remoto 100%");
    const ids = (rows: { id: number }[]) => rows.map((row) => row.id).sort((a, b) => a - b);
    expect(ids(await searchJobsToSuggest(s, ana, "back"))).toEqual([byTitle, byCompany].sort((a, b) => a - b));
    expect(ids(await searchJobsToSuggest(s, ana, "%"))).toEqual([percent]);
    expect((await searchJobsToSuggest(s, ana, "")).map((row) => row.id)).toEqual([percent, byCompany, byTitle]);
    expect(() => searchJobsToSuggest(s, bruno, "back")).toThrow(/negado: suggestion:create/);
  });

  it("a varredura monta o link pela origem do ambiente e manda pelo e-mail configurado", async () => {
    const sink = mkdtempSync(join(tmpdir(), "jho-sugestoes-"));
    process.env.JHO_MAIL_SINK = sink;
    process.env.JHO_PUBLIC_URL = "https://jobs.example";
    try {
      await seedSuggestion({ recruiter: rui, grantId: ruiGrant, jobId: await seedJob("Vaga da varredura"), notifiedAt: null });
      expect(await sendSuggestionDigests()).toEqual({ digests: 1 });
      const [file] = readdirSync(sink).filter((name) => name.endsWith(".json"));
      const mail = JSON.parse(readFileSync(join(sink, file!), "utf8")) as OutgoingMail;
      expect(mail.to).toBe("ana@x.com");
      expect(mail.text).toContain("Vaga da varredura");
      expect(mail.text).toContain("https://jobs.example/suggestions");
    } finally {
      delete process.env.JHO_MAIL_SINK;
      delete process.env.JHO_PUBLIC_URL;
      rmSync(sink, { recursive: true, force: true });
    }
  });

  it("sem link ou sem destinatário, o aviso conta como falha e o lote volta para a próxima varredura", async () => {
    const lonely = await ensureCandidate({ slug: "sem-conta", name: "Sem conta" });
    await grant(rui, lonely);
    expect(await suggest(rui, await seedJob(), "", lonely)).toMatchObject({ ok: true });
    expect(await suggest(rui, await seedJob(), "", ana, { origin: null })).toMatchObject({ ok: true });
    expect(sent).toEqual([]);
    const failures = await db.select().from(authEvent).where(eq(authEvent.kind, "email_send_failed"));
    expect(failures).toHaveLength(2);
    expect((await authors()).every((row) => row.notifiedAt === null)).toBe(true);
    // Nada pendente sem aviso, ou aviso dentro da hora: a reserva não devolve lote.
    expect(await drizzleRecruiterSuggestions.claimDigest({ recruiterUserId: sara.id, candidateId: ana, nowIso: T0 })).toBeNull();
    await drizzleRecruiterSuggestions.releaseDigest([], T0);
  });

  it("vaga que não existe é not_found; o aviso sai no idioma da conta da candidata", async () => {
    expect(await suggest(rui, 999_999_999)).toEqual({ ok: false, error: "not_found" });
    await db.update(authUser).set({ locale: "en" }).where(eq(authUser.id, anaUser.id));
    expect(await suggest(rui, await seedJob("English digest"))).toMatchObject({ ok: true });
    expect(sent[0]!.subject).toBe("rui suggested jobs for you");
  });

  it("decidir e ler sugestões exigem o candidato da própria sessão", async () => {
    const recruiterSession = await session(rui.token);
    expect(() => decideRecruiterSuggestion(recruiterSession, 1, "accept")).toThrow(/negado: suggestion:decide/);
    await expect(candidateSuggestionsFor(recruiterSession, undefined)).rejects.toThrow(/negado: candidate:read/);
    await seedSuggestion({ recruiter: rui, grantId: ruiGrant, jobId: await seedJob() });
    const view = await candidateSuggestionsFor(await session(anaUser.token), ["1", "2"]);
    expect(view.rows).toHaveLength(1);
  });

  it("fachada: sem concessão não há lista nem último acesso; candidato que sumiu responde nulo", async () => {
    const candidateOnly = await session(anaUser.token);
    expect((await recruiterCandidateList(candidateOnly, undefined)).rows).toEqual([]);
    const s = await session(rui.token);
    const ghost: Session = { ...s, linkedCandidateIds: [...s.linkedCandidateIds, 999_999] };
    expect(await recruiterCandidateWorkspace(ghost, 999_999, { page: undefined, suggestionsPage: undefined })).toBeNull();
    expect(await recruiterCandidateCv(ghost, 999_999)).toBeNull();
    expect(await followedCandidateName(ghost, 999_999)).toBeNull();
  });
});

describe("inventário", () => {
  it("IT-143 rotas novas na política, actions no inventário, id do recrutador como exceção registrada, /suggestions nas varreduras", () => {
    const { pages, routes, serverModules } = discoverEntries();
    const architecture = readFileSync("tests/architecture.test.ts", "utf8");
    for (const [page, guard] of [
      ["app/recruiter/[candidateId]/cv/page.tsx", 'requirePage("candidate:read", { kind: "candidate", candidateId })'],
      ["app/recruiter/[candidateId]/suggest/page.tsx", 'requirePage("suggestion:create", { kind: "candidate", candidateId })'],
      ["app/suggestions/page.tsx", 'requireOwnCandidatePage("candidate:read")'],
    ] as const) {
      expect(pages).toContain(page);
      expect(architecture).toContain(`"${page}": {`);
      expect(readFileSync(page, "utf8")).toContain(guard);
    }
    expect(routes).toContain("app/recruiter/[candidateId]/cv/download/route.ts");
    expect(readFileSync("app/recruiter/[candidateId]/cv/download/route.ts", "utf8")).toContain(
      'await requirePage("candidate:read", { kind: "candidate", candidateId })',
    );

    for (const [file, name, guard] of [
      ["app/recruiter/[candidateId]/suggest/actions.ts", "suggestJobAction", /await guard\("job:read"\)[\s\S]*authorize\(session, "suggestion:create"/],
      ["app/suggestions/actions.ts", "acceptSuggestionAction", /await guardOwnCandidate\("suggestion:decide"\)/],
      ["app/suggestions/actions.ts", "declineSuggestionAction", /await guardOwnCandidate\("suggestion:decide"\)/],
    ] as const) {
      expect(serverModules).toContain(file);
      const code = readFileSync(file, "utf8");
      expect(guardComesFirst(code, name)).toEqual({ ok: true });
      const body = code.slice(code.indexOf(`function ${name}(`));
      expect(body.slice(0, body.indexOf("\n}"))).toMatch(guard);
    }
    expect(SELECTOR_ID_BY_DESIGN.get("suggestJobAction")?.file).toBe("app/recruiter/[candidateId]/suggest/actions.ts");
    expect(SELECTOR_ID_BY_DESIGN.get("createRecruiterJobAction")?.file).toBe("app/jobs/new/actions.ts");
    expect(readFileSync("tests/entry-denial.test.ts", "utf8")).toContain("IT-143");
    expect(ENGLISH_OWNER_SWEEP).toContain("/suggestions");
    expect(Object.keys(UNMEASURED_PAGES)).toEqual(
      expect.arrayContaining(["app/recruiter/[candidateId]/cv/page.tsx", "app/recruiter/[candidateId]/suggest/page.tsx"]),
    );
  });
});
