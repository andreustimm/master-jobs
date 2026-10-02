// #439 — o detalhe de uma execução de verificação não pode usar o texto de
// completude da captura ("janela parcial: não fecha por ausência"): a
// verificação só fecha com 404 ou 410 (G26), nunca por ausência de listagem.
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

describe("completenessKey (#439)", () => {
  it("captura continua descrevendo a listagem da fonte", () => {
    for (const scope of ["source", "all"]) {
      expect(completenessKey(scope, "complete")).toBe("platforms.snapshotComplete");
      expect(completenessKey(scope, "partial")).toBe("platforms.snapshotPartial");
      expect(completenessKey(scope, null)).toBe("platforms.snapshotUnknown");
    }
  });

  it("verificação tem texto próprio, sem a chave da captura", () => {
    expect(completenessKey("verify", "complete")).toBe("runs.verifyComplete");
    expect(completenessKey("verify", "partial")).toBe("runs.verifyPartial");
    expect(completenessKey("verify", null)).toBe("platforms.snapshotUnknown");
  });

  it("o texto da verificação, nos dois idiomas, não fala de fechar por ausência", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      for (const key of ["runs.verifyComplete", "runs.verifyPartial"]) {
        const value = text(locale, key);
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toMatch(/aus[eê]ncia|absence|janela|window|listing|lista/i);
      }
      expect(text(locale, "runs.verifyComplete")).not.toBe(text(locale, "runs.verifyPartial"));
    }
  });
});
