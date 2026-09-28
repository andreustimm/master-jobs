import { describe, expect, it } from "vitest";
import {
  AREA_MAX,
  AVAILABILITY_STATUSES,
  EXPERIENCE_LEVELS,
  LANGUAGES_MAX,
  START_TIMEFRAMES,
  WORK_MODELS,
  parsePublicFactsForm,
  publicFactsFrom,
  type PublicFactsFormInput,
  type StoredFacts,
} from "../src/core/candidate-public-facts.ts";
import { containsPay } from "../src/core/public-cv.ts";

/**
 * Fatos do perfil público (#327, parte A). Duas camadas, testadas em
 * separado: a ENTRADA recusa o que não deve ser gravado e explica por quê; a
 * SAÍDA decide o que sai em `/p/`, e não confia na entrada — dado pode chegar
 * por migration, CLI ou `UPDATE` à mão.
 */

const EMPTY_FORM: PublicFactsFormInput = {
  workModel: [],
  experienceLevel: "",
  availability: "",
  startTimeframe: "",
  openToRelocation: "",
  area: "",
  languages: "",
  show: {},
};

const FULL_ROW: StoredFacts = {
  workModel: ["b2b", "remote"],
  experienceLevel: "principal",
  availability: "open",
  startTimeframe: "one-month",
  openToRelocation: false,
  area: "Arquitetura de software e IA",
  languages: "Português (nativo), Inglês (fluente)",
  publicWorkModel: true,
  publicExperienceLevel: true,
  publicAvailability: true,
  publicStartTimeframe: true,
  publicRelocation: true,
  publicArea: true,
  publicLanguages: true,
};

const ALL_OFF = {
  publicWorkModel: false,
  publicExperienceLevel: false,
  publicAvailability: false,
  publicStartTimeframe: false,
  publicRelocation: false,
  publicArea: false,
  publicLanguages: false,
} as const;

describe("entrada: parsePublicFactsForm", () => {
  it("T1 formulário vazio grava tudo nulo e todo opt-in desligado", () => {
    expect(parsePublicFactsForm(EMPTY_FORM)).toEqual({
      ok: true,
      value: {
        workModel: null,
        experienceLevel: null,
        availability: null,
        startTimeframe: null,
        openToRelocation: null,
        area: null,
        languages: null,
        ...ALL_OFF,
      },
    });
  });

  it("T1 formulário cheio vira colunas: controlados reconhecidos, livres aparados, opt-in só onde marcado", () => {
    const parsed = parsePublicFactsForm({
      workModel: ["remote", "b2b", "remote"],
      experienceLevel: "senior",
      availability: "actively-looking",
      startTimeframe: "two-weeks",
      openToRelocation: "yes",
      area: "  Engenharia de dados  ",
      languages: " Inglês C1 ",
      show: { workModel: true, area: true },
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        // Deduplicado e na ordem canônica da lista — não na do clique.
        workModel: ["remote", "b2b"],
        experienceLevel: "senior",
        availability: "actively-looking",
        startTimeframe: "two-weeks",
        openToRelocation: true,
        area: "Engenharia de dados",
        languages: "Inglês C1",
        ...ALL_OFF,
        publicWorkModel: true,
        publicArea: true,
      },
    });
  });

  it("T1 aceita mudar: `no` é false, vazio é nulo — 'não aceita' não é 'não informado'", () => {
    const no = parsePublicFactsForm({ ...EMPTY_FORM, openToRelocation: "no" });
    expect(no.ok && no.value.openToRelocation).toBe(false);
    const blank = parsePublicFactsForm({ ...EMPTY_FORM, openToRelocation: "" });
    expect(blank.ok && blank.value.openToRelocation).toBeNull();
  });

  it("T2 valor controlado fora da lista é recusado, em cada campo", () => {
    // O formulário só oferece a lista; outro valor é requisição forjada, e
    // gravá-lo deixaria a coluna num estado que nenhum ramo reconhece.
    for (const patch of [
      { workModel: ["remote", "w2-onsite-austin"] },
      { experienceLevel: "ninja" },
      { availability: "maybe" },
      { startTimeframe: "yesterday" },
      { openToRelocation: "talvez" },
    ]) {
      expect(parsePublicFactsForm({ ...EMPTY_FORM, ...patch }), JSON.stringify(patch)).toEqual({
        ok: false,
        code: "invalidChoice",
      });
    }
  });

  it("T3 texto livre acima do teto é recusado, não truncado", () => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "a".repeat(AREA_MAX + 1) })).toEqual({
      ok: false,
      code: "areaTooLong",
    });
    expect(parsePublicFactsForm({ ...EMPTY_FORM, languages: "l".repeat(LANGUAGES_MAX + 1) })).toEqual({
      ok: false,
      code: "languagesTooLong",
    });
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "a".repeat(AREA_MAX) }).ok).toBe(true);
  });

  it("T4 e-mail ou telefone no texto livre é recusado com a razão", () => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "IA — fale comigo: pia@local.test" })).toEqual({
      ok: false,
      code: "areaContact",
    });
    expect(parsePublicFactsForm({ ...EMPTY_FORM, languages: "Inglês, WhatsApp +55 11 91234-5678" })).toEqual({
      ok: false,
      code: "languagesContact",
    });
  });

  it("T5 pretensão salarial no texto livre é recusada com a razão", () => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "Backend · Pretensão: USD 15,000" })).toEqual({
      ok: false,
      code: "areaPay",
    });
    expect(parsePublicFactsForm({ ...EMPTY_FORM, languages: "Inglês; salário: 30k" })).toEqual({
      ok: false,
      code: "languagesPay",
    });
  });
});

describe("saída: publicFactsFrom", () => {
  it("T6 com todo opt-in desligado, nada sai — mesmo com os sete valores gravados", () => {
    const facts = publicFactsFrom({ ...FULL_ROW, ...ALL_OFF });
    expect(facts).toEqual({
      workModel: [],
      experienceLevel: null,
      availability: null,
      startTimeframe: null,
      openToRelocation: null,
      area: null,
      languages: null,
    });
    const serialized = JSON.stringify(facts);
    // Valores entre aspas: a CHAVE `openToRelocation` contém "open".
    for (const sentinel of ['"b2b"', '"principal"', '"open"', '"one-month"', "Arquitetura", "Português"]) {
      expect(serialized, sentinel).not.toContain(sentinel);
    }
  });

  it("T6 opt-in nulo (linha importada do snapshot) é desligado", () => {
    const nulls = Object.fromEntries(Object.keys(ALL_OFF).map((key) => [key, null]));
    expect(publicFactsFrom({ ...FULL_ROW, ...nulls })).toEqual(publicFactsFrom({ ...FULL_ROW, ...ALL_OFF }));
  });

  it("T6 cada opt-in desligado sozinho esconde só o próprio campo", () => {
    const cases = [
      ["publicWorkModel", "workModel", []],
      ["publicExperienceLevel", "experienceLevel", null],
      ["publicAvailability", "availability", null],
      ["publicStartTimeframe", "startTimeframe", null],
      ["publicRelocation", "openToRelocation", null],
      ["publicArea", "area", null],
      ["publicLanguages", "languages", null],
    ] as const;
    const all = publicFactsFrom(FULL_ROW);
    for (const [flag, field, hidden] of cases) {
      const facts = publicFactsFrom({ ...FULL_ROW, [flag]: false });
      expect(facts[field], flag).toEqual(hidden);
      expect({ ...facts, [field]: all[field] }, flag).toEqual(all);
    }
  });

  it("T7 com opt-in ligado, os sete saem; sem valor, o ligado sai nulo", () => {
    expect(publicFactsFrom(FULL_ROW)).toEqual({
      workModel: ["remote", "b2b"],
      experienceLevel: "principal",
      availability: "open",
      startTimeframe: "one-month",
      openToRelocation: false,
      area: "Arquitetura de software e IA",
      languages: "Português (nativo), Inglês (fluente)",
    });
    expect(
      publicFactsFrom({
        ...FULL_ROW,
        workModel: null,
        experienceLevel: null,
        availability: null,
        startTimeframe: null,
        openToRelocation: null,
        area: null,
        languages: null,
      }),
    ).toEqual({
      workModel: [],
      experienceLevel: null,
      availability: null,
      startTimeframe: null,
      openToRelocation: null,
      area: null,
      languages: null,
    });
  });

  it("T8 valor controlado desconhecido gravado por outro caminho não sai", () => {
    const facts = publicFactsFrom({
      ...FULL_ROW,
      workModel: ["w2", "remote", "remote", "b2b", ""],
      experienceLevel: "ninja",
      availability: "maybe",
      startTimeframe: "yesterday",
    });
    expect(facts.workModel).toEqual(["remote", "b2b"]);
    expect(facts.experienceLevel).toBeNull();
    expect(facts.availability).toBeNull();
    expect(facts.startTimeframe).toBeNull();
  });

  it("T9 texto livre com contato ou pretensão, gravado por outro caminho, sai nulo", () => {
    const known = { emails: ["pia@intranet"] };
    const facts = publicFactsFrom(
      {
        ...FULL_ROW,
        area: "Arquitetura — contato interno pia@intranet",
        languages: "Inglês · Pretensão salarial: R$ 30.000",
      },
      known,
    );
    expect(facts.area).toBeNull();
    expect(facts.languages).toBeNull();
    expect(publicFactsFrom({ ...FULL_ROW, area: "Dados, 11912345678" }).area).toBeNull();
    // Espaço em volta e vazio não viram fato.
    expect(publicFactsFrom({ ...FULL_ROW, area: "   " }).area).toBeNull();
  });
});

describe("containsPay", () => {
  it("T10 pega rótulo de piso e remuneração perto de valor", () => {
    for (const text of [
      "Pretensão: USD 15,000",
      "piso salarial 20k",
      "Salary expectation: 150000",
      "Remuneração R$ 25.000",
      "Salário:",
    ]) {
      expect(containsPay(text), text).toBe(true);
    }
  });

  it("T10 não pega área nem idioma comuns", () => {
    for (const text of [
      "Inglês C1",
      "Engenharia de dados",
      "Português (nativo), Inglês (fluente), Espanhol",
      "Arquitetura de software e IA",
      "Payments e fintech",
    ]) {
      expect(containsPay(text), text).toBe(false);
    }
  });
});

describe("listas controladas", () => {
  it("são fechadas e sem repetição", () => {
    for (const list of [WORK_MODELS, EXPERIENCE_LEVELS, AVAILABILITY_STATUSES, START_TIMEFRAMES]) {
      expect(new Set(list).size).toBe(list.length);
      expect(Object.isFrozen(list)).toBe(true);
    }
  });
});
