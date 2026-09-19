import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorize,
  AuthorizationError,
  beginImpersonation,
  candidateScope,
  createUser,
  linkRecruiterToCandidate,
  resolveSession,
  type Session,
} from "../src/contexts/auth/index.ts";
import {
  createTrack,
  listBoard,
  listCandidateTracks,
  newCount,
  saveTerm,
  setMatchingProfile,
  suggestTrack,
  targetOf,
  type Track,
} from "../src/contexts/matching/index.ts";
import { setVisibility, setPublicCv } from "../src/core/candidate.ts";
import { publicProfile } from "../src/core/candidate-public.ts";
import type { DB } from "../src/core/db/client.ts";
import { authEvent, candidate, company, job, savedTerm, source, targetTrack, termAttribution } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Quem alcança termos e trilhas. `guardOwnCandidate` é dublado pela mesma
 * sequência do `app/auth.ts` — escopo da sessão, depois a política real —,
 * porque o original lê o cookie do Next. O resto é o de produção.
 */
const state = vi.hoisted(() => ({ session: null as unknown, after: 0 }));

vi.mock("../app/auth", async () => {
  const { authorize: policy, candidateScope: scope } = await import("../src/contexts/auth/index.ts");
  return {
    guardOwnCandidate: async (action: Parameters<typeof policy>[1]) => {
      const session = state.session as Session | null;
      const candidateId = scope(session);
      if (candidateId === null) throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
      policy(session, action, { kind: "candidate", candidateId });
      return { session, candidateId };
    },
  };
});
vi.mock("next/server", () => ({ after: () => void state.after++ }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));
vi.mock("../app/mutation-feedback-server", () => ({ setMutationFeedbackCookie: async () => undefined }));

const actions = await import("../app/searches/actions.ts");

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  state.session = null;
  state.after = 0;
});

afterEach(async () => {
  await releaseTestDb();
});

function session(overrides: Partial<Session>): Session {
  return {
    userId: 1,
    candidateId: null,
    roles: [],
    email: "someone@example.test",
    fullName: null,
    expiresAt: "2999-01-01T00:00:00.000Z",
    linkedCandidateIds: [],
    impersonatedBy: null,
    ...overrides,
  };
}

async function person(slug: string, owner = false): Promise<number> {
  const [row] = await db.insert(candidate).values({ slug, name: slug, isDefault: owner }).returning();
  await setMatchingProfile(row!.id, await loadProfile(true));
  return row!.id;
}

async function phpTrack(candidateId: number): Promise<Track> {
  const created = await createTrack(candidateId, {
    name: "PHP",
    target: suggestTrack({ term: "PHP", catalog: [], primary: targetOf(await loadProfile(true)) }).target,
  });
  if (!created.ok) throw new Error(created.code);
  return created.track;
}

function form(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  return data;
}

/** Every exported action, called with a plausible form. */
const EVERY_ACTION: Array<[string, FormData]> = [
  ["saveTermAction", form({ term: "laravel", trackId: 1 })],
  ["rerunTermAction", form({ termId: 1 })],
  ["pauseTermAction", form({ termId: 1 })],
  ["resumeTermAction", form({ termId: 1 })],
  ["moveTermAction", form({ termId: 1, trackId: 1 })],
  ["deleteTermAction", form({ termId: 1 })],
  ["createTrackAction", form({ name: "X", titles: "X Developer", positives: "x 5", ranges: "USD month 1 2" })],
  ["updateTrackAction", form({ trackId: 1 })],
  ["setPrimaryTrackAction", form({ trackId: 1 })],
  ["archiveTrackAction", form({ trackId: 1 })],
  ["restoreTrackAction", form({ trackId: 1 })],
];

async function refusedByEveryAction(): Promise<string[]> {
  const allowed: string[] = [];
  for (const [name, data] of EVERY_ACTION) {
    const action = (actions as Record<string, (formData: FormData) => Promise<unknown>>)[name]!;
    const outcome = await action(data).then(
      () => "ran",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    if (!/403|requer|recurso/.test(outcome)) allowed.push(`${name}: ${outcome}`);
  }
  return allowed;
}

describe("who reaches tracks and terms", () => {
  it("IT-121 a recruiter session is refused by every Searches action", async () => {
    const owner = await person("owner", true);
    state.session = session({ roles: ["recruiter"], linkedCandidateIds: [owner] });

    expect(await refusedByEveryAction()).toEqual([]);
    expect(await db.select().from(savedTerm)).toHaveLength(0);
  });

  it("IT-122 the pages refuse a recruiter, and a track id resolves only among the viewer's tracks", async () => {
    const a = await person("a", true);
    const b = await person("b");
    const bTrack = await phpTrack(b);
    const recruiter = session({ roles: ["recruiter"], linkedCandidateIds: [a] });

    // `requireOwnCandidatePage` asks for the session's own candidate scope.
    expect(candidateScope(recruiter)).toBeNull();
    expect((await listCandidateTracks(a)).find((track) => track.id === bTrack.id)).toBeUndefined();
    expect((await listCandidateTracks(b)).find((track) => track.id === bTrack.id)).toBeDefined();
  });

  it("IT-123 capture health: admins yes, candidates no, borrowed admin sessions no", () => {
    expect(() => authorize(session({ roles: ["admin"] }), "admin:access")).not.toThrow();
    expect(() => authorize(session({ roles: ["candidate"], candidateId: 1 }), "admin:access")).toThrow(AuthorizationError);
    expect(() => authorize(session({ roles: ["admin", "candidate"], candidateId: 1, impersonatedBy: 9 }), "admin:access")).toThrow(
      AuthorizationError,
    );
  });

  it("IT-128 a linked recruiter reads the CV but never tracks or terms", async () => {
    const owner = await person("owner", true);
    const recruiterUser = await createUser({ email: "recruiter@example.test", roles: ["recruiter"] });
    await linkRecruiterToCandidate(recruiterUser.id, owner, recruiterUser.id);
    const recruiter = session({ userId: recruiterUser.id, roles: ["recruiter"], linkedCandidateIds: [owner] });

    expect(() => authorize(recruiter, "candidate:read", { kind: "candidate", candidateId: owner })).not.toThrow();
    expect(candidateScope(recruiter)).toBeNull();
    state.session = recruiter;
    expect(await refusedByEveryAction()).toEqual([]);
  });

  it("IT-129 a borrowed session edits a track, is audited, and only saves terms for the sweep", async () => {
    const targetCandidate = await person("target", true);
    const track = await phpTrack(targetCandidate);
    const admin = await createUser({ email: "admin@example.test", roles: ["admin"] });
    const target = await createUser({ email: "target@example.test", roles: ["admin", "candidate"], candidateId: targetCandidate });
    const started = await beginImpersonation(session({ userId: admin.id, roles: ["admin"], email: "admin@example.test" }), target.id);
    if (!started.ok) throw new Error(started.reason);
    state.session = await resolveSession(started.token);
    expect((state.session as Session).impersonatedBy).toBe(admin.id);

    const edited = await actions.updateTrackAction(
      form({
        trackId: track.id,
        expectedUpdatedAt: track.updatedAt,
        name: "PHP",
        titles: "PHP Developer\nLaravel Developer",
        positives: "php 10\nlaravel 8",
        negatives: "",
        minYears: "5",
        rejectBelow: "2",
        ranges: "USD month 7500 12500 18000\nUSD year 90000 150000",
        referenceCurrency: "USD",
      }),
    );
    expect(edited).toMatchObject({ ok: true });
    expect(await db.select().from(authEvent).where(eq(authEvent.kind, "impersonation_start"))).toHaveLength(1);

    const saved = await actions.saveTermAction(form({ term: "Laravel", trackId: track.id }));
    expect(saved).toMatchObject({ ok: true, run: "waiting_sweep" });
    expect(state.after).toBe(0);
  });

  it("IT-130 an admin without impersonation has no candidate scope to act on", async () => {
    const owner = await person("owner", true);
    await phpTrack(owner);
    state.session = session({ roles: ["admin"] });

    expect(await refusedByEveryAction()).toEqual([]);
  });

  it("IT-126 the public profile shows no track, term or range", async () => {
    const owner = await person("owner", true);
    const track = await phpTrack(owner);
    await saveTerm({ candidateId: owner }, { term: "Laravel", trackId: track.id }, { now: new Date(), impersonated: false });
    await setVisibility(owner, "public");
    await setPublicCv(owner, true);
    const [row] = await db.select({ slug: candidate.slug }).from(candidate).where(eq(candidate.id, owner));

    const profile = await publicProfile(row!.slug);

    expect(Object.keys(profile!).sort()).toEqual(["cv", "githubUrl", "headline", "linkedinUrl", "location", "name", "skills", "slug"]);
    const text = JSON.stringify(profile);
    expect(text).not.toMatch(/Laravel|PHP Developer|floor|ranges|reference_currency|target_track/);
  });
});

describe("new-job counts", () => {
  it("IT-103 a job brought by two terms counts in both and is listed once", async () => {
    const owner = await person("owner", true);
    const track = await phpTrack(owner);
    const laravel = await saveTerm({ candidateId: owner }, { term: "Laravel", trackId: track.id }, { now: new Date(), impersonated: false });
    const php = await saveTerm({ candidateId: owner }, { term: "PHP", trackId: track.id }, { now: new Date(), impersonated: false });
    if (!laravel.ok || !php.ok) throw new Error("save");
    await db.insert(source).values({ id: "remotive:~terms", kind: "remotive", handle: "~terms", label: "R", enabled: false }).onConflictDoNothing();
    const [employer] = await db.insert(company).values({ slug: "acme", name: "Acme" }).returning();
    const [shared] = await db
      .insert(job)
      .values({
        sourceId: "remotive:~terms", companyId: employer!.id, companyName: "Acme", externalId: "1",
        title: "PHP Laravel Developer", url: "https://x.test/1", fingerprint: "fp1", contentHash: "h1", raw: {},
      })
      .returning();
    await db.insert(termAttribution).values([
      { termKey: "laravel", jobId: shared!.id, platform: "remotive" },
      { termKey: "php", jobId: shared!.id, platform: "remotive" },
    ]);

    expect(await newCount({ candidateId: owner }, laravel.termId)).toBe(1);
    expect(await newCount({ candidateId: owner }, php.termId)).toBe(1);
    const byLaravel = await listBoard(owner, { broughtBy: { termKey: "laravel" }, newSince: "" });
    expect(byLaravel.map((row) => [row.jobId, row.isNew])).toEqual([[shared!.id, true]]);
    expect((await listBoard(owner)).filter((row) => row.jobId === shared!.id)).toHaveLength(1);
    expect(await db.select().from(targetTrack)).toHaveLength(2);
  });
});
