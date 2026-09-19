import { describe, expect, it } from "vitest";
import {
  capNewest,
  classifyCaptureFailure,
  isAttributable,
  nextWindowAt,
  reachablePlatforms,
  windowStarts,
} from "../src/contexts/sourcing/index.ts";
import { parseSourcesConfig } from "../src/core/sources/config.ts";
import { HttpError } from "../src/core/sources/http.ts";
import type { RawJob, SourceAdapter, TermSearch } from "../src/core/sources/types.ts";

function raw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    externalId: "1",
    companyName: "Acme",
    title: "Backend Engineer",
    url: "https://acme.test/1",
    descriptionText: null,
    raw: {},
    ...overrides,
  };
}

function adapter(kind: SourceAdapter["kind"], validatedOn: string | null | undefined): SourceAdapter {
  const termSearch: TermSearch | undefined =
    validatedOn === undefined
      ? undefined
      : {
          budget: { perMinute: 1, pageSize: 20, maxRequestsPerRun: 1 },
          validatedOn,
          search: async () => ({ jobs: [], warnings: [], totalHint: null, stoppedByQuota: false }),
        };
  return { kind, docs: "", fetchJobs: async () => ({ jobs: [], warnings: [] }), termSearch };
}

describe("quota windows", () => {
  it("UT-050 splits an instant into its UTC day and minute", () => {
    expect(windowStarts(new Date("2026-09-18T14:03:27Z"))).toEqual({
      day: "2026-09-18",
      minute: "2026-09-18T14:03",
    });
  });

  it("UT-051 turns the day exactly at UTC midnight", () => {
    expect(windowStarts(new Date("2026-09-18T23:59:59.999Z")).day).toBe("2026-09-18");
    expect(windowStarts(new Date("2026-09-19T00:00:00.000Z")).day).toBe("2026-09-19");
  });

  it("UT-052 gives the start of the next window", () => {
    expect(nextWindowAt("day", "2026-09-18")).toBe("2026-09-19T00:00:00.000Z");
    expect(nextWindowAt("minute", "2026-09-18T14:03")).toBe("2026-09-18T14:04:00.000Z");
  });
});

describe("capture rules", () => {
  it("UT-053 classifies platform failures for the queue", () => {
    expect(classifyCaptureFailure(new HttpError(429, "u", "x"))).toEqual({ status: "waiting_quota", exhaustDay: true });
    expect(classifyCaptureFailure(new HttpError(503, "u", "x"))).toEqual({
      status: "failed",
      code: "http_error",
      retryable: true,
    });
    for (const status of [404, 410]) {
      expect(classifyCaptureFailure(new HttpError(status, "u", "x"))).toEqual({
        status: "failed",
        code: "endpoint_gone",
        retryable: false,
      });
    }
    expect(classifyCaptureFailure(new TypeError("fetch failed"))).toEqual({
      status: "failed",
      code: "network",
      retryable: true,
    });
    expect(classifyCaptureFailure(new SyntaxError("Unexpected token"))).toEqual({
      status: "failed",
      code: "parse",
      retryable: true,
    });
  });

  it("UT-054 attributes by tags when title and description miss", () => {
    expect(isAttributable("laravel", raw({ tags: ["laravel", "php"] }))).toBe(true);
    expect(isAttributable("laravel", raw({ tags: ["php"] }))).toBe(false);
  });

  it("UT-055 keeps the 100 newest, undated last, and the total", () => {
    const dated = Array.from({ length: 120 }, (_, n) =>
      raw({ externalId: `d${n}`, postedAt: new Date(Date.UTC(2026, 0, 1) + n * 3_600_000).toISOString() }),
    );
    const undated = Array.from({ length: 10 }, (_, n) => raw({ externalId: `u${n}`, postedAt: null }));
    const { jobs, totalHint } = capNewest([...undated, ...dated], 100);

    expect(totalHint).toBe(130);
    expect(jobs).toHaveLength(100);
    expect(jobs[0]!.externalId).toBe("d119");
    expect(jobs.every((job) => job.postedAt)).toBe(true);
    expect(capNewest([...undated, dated[0]!], 5).jobs.map((job) => job.externalId)).toEqual([
      "d0", "u0", "u1", "u2", "u3",
    ]);
  });

  it("UT-056 reaches only validated platforms that are enabled", () => {
    const adapters = [
      adapter("remotive", "2026-09-19"),
      adapter("himalayas", null),
      adapter("remoteok", "2026-09-19"),
      adapter("greenhouse", undefined),
    ];
    const config = [
      { kind: "remotive" as const, handle: "architect", label: "Remotive" },
      { kind: "himalayas" as const, handle: "", label: "Himalayas" },
      { kind: "greenhouse" as const, handle: "acme", label: "Acme" },
    ];
    expect(reachablePlatforms(adapters, config)).toEqual(["remotive"]);
  });
});

describe("sources configuration", () => {
  it("UT-063 rejects a handle reserved for term captures", () => {
    const yaml = "sources:\n  - kind: remotive\n    handle: \"~terms\"\n    label: Remotive\n";
    expect(() => parseSourcesConfig(yaml)).toThrow(/sources\.0\.handle: handles starting with ~ are reserved/);
  });
});
