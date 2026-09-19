import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { himalayas, remoteok, remotive } from "../src/core/sources/aggregators.ts";
import { HttpError } from "../src/core/sources/http.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import type { SourceAdapter } from "../src/core/sources/types.ts";

/**
 * Fixtures recortadas de respostas reais de 2026-09-19 (ver o README da pasta).
 * A rede é trocada só na porta HTTP; o adapter é o de produção.
 */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/term-search/${name}`, "utf8"));
}

afterEach(() => {
  resetHttpPort();
});

function search(adapter: SourceAdapter) {
  return adapter.termSearch!;
}

describe("term search on registered platforms", () => {
  it("UT-057 Remotive makes one reserved request and maps tags", async () => {
    const port = fixtureHttp({ "remotive.com/api/remote-jobs": fixture("remotive-laravel.json") as object });
    setHttpPort(port);
    const order: string[] = [];
    const reserve = vi.fn(async () => {
      order.push(`reserve:${port.calls.length}`);
      return true;
    });

    const result = await search(remotive).search("Laravel", { limit: 100, reserve });

    expect(port.calls).toEqual(["https://remotive.com/api/remote-jobs?search=Laravel&limit=100"]);
    expect(order).toEqual(["reserve:0"]);
    expect(result.stoppedByQuota).toBe(false);
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]!.tags).toContain("laravel");
    expect(result.jobs[0]!.tags).toContain("php");
  });

  it("UT-058 Remotive without quota makes no call", async () => {
    const port = fixtureHttp({});
    setHttpPort(port);

    const result = await search(remotive).search("Laravel", { limit: 100, reserve: async () => false });

    expect(port.calls).toEqual([]);
    expect(result).toMatchObject({ jobs: [], stoppedByQuota: true });
  });

  it("UT-059 RemoteOK searches by hyphenated tag and drops the legal notice", async () => {
    const port = fixtureHttp({ "remoteok.com/api?tag=": fixture("remoteok-tech-lead.json") as object });
    setHttpPort(port);

    const result = await search(remoteok).search("Tech Lead", { limit: 100, reserve: async () => true });

    expect(port.calls).toEqual(["https://remoteok.com/api?tag=tech-lead"]);
    expect(result.jobs.map((job) => job.title)).toEqual([
      "Tech Lead",
      "Senior Tech Lead Mobile Developer Risora",
      "Manager Product Development",
    ]);
    expect(result.jobs[0]!.tags).toContain("tech lead");
  });

  it("UT-060 Himalayas pages the search endpoint, reserving before each page", async () => {
    const page1 = fixture("himalayas-laravel-page1.json") as { jobs: unknown[] };
    const page2 = fixture("himalayas-laravel-page2.json") as { jobs: unknown[] };
    // A busca pagina por `page`, não por cursor: é o que a API respondeu no probe.
    // Página curta no meio não encerra (a real devolveu 19 na página 3); o total, sim.
    const page3 = { ...page2, offset: 40, totalCount: 48, jobs: page2.jobs.slice(0, 8) };
    const port = fixtureHttp({
      "search?q=laravel&page=1": page1,
      "search?q=laravel&page=2": page2,
      "search?q=laravel&page=3": page3,
    });
    setHttpPort(port);
    const reserve = vi.fn(async () => true);

    const result = await search(himalayas).search("laravel", { limit: 100, reserve });

    expect(port.calls).toEqual([
      "https://himalayas.app/jobs/api/search?q=laravel&page=1",
      "https://himalayas.app/jobs/api/search?q=laravel&page=2",
      "https://himalayas.app/jobs/api/search?q=laravel&page=3",
    ]);
    expect(reserve).toHaveBeenCalledTimes(3);
    expect(result.jobs).toHaveLength(48);
    expect(result.totalHint).toBe(48);
    expect(result.jobs[1]!.tags).toContain("Laravel-Development");
  });

  it("UT-060 a short page in the middle does not end the Himalayas search", async () => {
    const page1 = fixture("himalayas-laravel-page1.json") as { jobs: unknown[] };
    const short = { ...page1, jobs: page1.jobs.slice(0, 19) };
    const port = fixtureHttp({
      "search?q=laravel&page=1": page1,
      "search?q=laravel&page=2": short,
      "search?q=laravel&page=3": { ...page1, jobs: [] },
    });
    setHttpPort(port);

    const result = await search(himalayas).search("laravel", { limit: 100, reserve: async () => true });

    expect(port.calls).toHaveLength(3);
    expect(result.jobs).toHaveLength(39);
  });

  it("UT-060 Himalayas never exceeds five pages per run", async () => {
    const page = fixture("himalayas-laravel-page2.json") as object;
    const port = fixtureHttp({ "search?q=laravel&page=": page });
    setHttpPort(port);

    const result = await search(himalayas).search("laravel", { limit: 100, reserve: async () => true });

    expect(port.calls).toHaveLength(5);
    expect(result.jobs).toHaveLength(100);
  });

  it("UT-061 Himalayas stops when the third reservation is refused", async () => {
    const port = fixtureHttp({ "search?q=laravel&page=": fixture("himalayas-laravel-page1.json") as object });
    setHttpPort(port);
    let reservations = 0;

    const result = await search(himalayas).search("laravel", {
      limit: 100,
      reserve: async () => ++reservations < 3,
    });

    expect(port.calls).toHaveLength(2);
    expect(result.jobs).toHaveLength(40);
    expect(result.stoppedByQuota).toBe(true);
  });

  it.each([
    ["remotive", remotive, "remotive.com"],
    ["remoteok", remoteok, "remoteok.com"],
    ["himalayas", himalayas, "himalayas.app"],
  ] as const)("UT-062 %s rethrows a 429 after exactly one call without retry", async (_name, adapter, host) => {
    const port = fixtureHttp({ [host]: { status: 429 } });
    setHttpPort(port);

    const error = await search(adapter)
      .search("laravel", { limit: 100, reserve: async () => true })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(429);
    expect(port.calls).toHaveLength(1);
    expect(port.options[0]).toMatchObject({ retries: 0 });
  });
});
