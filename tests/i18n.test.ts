import { describe, expect, it } from "vitest";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import {
  DEFAULT_LOCALE,
  LOCALES,
  formatNumber,
  isLocale,
  negotiateLocale,
  resolveLocale,
  translator,
} from "../src/core/i18n/index.ts";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null
      ? flatten(value as Record<string, unknown>, path)
      : [path];
  });
}

describe("dicionários", () => {
  it("cobrem exatamente as mesmas chaves", () => {
    // O tipo já obriga, mas isto nomeia o que falta em vez de apontar uma
    // linha de erro do compilador.
    const pt = flatten(ptBR).sort();
    const english = flatten(en as unknown as Record<string, unknown>).sort();
    expect(english).toEqual(pt);
  });

  it("não deixam nenhuma string vazia", () => {
    // Chave vazia passa no tipo e some na tela.
    for (const [name, dict] of [["pt-BR", ptBR], ["en", en]] as const) {
      const empty = flatten(dict as unknown as Record<string, unknown>).filter((path) => {
        const value = path.split(".").reduce<unknown>((acc, k) => (acc as never)?.[k], dict);
        return typeof value === "string" && value.trim() === "";
      });
      expect(empty, name).toEqual([]);
    }
  });

  it("traduzem de verdade, em vez de copiar", () => {
    // Alguns termos são iguais nos dois idiomas de propósito (Cockpit,
    // Referrals, cluster). O que não pode é a maioria ser cópia.
    const paths = flatten(ptBR);
    const identical = paths.filter((path) => {
      const get = (d: unknown) => path.split(".").reduce<unknown>((acc, k) => (acc as never)?.[k], d);
      return get(ptBR) === get(en);
    });
    expect(identical.length / paths.length).toBeLessThan(0.3);
  });
});

describe("translator", () => {
  const { t } = translator("pt-BR");

  it("resolve chave aninhada", () => {
    expect(t("nav.jobs")).toBe("Vagas");
    expect(translator("en").t("nav.jobs")).toBe("Jobs");
  });

  it("devolve a chave quando a tradução não existe", () => {
    // Feio de propósito: espaço em branco passa despercebido numa revisão,
    // `nav.inexistente` na tela não. Reflect reproduz entrada JavaScript não
    // tipada sem enfraquecer o contrato TypeScript usado pela aplicação.
    expect(Reflect.apply(t, undefined, ["nav.inexistente"])).toBe("nav.inexistente");
    expect(Reflect.apply(t, undefined, [""])).toBe("");
  });

  it("interpola valores", () => {
    const custom = translator("pt-BR");
    expect(custom.t("jobs.matching")).not.toContain("{");
  });

  it("cai no padrão para idioma desconhecido", () => {
    const unknownLocale = Reflect.apply(translator, undefined, ["xx"]);
    expect(unknownLocale.t("nav.jobs")).toBe("Vagas");
  });
});

describe("negotiateLocale", () => {
  it("respeita a ordem de preferência do navegador", () => {
    expect(negotiateLocale("en-US,en;q=0.9,pt;q=0.8")).toBe("en");
    expect(negotiateLocale("pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt-BR");
  });

  it("casa pela raiz do idioma", () => {
    // Recusar português de Portugal e cair no inglês seria pior que servir a
    // variante brasileira.
    expect(negotiateLocale("pt-PT")).toBe("pt-BR");
  });

  it("cai no padrão sem cabeçalho ou com idioma desconhecido", () => {
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("ja-JP,ko")).toBe(DEFAULT_LOCALE);
  });

  it("não quebra com cabeçalho malformado", () => {
    expect(negotiateLocale(";;;q=abc,,")).toBe(DEFAULT_LOCALE);
  });
});

describe("resolveLocale", () => {
  it("aceita só idioma suportado", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("klingon")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("xx")).toBe(false);
  });
});

describe("formatNumber", () => {
  it("usa a convenção de cada idioma", () => {
    // 1.504 em português, 1,504 em inglês — trocar isso muda o número lido.
    expect(formatNumber(1504, "pt-BR")).toBe("1.504");
    expect(formatNumber(1504, "en")).toBe("1,504");
  });
});

describe("LOCALES", () => {
  it("tem português como padrão", () => {
    expect(DEFAULT_LOCALE).toBe("pt-BR");
    expect(LOCALES.map((l) => l.id)).toContain("en");
  });
});
