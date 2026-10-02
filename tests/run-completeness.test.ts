// #439 — o detalhe de uma execução de verificação não pode usar o texto de
// completude da captura ("janela parcial: não fecha por ausência"): a
// verificação só fecha com 404 ou 410 (G26), nunca por ausência de listagem. E
// a verificação global (sem fonte) olha só as vagas elegíveis (fit 55 ou mais),
// então não pode prometer "todas as vagas abertas".
import { describe, expect, it } from "vitest";
import { completenessKey } from "../app/admin/execucoes/run-completeness.ts";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";

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

  it("a verificação global diz que o universo é o das vagas elegíveis, não 'todas as abertas'", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      for (const key of ["runs.verifyAllComplete", "runs.verifyAllPartial"]) {
        expect(text(locale, key)).toMatch(/55/);
        expect(text(locale, key)).toMatch(/eleg[ií]ve|eligible/i);
      }
    }
  });
});
