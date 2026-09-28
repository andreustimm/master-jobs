import { describe, expect, it } from "vitest";
import {
  AREA_MAX,
  AVAILABILITY_STATUSES,
  EXPERIENCE_LEVELS,
  LANGUAGES_MAX,
  START_TIMEFRAMES,
  WORK_MODELS,
  containsShortFieldContact,
  containsShortFieldPay,
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

/**
 * Revisão L2 da PR #362 (FIX_BEFORE_SHIP): valor sem rótulo de pretensão
 * passava pelos dois filtros. Num campo curto de área ou idiomas não há
 * motivo para dinheiro: o valor (`containsShortFieldPay()`) é recusado na
 * entrada e esvaziado na saída.
 */
const UNLABELED_PAY = [
  "Piso 20k",
  "Expectativa: 20k",
  "Target: USD 180k",
  "Min 150k",
  "Remote only, $150/h",
  "Rate 90/h",
  "Pay 20k",
  "USD 15,000/mês",
  "Engenharia de dados — 20k USD/mês",
];

describe("valor sem rótulo (revisão L2 #362)", () => {
  it("MAJOR entrada recusa cada contraexemplo com a mensagem de pretensão, nos dois campos", () => {
    for (const text of UNLABELED_PAY) {
      expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }), text).toEqual({ ok: false, code: "areaPay" });
      expect(parsePublicFactsForm({ ...EMPTY_FORM, languages: text }), text).toEqual({
        ok: false,
        code: "languagesPay",
      });
    }
  });

  it("MAJOR saída esvazia cada contraexemplo gravado direto no banco com opt-in ligado", () => {
    for (const text of UNLABELED_PAY) {
      const facts = publicFactsFrom({ ...FULL_ROW, area: text, languages: text });
      expect(facts.area, text).toBeNull();
      expect(facts.languages, text).toBeNull();
    }
  });

  it("MAJOR o detector de valor não pega área nem idioma comuns, nem ano", () => {
    for (const text of ["Inglês C1", "Engenharia de dados desde 2015", "Português (nativo), Inglês (fluente)", "Web3 e IA"]) {
      expect(containsShortFieldPay(text), text).toBe(false);
    }
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

  it("MINOR 4 intervalo de anos não é telefone", () => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "Dados, 2015-2020" }).ok).toBe(true);
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
    expect(containsShortFieldPay(hostile)).toBe(false);
    expect(containsShortFieldContact(hostile, {})).toBe(false);
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
 * Re-revisão L2 da #362 (SHIP com três Minor): o detector dos campos curtos
 * é próprio — não o `MONEY_LIKE` do currículo —, para cobrir os formatos que
 * passavam sem recusar área legítima com mensagem enganosa.
 */
describe("re-revisão L2 #362: formatos de valor nos campos curtos", () => {
  const assertRefused = (text: string) => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }), text).toEqual({ ok: false, code: "areaPay" });
    expect(parsePublicFactsForm({ ...EMPTY_FORM, languages: text }), text).toEqual({
      ok: false,
      code: "languagesPay",
    });
    expect(publicFactsFrom({ ...FULL_ROW, area: text }).area, text).toBeNull();
  };

  it("Minor 1: `rate` com dois-pontos ou número em qualquer posição é pretensão", () => {
    for (const text of ["Dados\nRate: 150", "IA, rate: 150", "Dados · daily rate 150", "Rate 90"]) assertRefused(text);
  });

  it("Minor 2: unidade de tempo, moeda colada, milhar com espaço/apóstrofo, moeda por extenso", () => {
    for (const text of [
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
    ]) {
      assertRefused(text);
    }
  });

  it("Minor 3: área legítima com número de norma, resolução, moeda por extenso solta passa", () => {
    for (const text of [
      "Segurança da informação (ISO 27001)",
      "Qualidade ISO 9001",
      "IA (ISO/IEC 42001)",
      "Automação industrial IEC 61131",
      "Streaming 4K",
      "Reais problemas de dados",
      "Projetos reais de IA",
      "Fintech / euros e câmbio",
    ]) {
      expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }).ok, text).toBe(true);
      expect(publicFactsFrom({ ...FULL_ROW, area: text }).area, text).toBe(text);
    }
  });

  it("Minor 3: contato é conferido antes de valor — telefone com hífen solto leva a mensagem de contato", () => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "11 91234 - 5678" })).toEqual({
      ok: false,
      code: "areaContact",
    });
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: "Dados, 2015 - 2020" }).ok).toBe(true);
  });

  it("Minor 3: moeda por extenso colada a número e 'mil' com moeda continuam valor", () => {
    for (const text of ["30 mil reais", "15000 euros", "R$ 30 mil", "Piso 2k USD"]) assertRefused(text);
  });
});

/**
 * Passada final L2 da #362 (FIX_BEFORE_SHIP, "fechar por segurança"): `mil` e
 * `k` com número são SEMPRE valor — menos `4K`/`8K` exatos, resolução —;
 * `target`/`pay`/`rate` só com número ou moeda depois; norma só em maiúscula,
 * com número curto e sem unidade de valor depois.
 */
describe("passada final L2 #362", () => {
  const assertRefused = (text: string) => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }), text).toEqual({ ok: false, code: "areaPay" });
    expect(publicFactsFrom({ ...FULL_ROW, area: text }).area, text).toBeNull();
  };
  const assertAccepted = (text: string) => {
    expect(parsePublicFactsForm({ ...EMPTY_FORM, area: text }).ok, text).toBe(true);
    expect(publicFactsFrom({ ...FULL_ROW, area: text }).area, text).toBe(text);
  };

  it("MAJOR: 'mil'/'thousand'/'million' e 'k' com número, inteiro ou decimal, são valor", () => {
    for (const text of [
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
    ]) {
      assertRefused(text);
    }
  });

  it("MAJOR: só '4K' e '8K' exatos, de resolução, passam", () => {
    assertAccepted("Streaming 4K");
    assertAccepted("Vídeo 8K e HDR");
  });

  it("MAJOR, falso positivo aceito: 'mil' de volume é recusado com a mensagem de pretensão", () => {
    assertRefused("Engenharia de dados; 10 mil TPS");
  });

  it("MINOR 2: 'target'/'pay'/'rate' sem número ou moeda depois, e 'rate' de métrica, passam", () => {
    assertAccepted("Marketing (target: B2B)");
    assertAccepted("Growth (conversion rate: 3%)");
    assertAccepted("Vídeo: frame rate 60 fps");
  });

  it("MINOR 2: com número ou moeda depois, continuam valor", () => {
    for (const text of ["Target: USD 180k", "Target 150", "IA, rate: 150", "Rate 90", "daily rate: $500"]) {
      assertRefused(text);
    }
  });

  it("MINOR 2, falso positivo aceito: milhar com espaço é recusado", () => {
    assertRefused("Equipes de 1 200 pessoas");
  });

  it("MINOR 3: norma só em maiúscula, número curto, sem unidade de valor depois", () => {
    for (const text of ["RFC 15000", "NBR 20000/mês", "iso 30000", "Dados (ISO 150000)"]) assertRefused(text);
    for (const text of ["ISO 27001", "ISO/IEC 42001", "ISO 9001:2015", "RFC 9110"]) assertAccepted(text);
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
