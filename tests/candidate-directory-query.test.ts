import { describe, expect, it } from "vitest";
import {
  DIRECTORY_LOCATION_MAX,
  DIRECTORY_TEXT_MAX,
  directoryRateDecision,
  foldAccents,
  isDirectoryVisible,
  parseDirectoryQuery,
} from "../src/core/candidate-directory.ts";
import { toAllowlistedProfile, type AllowlistRow } from "../src/core/candidate-public.ts";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";

/**
 * Diretório de perfis (#465, ADR-013): as decisões puras — análise da busca,
 * dobra de acento, limite, visibilidade e o montador da lista de permissão.
 * Sem banco, rede nem relógio.
 */

describe("parseDirectoryQuery", () => {
  it("UT-060 separa as palavras em termos e marca que houve texto", () => {
    const query = parseDirectoryQuery({ q: "  React  Node " });
    expect(query.terms.map((term) => term.key)).toEqual(["react", "node"]);
    expect(query.textGiven).toBe(true);
    expect(query.text).toBe("React  Node");
  });

  it("UT-061 texto de 250 caracteres é cortado em 200 antes da análise", () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${String(i).padStart(3, "0")}`).join(" ");
    expect(words.length).toBeGreaterThan(DIRECTORY_TEXT_MAX);
    const long = words.slice(0, 250);
    const query = parseDirectoryQuery({ q: long });
    expect(query.text.length).toBeLessThanOrEqual(DIRECTORY_TEXT_MAX);
    expect(long.slice(0, DIRECTORY_TEXT_MAX).trim()).toBe(query.text);
    // A palavra que só existe depois do caractere 200 não vira termo.
    const cutWord = long.slice(DIRECTORY_TEXT_MAX + 5).split(" ").find((word) => word.length === 4)!;
    expect(query.terms.map((term) => term.term)).not.toContain(cutWord);
  });

  it.each(["<script>", "!!!"])("UT-062 %s não vira termo, e houve texto", (q) => {
    const query = parseDirectoryQuery({ q });
    expect(query.terms).toEqual([]);
    expect(query.textGiven).toBe(true);
  });

  it.each([{}, { q: "" }, { q: "   " }])("UT-063 sem texto (%j): nenhum termo e textGiven false", (params) => {
    const query = parseDirectoryQuery(params);
    expect(query.terms).toEqual([]);
    expect(query.textGiven).toBe(false);
  });

  it.each([
    ["abc", 1],
    ["-3", 1],
    ["0", 1],
    ["7", 7],
    ["1.5", 1],
    ["99999999999999999999", 1],
  ])("UT-064 page %s vira %i", (page, expected) => {
    expect(parseDirectoryQuery({ page }).page).toBe(expected);
  });

  it("UT-065 valor fora da lista cai; parâmetro desconhecido não vira campo", () => {
    expect(parseDirectoryQuery({ workModel: "x", level: "ceo" })).toMatchObject({ workModel: null, level: null });
    expect(parseDirectoryQuery({ workModel: "remote", level: "senior" })).toMatchObject({
      workModel: "remote",
      level: "senior",
    });
    const forged = parseDirectoryQuery({ visibility: "private", fields: "salary", salaryFloor: "1" });
    expect(Object.keys(forged).sort()).toEqual(["level", "location", "page", "terms", "text", "textGiven", "workModel"]);
    expect(forged).toEqual(parseDirectoryQuery({}));
  });

  it("UT-065 parâmetro repetido usa o primeiro valor, nunca a lista", () => {
    expect(parseDirectoryQuery({ workModel: ["remote", "x"], q: ["go", "rust"] })).toMatchObject({
      workModel: "remote",
      text: "go",
    });
  });

  it("UT-066 localização de 150 caracteres fica com 100; só espaço é nulo", () => {
    expect(parseDirectoryQuery({ location: "a".repeat(150) }).location).toHaveLength(DIRECTORY_LOCATION_MAX);
    expect(parseDirectoryQuery({ location: "  " }).location).toBeNull();
    expect(parseDirectoryQuery({ location: " Porto " }).location).toBe("Porto");
  });

  it("acento no termo é dobrado: Sênior e senior são o mesmo termo", () => {
    expect(parseDirectoryQuery({ q: "Sênior senior" }).terms.map((term) => term.key)).toEqual(["senior"]);
  });
});

describe("foldAccents", () => {
  it("UT-067 minúscula e sem acento", () => {
    expect(foldAccents("Sênior São Paulo")).toBe("senior sao paulo");
    expect(foldAccents("Ação Çà ÜÑ")).toBe("acao ca un");
  });
});

describe("directoryRateDecision", () => {
  it("UT-068 a 60ª busca passa, a 61ª não", () => {
    expect(directoryRateDecision(60)).toEqual({ ok: true });
    expect(directoryRateDecision(61)).toEqual({ ok: false });
    expect(directoryRateDecision(1)).toEqual({ ok: true });
  });
});

describe("isDirectoryVisible", () => {
  it.each([
    ["recruiters", true],
    ["public", true],
    ["private", false],
    ["foo", false],
    [null, false],
    [undefined, false],
  ])("UT-073 %s → %s", (visibility, expected) => {
    expect(isDirectoryVisible(visibility)).toBe(expected);
  });
});

/** Uma linha completa do montador, com tudo desligado; cada teste liga o que precisa. */
function row(overrides: Partial<AllowlistRow> = {}): AllowlistRow {
  return {
    publicSlug: "ana",
    visibility: "recruiters",
    name: "Ana Souza",
    headline: "Engenheira de dados",
    location: "Porto Alegre",
    linkedinUrl: null,
    githubUrl: null,
    publicCv: false,
    knownEmails: ["ana@x.com"],
    workModel: null,
    experienceLevel: null,
    availability: null,
    startTimeframe: null,
    openToRelocation: null,
    area: null,
    languages: null,
    publicWorkModel: false,
    publicExperienceLevel: false,
    publicAvailability: false,
    publicStartTimeframe: false,
    publicRelocation: false,
    publicArea: false,
    publicLanguages: false,
    photoKey: null,
    coverKey: null,
    publicPhoto: false,
    publicCover: false,
    ...overrides,
  };
}

describe("toAllowlistedProfile", () => {
  it("UT-069 headline com e-mail sai vazia", () => {
    expect(toAllowlistedProfile(row({ headline: "Fale comigo: ana@x.com" }), [], null).headline).toBeNull();
  });

  it("UT-070 saem exatamente as chaves da lista, mesmo com campos privados na linha", () => {
    const leaky = { ...row(), salaryFloor: 31_337, notes: "nota privada", email: "ana@x.com" };
    const profile = toAllowlistedProfile(leaky, [], "conteúdo");
    expect(Object.keys(profile).sort()).toEqual(
      ["cv", "facts", "githubUrl", "headline", "images", "linkedinUrl", "location", "name", "skills", "slug"],
    );
    const serialized = JSON.stringify(profile);
    for (const sentinel of ["31337", "nota privada", "ana@x.com"]) expect(serialized).not.toContain(sentinel);
  });

  it("UT-071 sem consentimento, nenhum currículo; com ele, sem e-mail, telefone nem pretensão", () => {
    const content = [
      "# Ana Souza",
      "Contato: ana@x.com · +55 11 91234-5678",
      "",
      "Engenheira de dados há dez anos.",
      "",
      "Pretensão salarial: R$ 30.000",
    ].join("\n");
    expect(toAllowlistedProfile(row({ publicCv: false }), [], content).cv).toBeNull();
    const cv = toAllowlistedProfile(row({ publicCv: true }), [], content).cv ?? "";
    expect(cv).toContain("Engenheira de dados há dez anos.");
    for (const sentinel of ["ana@x.com", "91234-5678", "30.000"]) expect(cv, sentinel).not.toContain(sentinel);
  });

  it("UT-072 modelo de trabalho sem opt-in não sai em facts", () => {
    const hidden = toAllowlistedProfile(row({ workModel: ["remote"], publicWorkModel: false }), [], null);
    expect(hidden.facts.workModel).toEqual([]);
    const shown = toAllowlistedProfile(row({ workModel: ["remote"], publicWorkModel: true }), [], null);
    expect(shown.facts.workModel).toEqual(["remote"]);
  });

  it("só perfil Público tem endereço; Recrutadores sai sem `/p/` mesmo com slug guardado", () => {
    expect(toAllowlistedProfile(row({ visibility: "public" }), [], null).slug).toBe("ana");
    expect(toAllowlistedProfile(row({ visibility: "recruiters" }), [], null).slug).toBe("");
    expect(toAllowlistedProfile(row({ visibility: "public", publicSlug: null }), [], null).slug).toBe("");
  });

  it("skill com e-mail no nível some inteira", () => {
    const skills = toAllowlistedProfile(
      row(),
      [
        { name: "Go", category: "language", level: "fale com ana@x.com", occurrences: 1 },
        { name: "Rust", category: "language", level: null, occurrences: 2 },
      ],
      null,
    ).skills;
    expect(skills.map((skill) => skill.name)).toEqual(["Rust"]);
  });
});

describe("dicas de visibilidade", () => {
  it("UT-074 a dica de Recrutadores nomeia quem se cadastrou sozinho como recrutador, nos dois idiomas", () => {
    expect(ptBR.visibility.recruitersHint).toMatch(/se cadastrou sozinho como recrutador/);
    expect(en.visibility.recruitersHint).toMatch(/signed up as recruiters on their own/);
    // O consentimento do currículo nomeia as duas visibilidades em que vale.
    expect(ptBR.visibility.publishCv).toMatch(/Recrutadores e Público/);
    expect(en.visibility.publishCv).toMatch(/Recruiters and Public/);
  });
});
