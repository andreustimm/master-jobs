import { describe, expect, expectTypeOf, it } from "vitest";
import { parseSourcesConfig } from "../src/core/sources/config.ts";
import {
  ADAPTERS,
  getAdapter,
  isFetchableSourceKind,
  parseFetchableSourceKind,
} from "../src/core/sources/registry.ts";
import { FETCHABLE_SOURCE_KINDS } from "../src/core/sources/types.ts";
import type {
  FetchableSourceKind,
  ManualSourceKind,
  SourceConfig,
  SourceKind,
} from "../src/core/sources/types.ts";

function yamlForKinds(kinds: readonly string[]): string {
  const entries = kinds.flatMap((kind, index) => [
    `  - kind: ${kind}`,
    `    handle: "source-${index}"`,
    `    label: "Source ${index}"`,
  ]);
  return ["sources:", ...entries].join("\n");
}

describe("source registry", () => {
  it("covers exactly the fetchable kinds at compile time", () => {
    expectTypeOf<keyof typeof ADAPTERS>().toEqualTypeOf<FetchableSourceKind>();
    expectTypeOf<Parameters<typeof getAdapter>[0]>().toEqualTypeOf<FetchableSourceKind>();
    expectTypeOf<SourceConfig["kind"]>().toEqualTypeOf<FetchableSourceKind>();
    expectTypeOf<SourceKind>().toEqualTypeOf<FetchableSourceKind | ManualSourceKind>();
  });

  it("registers every fetchable kind once and under the matching key", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual([...FETCHABLE_SOURCE_KINDS].sort());

    for (const kind of FETCHABLE_SOURCE_KINDS) {
      expect(isFetchableSourceKind(kind)).toBe(true);
      expect(getAdapter(kind).kind).toBe(kind);
    }
  });

  it("rejects persistence-only and unknown kinds at runtime", () => {
    for (const kind of ["manual", "workable", "unknown"]) {
      expect(isFetchableSourceKind(kind)).toBe(false);
      expect(() => parseFetchableSourceKind(kind)).toThrow(
        `No adapter registered for source kind "${kind}"`,
      );
    }
  });
});

describe("source config", () => {
  it("accepts every kind backed by the exhaustive adapter registry", () => {
    const configs = parseSourcesConfig(yamlForKinds(FETCHABLE_SOURCE_KINDS));
    expect(configs.map((config) => config.kind)).toEqual(FETCHABLE_SOURCE_KINDS);
  });

  it.each(["manual", "workable", "unknown"])(
    "rejects the non-fetchable kind %s before sync",
    (kind) => {
      expect(() => parseSourcesConfig(yamlForKinds([kind]))).toThrow("sources.yaml is invalid");
    },
  );
});
