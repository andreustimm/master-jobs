/**
 * Suíte: `jho terms run`, `jho terms status` e `jho tracks list`.
 *
 * A rede é trocada só na porta HTTP, o relógio pelo relógio de teste; banco,
 * matching e sourcing são os de produção. É daqui que a varredura diária chama
 * a repetição dos termos, então o que se afirma é o que o log do workflow mostra.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveTrack,
  createTrack,
  ensurePrimaryTrack,
  saveTerm,
  suggestTrack,
  targetOf,
  type Track,
} from "../src/contexts/matching/index.ts";
import { captureHealth } from "../src/contexts/sourcing/index.ts";
import { drizzleCaptureQueue } from "../src/contexts/sourcing/infra/drizzle-captures.ts";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import { IngestionBlockedError } from "../src/core/ingest/environment.ts";
import { termCapture } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { fixtureHttp, resetHttpPort, setHttpPort, type Fixture } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

const START = "2026-09-19T10:00:00.000Z";
const env = { ...process.env };

function fixture(name: string): object {
  return JSON.parse(readFileSync(`tests/fixtures/term-search/${name}`, "utf8")) as object;
}

function platforms(overrides: Record<string, Fixture> = {}) {
  return fixtureHttp({
    "remotive.com": fixture("remotive-laravel.json"),
    "remoteok.com": fixture("remoteok-tech-lead.json"),
    "himalayas.app": fixture("himalayas-laravel-page1.json"),
    ...overrides,
  });
}

let candidateId: number;
let php: Track;
let clock: ReturnType<typeof fixedClock>;

beforeAll(async () => {
  await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
  clock = fixedClock(START);
  setClock(clock);
  candidateId = await syncCandidateFromProfile();
  await ensurePrimaryTrack(candidateId);
  const created = await createTrack(candidateId, {
    name: "PHP",
    target: suggestTrack({ term: "Laravel", catalog: [], primary: targetOf(await loadProfile(true)) }).target,
  });
  if (!created.ok) throw new Error(created.code);
  php = created.track;
});

afterEach(async () => {
  process.env = { ...env };
  resetClock();
  resetHttpPort();
  await releaseTestDb();
});

async function saveLaravel() {
  const result = await saveTerm({ candidateId }, { term: "Laravel", trackId: php.id }, { now: new Date(clock.now()), impersonated: false });
  if (!result.ok) throw new Error(result.code);
  return result.termId;
}

const lines = (out: string) =>
  out
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("jho terms run", () => {
  it("IT-131 prints one aggregate line per platform", async () => {
    setHttpPort(platforms());
    await saveLaravel();

    const r = await rodar("terms", "run");

    expect(r.code).toBeUndefined();
    const printed = lines(r.out);
    expect(printed.map((line) => line.platform).sort()).toEqual(["himalayas", "remoteok", "remotive"]);
    for (const line of printed) {
      expect(Object.keys(line).sort()).toEqual(["claimed", "created", "failed", "known", "platform", "succeeded", "waiting"]);
    }
  });

  it("IT-131 exits 1 with the guard's message where ingestion is blocked", async () => {
    process.env.JHO_ENV = "staging";
    delete process.env.JHO_INGESTION_OPT_IN;

    const r = await rodar("terms", "run");

    expect(r.code).toBe(1);
    expect(r.err).toContain("staging runs on fixtures only");
  });

  it("IT-071 never prints the term or its key", async () => {
    setHttpPort(platforms());
    await saveLaravel();

    const r = await rodar("terms", "run");

    expect(`${r.out}\n${r.err}`).not.toMatch(/laravel/i);
  });

  it("IT-060 a 503 fails today's capture; the next day runs a new one", async () => {
    setHttpPort(platforms({ "remoteok.com": { status: 503 } }));
    await saveLaravel();
    await rodar("terms", "run");
    const [failed] = await banco().select().from(termCapture).where(eq(termCapture.platform, "remoteok"));
    expect(failed).toMatchObject({ status: "failed", reasonCode: "http_error", windowDay: "2026-09-19" });

    clock.advance(24 * 3_600_000);
    setHttpPort(platforms());
    await rodar("terms", "run");

    const rows = await banco().select().from(termCapture).where(eq(termCapture.platform, "remoteok"));
    expect(rows.map((row) => [row.windowDay, row.status]).sort()).toEqual([
      ["2026-09-19", "failed"],
      ["2026-09-20", "succeeded"],
    ]);
  });

  it("IT-073 archiving a track mid-capture lets it finish and stops tomorrow's", async () => {
    setHttpPort(platforms());
    await saveLaravel();
    const claimed = await drizzleCaptureQueue.claim("web", new Date(clock.now()));
    await archiveTrack(candidateId, php.id);
    await drizzleCaptureQueue.finish(
      claimed!.id,
      { status: "succeeded", fetched: 0, created: 0, known: 0, attributed: 0, totalHint: 0 },
      new Date(clock.now()),
    );
    expect((await banco().select().from(termCapture).where(eq(termCapture.id, claimed!.id)))[0]!.status).toBe("succeeded");

    clock.advance(24 * 3_600_000);
    await rodar("terms", "run");

    expect(await banco().select().from(termCapture).where(eq(termCapture.windowDay, "2026-09-20"))).toHaveLength(0);
  });
});

describe("jho terms status and jho tracks list", () => {
  it("IT-132 status prints the aggregate health, and tracks list the scored counts", async () => {
    setHttpPort(platforms());
    await saveLaravel();
    await rodar("terms", "run");

    const status = await rodar("terms", "status");
    const expected = JSON.parse(JSON.stringify(await captureHealth(new Date(clock.now())))) as unknown[];
    expect(lines(status.out)).toEqual(expected);

    const list = await rodar("tracks", "list", "--candidate", String(candidateId));
    expect(list.out).toContain("Principal");
    expect(list.out).toContain("PHP");
    expect(list.out).toMatch(/active\s+\d+ scored/);
  });
});

describe("ingestion guard on term-capture entry points", () => {
  it("IT-127 the term probe is refused where ingestion is blocked", async () => {
    process.env.JHO_ENV = "preview";
    const port = platforms();
    setHttpPort(port);

    const r = await rodar("sources", "probe", "remotive", "--term", "laravel");

    expect(r.erro).toBeInstanceOf(IngestionBlockedError);
    expect(port.calls).toHaveLength(0);
  });
});
