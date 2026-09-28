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
  shortFieldProblem,
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

describe("telefone sem marca nos campos curtos (revisão L2 #362)", () => {
  const PHONES = ["WhatsApp 11 91234-5678", "tel 11 9 1234 5678", "Inglês · 11.91234.5678", "(11) 91234 5678"];

  it("MINOR 4 entrada recusa com a mensagem de contato", () => {
    for (const text of PHONES) {
      expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }), text).toEqual({ ok: false, code: "areaContact" });
      expect(parsePublicFactsForm({ ...EMPTY_FORM, languages: text }), text).toEqual({
        ok: false,
        code: "languagesContact",
      });
    }
  });

  it("MINOR 4 saída esvazia", () => {
    for (const text of PHONES) {
      expect(publicFactsFrom({ ...FULL_ROW, area: text }).area, text).toBeNull();
    }
  });

  it("MINOR 4 intervalo de anos não é telefone (é número: outra recusa)", () => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "Dados, 2015-2020" })).toEqual({
      ok: false,
      code: "areaNumber",
    });
  });
});

describe("e-mail cadastrado na entrada (revisão L2 #362)", () => {
  it("MINOR 3 recusa o e-mail conhecido mesmo fora do padrão genérico", () => {
    const known = { emails: ["pia@intranet"] };
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "Dados — pia@intranet" }, known)).toEqual({
      ok: false,
      code: "areaContact",
    });
    expect(parsePublicFactsForm({ ...EMPTY_FORM, languages: "Inglês, pia@intranet" }, known)).toEqual({
      ok: false,
      code: "languagesContact",
    });
    // Sem o conhecido, o padrão genérico não o reconhece: é por isso que ele é passado.
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "Dados — pia@intranet" }).ok).toBe(true);
  });
});

describe("custo em entrada longa (revisão L2 #362)", () => {
  it("MINOR 2 containsPay e os detectores dos campos curtos são lineares numa linha de quebras", () => {
    const hostile = `${"\n".repeat(80_000)}x`;
    const started = performance.now();
    expect(containsPay(hostile)).toBe(false);
    expect(shortFieldProblem(hostile, {})).toBeNull();
    expect(shortFieldProblem(`${"1".repeat(80_000)}x`, {})).toBe("contact");
    // Quadrático levava ~3,6 s; linear fica em milissegundos. Folga larga
    // para máquina de CI ocupada, ainda uma ordem de grandeza abaixo.
    expect(performance.now() - started).toBeLessThan(300);
  });

  it("MINOR 2 saída descarta texto acima do teto antes de filtrar", () => {
    const facts = publicFactsFrom({
      ...FULL_ROW,
      area: "a".repeat(AREA_MAX + 1),
      languages: "l".repeat(LANGUAGES_MAX + 1),
    });
    expect(facts.area).toBeNull();
    expect(facts.languages).toBeNull();
    expect(publicFactsFrom({ ...FULL_ROW, area: "a".repeat(AREA_MAX) }).area).toBe("a".repeat(AREA_MAX));
  });
});

/**
 * A regra estrutural dos campos curtos (passadas L2 da #362; decisão do
 * coordenador: parar de caçar formatos de valor). Área e idiomas são
 * palavras: contato é recusado primeiro, rótulo de pretensão depois, e então
 * qualquer número solto — exceto número de norma em maiúscula e dígito curto
 * colado a letra (identificador).
 */
describe("regra estrutural dos campos curtos (#362)", () => {
  const refused = (text: string) => {
    for (const field of ["area", "languages"] as const) {
      const parsed = parsePublicFactsForm({ ...EMPTY_FORM, [field]: text });
      expect(parsed.ok, `${field}: ${text}`).toBe(false);
      if (!parsed.ok) expect([`${field}Pay`, `${field}Number`], `${field}: ${text}`).toContain(parsed.code);
    }
    const out = publicFactsFrom({ ...FULL_ROW, area: text, languages: text });
    expect(out.area, text).toBeNull();
    expect(out.languages, text).toBeNull();
  };
  const accepted = (text: string) => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }).ok, text).toBe(true);
    expect(publicFactsFrom({ ...FULL_ROW, area: text }).area, text).toBe(text);
  };

  // Todos os contraexemplos de piso das rodadas de revisão.
  const PAY_COUNTEREXAMPLES = [
    // revisão L2, os 9 originais
    "Piso 20k",
    "Expectativa: 20k",
    "Target: USD 180k",
    "Min 150k",
    "Remote only, $150/h",
    "Rate 90/h",
    "Pay 20k",
    "USD 15,000/mês",
    "Engenharia de dados — 20k USD/mês",
    // re-revisão: rate em qualquer posição e os 13 formatos
    "Dados\nRate: 150",
    "IA, rate: 150",
    "Dados · daily rate 150",
    "Rate 90",
    "90/hr",
    "90/hrs",
    "90/yr",
    "150/mo",
    "150 por hora",
    "150 per hour",
    "90 an hour",
    "USD15000",
    "EUR15000",
    "BRL30000",
    "Piso 30 000",
    "30'000",
    "90 dollars",
    "30 mil reais",
    "15000 euros",
    "R$ 30 mil",
    "Piso 2k USD",
    // passada final: mil e k
    "PJ 30 mil",
    "CLT 15 mil + benefícios",
    "Dados — 30 mil/mês",
    "30 mil por mês",
    "30 mil mensais",
    "30mil",
    "15 mil",
    "Dados 20 mil líquido",
    "15 thousand",
    "1 million",
    "12,5k",
    "7.5k",
    "Dados — 12,5k/mês",
    "1.5k/h",
    "9k/mês",
    "Pay 4k",
    "4.5K",
    "Target 150",
    "daily rate: $500",
    "RFC 15000",
    "NBR 20000/mês",
    "iso 30000",
    "Dados (ISO 150000)",
    // esta rodada
    "8K USD",
    "4K/mês",
    "150 hourly",
    "150 mensais",
    "diária 150",
    "600 a diária",
    "150 p/h",
    "150 per diem",
    "15kUSD",
    "Piso ISO 15000",
  ];

  it("todo contraexemplo de piso das rodadas é recusado na entrada e esvaziado na saída", () => {
    for (const text of PAY_COUNTEREXAMPLES) refused(text);
  });

  it("palavras, identificadores e número de norma passam", () => {
    for (const text of [
      "Dados & IA",
      "Inglês C1",
      "Espanhol B2",
      "Java/Go",
      "Web3",
      "K8s",
      "S3 e IPv6",
      "Java21",
      "ISO 27001",
      "ISO 27001:2022",
      "ISO/IEC 42001",
      "IEC 61131",
      "RFC 9110",
      "Segurança da informação (ISO 27001)",
      "Marketing (target: B2B)",
      "Growth (conversion rate)",
      "Projetos reais de IA",
      "euros e câmbio",
    ]) {
      accepted(text);
    }
  });

  it("número solto é recusado com a mensagem de número, não a de dinheiro", () => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "15 mil" })).toEqual({ ok: false, code: "areaNumber" });
    expect(parsePublicFactsForm({ ...EMPTY_FORM, languages: "Inglês 10 anos" })).toEqual({
      ok: false,
      code: "languagesNumber",
    });
  });

  it("rótulo de pretensão, mesmo sem número, é recusado como pretensão", () => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "Pretensão a combinar" })).toEqual({
      ok: false,
      code: "areaPay",
    });
  });

  it("contato é conferido antes de número", () => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "11 91234 - 5678" })).toEqual({
      ok: false,
      code: "areaContact",
    });
  });

  it("falso positivo aceito, declarado em G21: resolução, anos, volume e norma em minúscula", () => {
    for (const text of ["Streaming 4K", "8K HDR", "Dados 2015-2020", "10 mil TPS", "Qualidade iso 9001"]) {
      expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }), text).toEqual({ ok: false, code: "areaNumber" });
    }
  });

  it("limite declarado: número por extenso passa", () => {
    accepted("vinte mil");
  });

  it("shortFieldProblem devolve o motivo na ordem da tela", () => {
    expect(shortFieldProblem("pia@local.test 20k", {})).toBe("contact");
    expect(shortFieldProblem("Pretensão: 20k", {})).toBe("pay");
    expect(shortFieldProblem("20k", {})).toBe("number");
    expect(shortFieldProblem("Dados & IA", {})).toBeNull();
  });
});

/**
 * Passada L2 de `0fdd8cd`: moeda ou regime colado a dígito curto, forma de
 * compatibilidade e dígito de outra escrita, e-mail com espaço em volta de
 * `@`, e a palavra de remuneração inteira.
 */
describe("passada L2 de 0fdd8cd (#362)", () => {
  const refusedAs = (text: string, code: string) => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }), text).toEqual({ ok: false, code });
    expect(publicFactsFrom({ ...FULL_ROW, area: text }).area, text).toBeNull();
  };
  const accepted = (text: string) => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }).ok, text).toBe(true);
    expect(publicFactsFrom({ ...FULL_ROW, area: text }).area, text).toBe(text);
  };

  it("MAJOR: moeda ou regime colado a um ou dois dígitos é número", () => {
    for (const text of [
      "USD30k",
      "EUR12k",
      "BRL25k",
      "CHF12k",
      "USD9K",
      "USD90/h",
      "USD90/hr",
      "EUR9k/mês",
      "GBP80/day",
      "USD30",
      "PJ30k",
      "CLT15k",
      "R30k",
      "US30k",
    ]) {
      refusedAs(text, "areaNumber");
    }
  });

  it("MAJOR: identificador curto colado a letra continua passando", () => {
    for (const text of ["Web3", "K8s", "B2B", "C1", "IPv6", "Java21", "S3", "EC2", "JLPT N2"]) accepted(text);
  });

  it("MINOR 2: forma de compatibilidade e dígito de outra escrita não escapam", () => {
    for (const text of ["３０ｋ", "１５０/h", "USD ３００００", "٣٠k", "³⁰k", "①⑤⓪/h"]) refusedAs(text, "areaNumber");
    refusedAs("１１ ９１２３４-５６７８", "areaContact");
    refusedAs("pia＠local.test", "areaContact");
  });

  it("MINOR 3: espaço em volta de @ não esconde o e-mail", () => {
    refusedAs("pia @ local.test", "areaContact");
    refusedAs("Dados, pia  @  local.test", "areaContact");
  });

  it("MINOR 4: palavra de remuneração só conta inteira — a exceção de norma volta a valer", () => {
    accepted("Payments e ISO 27001");
    accepted("Cadeia de valor e ISO 9001");
    refusedAs("Piso ISO 15000", "areaNumber");
  });

  it("MINOR 4, falso positivo aceito e declarado em G21: notas, versões, 3D/5G e rankings", () => {
    for (const text of [
      "TOEFL 110",
      "IELTS 7.5",
      "HSK 4",
      "Python 3",
      "Next.js 15",
      "GPT-4",
      "Web 3.0",
      "Indústria 4.0",
      "3D",
      "5G",
      "Tier 1",
      "Top 10",
      "Fortune 500",
      "Big 4",
    ]) {
      refusedAs(text, "areaNumber");
    }
  });

  it("limite declarado: ofuscação de e-mail por extenso passa", () => {
    accepted("pia at local dot test");
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
