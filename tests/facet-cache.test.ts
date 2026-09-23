import { describe, expect, it } from "vitest";
import { canonicalJson, createTtlLru, facetCacheKey } from "../src/contexts/matching/domain/facet-cache.ts";

describe("chave das facetas", () => {
  it("não depende da ordem das chaves nem de campo indefinido", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: undefined } })).toBe(canonicalJson({ a: { d: [1, 2] }, b: 1 }));
    expect(canonicalJson({ a: undefined })).toBe("{}");
    expect(canonicalJson([undefined, null, "x"])).toBe('[null,null,"x"]');
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("preserva a ordem das listas", () => {
    expect(canonicalJson({ s: ["a", "b"] })).not.toBe(canonicalJson({ s: ["b", "a"] }));
  });

  it("separa candidatos, o acervo sem escopo e versões do scorer", () => {
    const query = { minFit: 45, groupRepeats: true };
    const keys = new Set([
      facetCacheKey(1, query, "1.4.1"),
      facetCacheKey(2, query, "1.4.1"),
      facetCacheKey(null, query, "1.4.1"),
      facetCacheKey(0, query, "1.4.1"),
      facetCacheKey(1, query, "1.4.2"),
    ]);
    expect(keys.size).toBe(5);
  });

  it("muda com cada filtro que a consulta recebe", () => {
    const base = {
      minFit: 45, cluster: "backend", term: { term: "java", key: "java" }, sourceKinds: ["lever"],
      workMode: "remote", groupRepeats: true,
      track: { candidateId: 1, primaryTrackId: 3, trackIds: [3], mode: "single" },
    };
    const variants: object[] = [
      { ...base, minFit: 60 },
      { ...base, cluster: "architect" },
      { ...base, cluster: undefined },
      { ...base, term: { term: "javas", key: "javas" } },
      { ...base, term: undefined },
      { ...base, sourceKinds: ["lever", "ashby"] },
      { ...base, workMode: "hybrid" },
      { ...base, groupRepeats: false },
      { ...base, track: { ...base.track, trackIds: [3, 4], mode: "best" } },
      { ...base, track: undefined },
    ];
    const reference = facetCacheKey(1, base, "v");
    for (const variant of variants) expect(facetCacheKey(1, variant, "v")).not.toBe(reference);
  });

  it("não confunde texto com a estrutura da chave", () => {
    expect(facetCacheKey(1, { cluster: 'a","scorer":"x' }, "v")).not.toBe(facetCacheKey(1, { cluster: "a" }, "x"));
  });
});

describe("mapa com validade e teto", () => {
  it("recusa configuração sem validade ou sem espaço", () => {
    expect(() => createTtlLru({ ttlMs: 0, maxEntries: 1 })).toThrow(RangeError);
    expect(() => createTtlLru({ ttlMs: Number.NaN, maxEntries: 1 })).toThrow(RangeError);
    expect(() => createTtlLru({ ttlMs: 1, maxEntries: 0 })).toThrow(RangeError);
    expect(() => createTtlLru({ ttlMs: 1, maxEntries: 1.5 })).toThrow(RangeError);
  });

  it("vale até a validade, exclusive, e some depois", () => {
    const cache = createTtlLru<string>({ ttlMs: 1000, maxEntries: 4 });
    cache.set("k", "v", 10_000);
    expect(cache.get("k", 10_999)).toBe("v");
    expect(cache.get("k", 11_000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("uma leitura não renova a validade", () => {
    const cache = createTtlLru<string>({ ttlMs: 1000, maxEntries: 4 });
    cache.set("k", "v", 0);
    expect(cache.get("k", 900)).toBe("v");
    expect(cache.get("k", 1000)).toBeUndefined();
  });

  it("relógio que volta invalida em vez de estender", () => {
    const cache = createTtlLru<string>({ ttlMs: 1000, maxEntries: 4 });
    cache.set("k", "v", 5000);
    expect(cache.get("k", 4999)).toBeUndefined();
  });

  it("despeja a menos usada recentemente ao passar do teto", () => {
    const cache = createTtlLru<string>({ ttlMs: 1000, maxEntries: 2 });
    cache.set("a", "1", 0);
    cache.set("b", "2", 0);
    expect(cache.get("a", 1)).toBe("1");
    cache.set("c", "3", 2);
    expect(cache.size).toBe(2);
    expect(cache.get("b", 3)).toBeUndefined();
    expect(cache.get("a", 3)).toBe("1");
    expect(cache.get("c", 3)).toBe("3");
  });

  it("regravar a chave substitui o valor e recomeça a validade", () => {
    const cache = createTtlLru<string>({ ttlMs: 1000, maxEntries: 2 });
    cache.set("a", "1", 0);
    cache.set("a", "2", 900);
    expect(cache.size).toBe(1);
    expect(cache.get("a", 1500)).toBe("2");
  });

  it("remove por predicado e tudo", () => {
    const cache = createTtlLru<{ owner: number }>({ ttlMs: 1000, maxEntries: 8 });
    cache.set("a", { owner: 1 }, 0);
    cache.set("b", { owner: 2 }, 0);
    cache.set("c", { owner: 1 }, 0);
    cache.deleteWhere((value) => value.owner === 1);
    expect(cache.size).toBe(1);
    expect(cache.get("b", 1)).toEqual({ owner: 2 });
    cache.deleteWhere(() => true);
    expect(cache.size).toBe(0);
    cache.set("d", { owner: 3 }, 0);
    cache.clear();
    expect(cache.get("d", 1)).toBeUndefined();
  });
});
