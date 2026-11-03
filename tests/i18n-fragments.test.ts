// Suite: dicionário em fragmentos por área (#531)
// Invariant: todo `<área>.pt-BR.ts` tem o par `<área>.en.ts` com as mesmas
//   chaves; cada seção é definida por um único fragmento; e a junção
//   (`pt-BR.ts`, `en.ts`) entrega o fragmento inteiro. O arquivo que o PR de uma
//   área edita é o da área, e é isto que impede dois PRs de colidirem no mesmo.
// Boundary IN: src/core/i18n/*.pt-BR.ts, src/core/i18n/*.en.ts,
//   src/core/i18n/pt-BR.ts, src/core/i18n/en.ts
// Boundary OUT: o texto de cada chave e a paridade do dicionário inteiro —
//   isso é `tests/i18n.test.ts`
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";

const DIRECTORY = new URL("../src/core/i18n/", import.meta.url);

type Fragment = Record<string, Record<string, string>>;

/** `<área>.<idioma>.ts` → área; `pt-BR.ts` e `en.ts` (a junção) não casam. */
function areasOf(locale: "pt-BR" | "en"): string[] {
  return readdirSync(DIRECTORY)
    .map((file) => file.match(new RegExp(`^(.+)\\.${locale}\\.ts$`))?.[1])
    .filter((area): area is string => area !== undefined)
    .sort();
}

async function load(area: string, locale: "pt-BR" | "en"): Promise<Fragment> {
  const module = (await import(`../src/core/i18n/${area}.${locale}.ts`)) as Record<string, Fragment>;
  const exported = Object.keys(module);
  if (exported.length !== 1) throw new Error(`${area}.${locale}.ts precisa exportar uma constante só, exporta ${exported.length}`);
  return module[exported[0]!]!;
}

function leaves(section: Record<string, string>, prefix: string): string[] {
  return Object.keys(section).map((key) => `${prefix}.${key}`);
}

const AREAS = areasOf("pt-BR");
const PT = new Map(await Promise.all(AREAS.map(async (area) => [area, await load(area, "pt-BR")] as const)));
const EN = new Map(await Promise.all(areasOf("en").map(async (area) => [area, await load(area, "en")] as const)));

describe("fragmentos do dicionário", () => {
  it("existem, e cada um tem o par no outro idioma", () => {
    expect(AREAS.length).toBeGreaterThan(0);
    expect(areasOf("en")).toEqual(AREAS);
  });

  it.each(AREAS)("%s: o inglês tem exatamente as seções e as chaves do português", (area) => {
    const pt = PT.get(area)!;
    const english = EN.get(area)!;
    expect(Object.keys(english).sort(), `seções de ${area}`).toEqual(Object.keys(pt).sort());
    for (const section of Object.keys(pt)) {
      expect(leaves(english[section]!, section).sort(), `chaves de ${area}/${section}`).toEqual(
        leaves(pt[section]!, section).sort(),
      );
    }
  });

  it("cada seção é definida por um fragmento só", () => {
    for (const fragments of [PT, EN]) {
      const owner = new Map<string, string>();
      for (const [area, fragment] of fragments) {
        for (const section of Object.keys(fragment)) {
          expect(owner.get(section), `a seção "${section}" está em ${owner.get(section)} e em ${area}`).toBeUndefined();
          owner.set(section, area);
        }
      }
    }
  });
});

describe("junção", () => {
  it.each(AREAS)("%s: pt-BR.ts e en.ts entregam o fragmento inteiro", (area) => {
    for (const [section, value] of Object.entries(PT.get(area)!)) {
      expect(ptBR[section as keyof typeof ptBR], `pt-BR.ts não junta ${area}.pt-BR.ts (${section})`).toBe(value);
    }
    for (const [section, value] of Object.entries(EN.get(area)!)) {
      expect(en[section as keyof typeof en], `en.ts não junta ${area}.en.ts (${section})`).toBe(value);
    }
  });

  it("não sobra seção na junção que nenhum fragmento tenha", () => {
    const owned = new Set([...PT.values()].flatMap((fragment) => Object.keys(fragment)));
    expect(Object.keys(ptBR).filter((section) => !owned.has(section))).toEqual([]);
    expect(Object.keys(en).filter((section) => !owned.has(section))).toEqual([]);
  });
});
