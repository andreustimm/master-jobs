import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTrack,
  setMatchingProfile,
  suggestTrack,
  targetOf,
} from "../src/contexts/matching/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidate, savedTerm, termCapture } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * As Server Actions de termo, com a fronteira do Next dublada: sessão, `after()`
 * e revalidação. Todo o resto — matching, sourcing, banco — é o de produção.
 */
const state = vi.hoisted(() => ({
  candidateId: 0,
  impersonatedBy: null as number | null,
  after: [] as Array<() => Promise<void> | void>,
  drains: [] as unknown[],
}));

vi.mock("../app/auth", () => ({
  guardOwnCandidate: async () => ({
    session: { userId: 1, candidateId: state.candidateId, roles: ["candidate"], impersonatedBy: state.impersonatedBy },
    candidateId: state.candidateId,
  }),
}));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void> | void) => state.after.push(callback) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../src/contexts/sourcing/index.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/contexts/sourcing/index.ts")>();
  return {
    ...original,
    runTermCaptures: (opts: Parameters<typeof original.runTermCaptures>[0]) => {
      state.drains.push(opts);
      return original.runTermCaptures(opts);
    },
  };
});

const { rerunTermAction, saveTermAction } = await import("../app/searches/actions.ts");

let db: DB;
let port: ReturnType<typeof fixtureHttp>;
let php: number;

beforeEach(async () => {
  db = await useTestDb();
  state.after = [];
  state.drains = [];
  state.impersonatedBy = null;
  port = fixtureHttp({
    "remotive.com": JSON.parse(readFileSync("tests/fixtures/term-search/remotive-laravel.json", "utf8")) as object,
    "remoteok.com": [],
    "himalayas.app": { jobs: [], totalCount: 0 },
  });
  setHttpPort(port);
  const [row] = await db.insert(candidate).values({ slug: "owner", name: "Owner", isDefault: true }).returning();
  state.candidateId = row!.id;
  const profile = await loadProfile(true);
  await setMatchingProfile(row!.id, profile);
  const created = await createTrack(row!.id, {
    name: "PHP",
    target: suggestTrack({ term: "PHP", catalog: [], primary: targetOf(profile) }).target,
  });
  if (!created.ok) throw new Error(created.code);
  php = created.track.id;
});

afterEach(async () => {
  resetHttpPort();
  await releaseTestDb();
});

function form(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  return data;
}

describe("term Server Actions", () => {
  it("IT-078 two simultaneous saves of the same term keep one term and one capture per platform", async () => {
    const results = await Promise.all([
      saveTermAction(form({ term: "java", trackId: php })),
      saveTermAction(form({ term: "java", trackId: php })),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, code: "term_duplicate" });
    expect(await db.select().from(savedTerm)).toHaveLength(1);
    expect(await db.select().from(termCapture)).toHaveLength(3);
  });

  it("IT-081 a borrowed session saves the term and leaves the search to the sweep", async () => {
    state.impersonatedBy = 99;

    const result = await saveTermAction(form({ term: "Laravel", trackId: php }));

    expect(result).toMatchObject({ ok: true, run: "waiting_sweep" });
    expect(await db.select().from(savedTerm)).toHaveLength(1);
    expect(state.after).toHaveLength(0);
    expect(await db.select().from(termCapture)).toHaveLength(0);
  });

  it("IT-083 saving answers before any capture runs and drains after the response", async () => {
    const result = await saveTermAction(form({ term: "Laravel", trackId: php }));

    expect(result).toMatchObject({ ok: true, run: "started" });
    expect(port.calls).toHaveLength(0);
    expect((await db.select().from(termCapture)).every((row) => row.status === "queued")).toBe(true);
    expect(state.after).toHaveLength(1);

    await state.after[0]!();

    expect(state.drains).toEqual([{ budgetMs: 25_000, worker: "web" }]);
    expect(port.calls.length).toBeGreaterThan(0);
    expect((await db.select().from(termCapture)).some((row) => row.status === "succeeded")).toBe(true);
  });

  it("IT-088 a borrowed session's re-run waits for the sweep", async () => {
    const saved = await saveTermAction(form({ term: "Laravel", trackId: php }));
    state.after = [];
    state.impersonatedBy = 99;

    const result = await rerunTermAction(form({ termId: saved.ok ? saved.termId : 0 }));

    expect(result).toEqual({ ok: true, run: "waiting_sweep" });
    expect(state.after).toHaveLength(0);
  });
});
