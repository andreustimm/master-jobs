/**
 * Dicionário bilíngue de sinônimos da busca (#370, Fase 0).
 *
 * UT-022: o esquema valida, termo inválido ou repetido derruba a carga, lista
 * vazia funciona, e a lista versionada do repositório é válida. A flag e o
 * arquivo são da composição (`synonyms-load.ts`), testados aqui sem rede.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSynonymDictionary, EMPTY_SYNONYMS, synonymsOf } from "../src/core/synonyms.ts";
import {
  readSynonymDictionary,
  resetSynonymsCache,
  searchSynonyms,
  synonymsEnabled,
  synonymsPath,
} from "../src/core/synonyms-load.ts";
import { validateTerm, type ValidTerm } from "../src/core/term.ts";

function valid(raw: string): ValidTerm {
  const result = validateTerm(raw);
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

const terms = (list: readonly ValidTerm[]) => list.map((item) => item.term);

describe("UT-022 dicionário de sinônimos", () => {
  it("indexa cada termo do grupo com os outros do mesmo grupo", () => {
    const dictionary = buildSynonymDictionary({ groups: [["engenheiro", "engineer"], ["remoto", "remote", "home office"]] });
    expect(terms(synonymsOf(dictionary, valid("engenheiro")))).toEqual(["engineer"]);
    expect(terms(synonymsOf(dictionary, valid("engineer")))).toEqual(["engenheiro"]);
    expect(terms(synonymsOf(dictionary, valid("remote")))).toEqual(["remoto", "home office"]);
  });

  it("a chave não distingue caixa, espaço nem hífen, mas distingue acento como o filtro", () => {
    const dictionary = buildSynonymDictionary({ groups: [["líder técnico", "tech lead"], ["sênior", "senior"]] });
    expect(terms(synonymsOf(dictionary, valid("LÍDER  TÉCNICO")))).toEqual(["tech lead"]);
    expect(terms(synonymsOf(dictionary, valid("Tech-Lead")))).toEqual(["líder técnico"]);
    expect(terms(synonymsOf(dictionary, valid("senior")))).toEqual(["sênior"]);
    expect(synonymsOf(dictionary, valid("lider tecnico"))).toEqual([]);
  });

  it("termo fora da lista não tem sinônimo; lista vazia funciona", () => {
    expect(synonymsOf(buildSynonymDictionary({ groups: [] }), valid("java"))).toEqual([]);
    expect(synonymsOf(EMPTY_SYNONYMS, valid("engenheiro"))).toEqual([]);
    expect(buildSynonymDictionary({ groups: [] }).lookup.size).toBe(0);
  });

  it("recusa forma errada com o caminho do defeito", () => {
    expect(() => buildSynonymDictionary({})).toThrow(/groups/);
    expect(() => buildSynonymDictionary({ groups: [["sozinho"]] })).toThrow(/groups\.0/);
    expect(() => buildSynonymDictionary({ groups: [["a", 1]] })).toThrow(/groups\.0\.1/);
    expect(() => buildSynonymDictionary(null)).toThrow(/invalid/);
  });

  it("recusa termo que o filtro não aceita", () => {
    expect(() => buildSynonymDictionary({ groups: [["ok", "x"]] })).toThrow(/groups\.0\.1.*term_too_short/);
    expect(() => buildSynonymDictionary({ groups: [["ok", "r&d"]] })).toThrow(/term_invalid_char/);
    expect(() => buildSynonymDictionary({ groups: [["ok", "  "]] })).toThrow(/term_too_short/);
    expect(() => buildSynonymDictionary({ groups: [["ok", "a".repeat(61)]] })).toThrow(/term_too_long/);
  });

  it("recusa o mesmo termo em dois grupos e repetido no mesmo grupo", () => {
    expect(() => buildSynonymDictionary({ groups: [["data", "dados"], ["Data", "info"]] })).toThrow(/groups\.1\.0.*twice/);
    expect(() => buildSynonymDictionary({ groups: [["tech lead", "techlead"]] })).toThrow(/groups\.0\.1.*twice/);
  });

  it("a lista versionada em config/ é válida, sem termo repetido, e cobre os pares do plano", () => {
    const dictionary = readSynonymDictionary(synonymsPath({}));
    const pairs: Array<[string, string]> = [
      ["engenheiro", "engineer"],
      ["remoto", "remote"],
      ["dados", "data"],
      ["arquiteto", "architect"],
      ["líder técnico", "tech lead"],
      ["sênior", "senior"],
      ["gerente", "manager"],
    ];
    for (const [pt, en] of pairs) {
      expect(terms(synonymsOf(dictionary, valid(pt))), pt).toContain(en);
      expect(terms(synonymsOf(dictionary, valid(en))), en).toContain(pt);
    }
  });
});

describe("UT-022 composição: flag e arquivo", () => {
  afterEach(() => {
    resetSynonymsCache();
    vi.restoreAllMocks();
  });

  function listFile(content: string): string {
    const path = join(mkdtempSync(join(tmpdir(), "synonyms-")), "list.yaml");
    writeFileSync(path, content);
    return path;
  }

  it("desligada por padrão; só 1 e true ligam", () => {
    expect(synonymsEnabled({})).toBe(false);
    expect(synonymsEnabled({ SEARCH_SYNONYMS_ENABLED: "" })).toBe(false);
    expect(synonymsEnabled({ SEARCH_SYNONYMS_ENABLED: "0" })).toBe(false);
    expect(synonymsEnabled({ SEARCH_SYNONYMS_ENABLED: "false" })).toBe(false);
    expect(synonymsEnabled({ SEARCH_SYNONYMS_ENABLED: "1" })).toBe(true);
    expect(synonymsEnabled({ SEARCH_SYNONYMS_ENABLED: " TRUE " })).toBe(true);
  });

  it("desligada, devolve a lista vazia sem ler o arquivo", () => {
    const dictionary = searchSynonyms({ JHO_SEARCH_SYNONYMS_PATH: "/nao/existe.yaml" });
    expect(dictionary).toBe(EMPTY_SYNONYMS);
  });

  it("ligada, carrega o arquivo apontado", () => {
    const path = listFile("groups:\n  - [engenheiro, engineer]\n");
    const dictionary = searchSynonyms({ SEARCH_SYNONYMS_ENABLED: "1", JHO_SEARCH_SYNONYMS_PATH: path });
    expect(terms(synonymsOf(dictionary, valid("engineer")))).toEqual(["engenheiro"]);
  });

  it("ligada com arquivo inválido ou ausente, a busca volta à de antes e o defeito vai ao log", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = listFile("groups:\n  - [so-um]\n");
    expect(searchSynonyms({ SEARCH_SYNONYMS_ENABLED: "1", JHO_SEARCH_SYNONYMS_PATH: broken })).toBe(EMPTY_SYNONYMS);
    resetSynonymsCache();
    expect(searchSynonyms({ SEARCH_SYNONYMS_ENABLED: "1", JHO_SEARCH_SYNONYMS_PATH: "/nao/existe.yaml" })).toBe(
      EMPTY_SYNONYMS,
    );
    expect(error).toHaveBeenCalledTimes(2);
  });
});
