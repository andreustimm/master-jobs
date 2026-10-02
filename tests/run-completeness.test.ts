// #439 — o detalhe de uma execução de verificação não pode usar o texto de
// completude da captura ("janela parcial: não fecha por ausência"): a
// verificação só fecha com 404 ou 410 (G26), nunca por ausência de listagem. E
// a verificação global (sem fonte) olha só as vagas elegíveis (fit 55 ou mais),
// então não pode prometer "todas as vagas abertas".
import { describe, expect, it } from "vitest";
import { completenessCopy, completenessKey, type CompletenessRun } from "../app/admin/execucoes/run-completeness.ts";
import { en } from "../src/core/i18n/en.ts";
import { translator } from "../src/core/i18n/index.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import { DEFAULT_VERIFY_MIN_FIT } from "../src/core/ingest/availability.ts";

const dictionaries = { "pt-BR": ptBR, en } as const;

function text(locale: keyof typeof dictionaries, key: string): string {
  const [section, name] = key.split(".") as [string, string];
  const value = (dictionaries[locale] as unknown as Record<string, Record<string, string>>)[section]?.[name];
  if (value === undefined) throw new Error(`chave ausente em ${locale}: ${key}`);
  return value;
}

const VERIFY_KEYS = ["runs.verifyComplete", "runs.verifyPartial", "runs.verifyAllComplete", "runs.verifyAllPartial"];

describe("completenessKey (#439)", () => {
  it("captura continua descrevendo a listagem da fonte", () => {
    for (const [scope, sourceId] of [["source", "lever:x"], ["all", null]] as const) {
      expect(completenessKey(scope, sourceId, "complete")).toBe("platforms.snapshotComplete");
      expect(completenessKey(scope, sourceId, "partial")).toBe("platforms.snapshotPartial");
      expect(completenessKey(scope, sourceId, null)).toBe("platforms.snapshotUnknown");
    }
  });

  it("verificação de uma plataforma tem texto próprio, sem a chave da captura", () => {
    expect(completenessKey("verify", "lever:x", "complete")).toBe("runs.verifyComplete");
    expect(completenessKey("verify", "lever:x", "partial")).toBe("runs.verifyPartial");
    expect(completenessKey("verify", "lever:x", null)).toBe("platforms.snapshotUnknown");
  });

  it("verificação global (sem fonte) tem texto próprio, distinto do da plataforma", () => {
    expect(completenessKey("verify", null, "complete")).toBe("runs.verifyAllComplete");
    expect(completenessKey("verify", null, "partial")).toBe("runs.verifyAllPartial");
    expect(completenessKey("verify", null, null)).toBe("platforms.snapshotUnknown");
  });

  it("o texto da verificação, nos dois idiomas, não fala de fechar por ausência", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const values = VERIFY_KEYS.map((key) => text(locale, key));
      for (const value of values) {
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toMatch(/aus[eê]ncia|absence|janela|window|listing|lista/i);
      }
      expect(new Set(values).size).toBe(VERIFY_KEYS.length);
    }
  });

  it("a verificação global diz que o universo é o das vagas elegíveis, com o piso que a verificação usa", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const { t } = translator(locale);
      for (const [completeness, dueTotal] of [["complete", null], ["partial", null], ["complete", 4], ["partial", 9]] as const) {
        const copy = completenessCopy({ scopeKind: "verify", sourceId: null, completeness, fetched: 3, dueTotal });
        const shown = t(copy.key, copy.values);
        // O número vem da constante de `verifyJobs`, não de um literal no dicionário.
        expect(shown).toContain(String(DEFAULT_VERIFY_MIN_FIT));
        expect(shown).not.toMatch(/\{\w+\}/);
        expect(shown).toMatch(/eleg[ií]ve|eligible/i);
      }
    }
  });
});

describe("completenessCopy: N de M (#447)", () => {
  const run = (over: Partial<CompletenessRun>): CompletenessRun => ({
    scopeKind: "verify",
    sourceId: "lever:x",
    completeness: "partial",
    fetched: 3,
    dueTotal: 9,
    ...over,
  });
  const shown = (locale: "pt-BR" | "en", over: Partial<CompletenessRun>) => {
    const copy = completenessCopy(run(over));
    return translator(locale).t(copy.key, copy.values);
  };

  it("com o total vencido gravado, a verificação diz quantas de quantas foram checadas", () => {
    expect(shown("pt-BR", {})).toBe(
      "conferência cortada pelo limite ou pelo orçamento de requisições: 3 de 9 vagas abertas da fonte com link público foram checadas",
    );
    expect(shown("en", {})).toBe(
      "check cut by the limit or the request budget: 3 of 9 open jobs of the source with a public link were checked",
    );
    expect(shown("pt-BR", { completeness: "complete", fetched: 9 })).toBe(
      "conferência completa: 9 de 9 vagas abertas da fonte com link público foram checadas",
    );
    expect(shown("pt-BR", { sourceId: null })).toContain("3 de 9 vagas elegíveis");
    expect(shown("en", { sourceId: null, completeness: "complete", fetched: 9 })).toContain("full check: 9 of 9 eligible jobs");
  });

  it("execução antiga (total nulo) mantém a frase sem número — desconhecido não vira zero", () => {
    for (const over of [{ dueTotal: null }, { fetched: null }] as const) {
      const copy = completenessCopy(run(over));
      expect(copy.key).toBe("runs.verifyPartial");
      expect(shown("pt-BR", over)).not.toMatch(/\d+ de \d+/);
    }
    expect(completenessCopy(run({ sourceId: null, completeness: "complete", dueTotal: null })).key).toBe("runs.verifyAllComplete");
  });

  it("captura e completude desconhecida não ganham número, mesmo com contagens", () => {
    expect(completenessCopy(run({ scopeKind: "source", completeness: "partial" })).key).toBe("platforms.snapshotPartial");
    expect(completenessCopy(run({ scopeKind: "all", sourceId: null, completeness: "complete" })).key).toBe("platforms.snapshotComplete");
    expect(completenessCopy(run({ completeness: null })).key).toBe("platforms.snapshotUnknown");
  });

  it("as frases com número existem nos dois idiomas, com os mesmos marcadores", () => {
    for (const key of ["runs.verifyCompleteCount", "runs.verifyPartialCount", "runs.verifyAllCompleteCount", "runs.verifyAllPartialCount"]) {
      const marks = (locale: keyof typeof dictionaries) => [...text(locale, key).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(marks("pt-BR")).toEqual(marks("en"));
      expect(marks("pt-BR")).toEqual(expect.arrayContaining(["checked", "due"]));
      expect(text("pt-BR", key)).not.toMatch(/aus[eê]ncia|janela|lista/i);
      expect(text("en", key)).not.toMatch(/absence|window|listing/i);
    }
  });
});
