import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODES,
  MODE_COOKIE,
  THEMES,
  THEME_COOKIE,
  isMode,
  isTheme,
  modeAttribute,
  resolveMode,
  resolveTheme,
  type ModeId,
  type ThemeId,
} from "../src/core/theme.ts";

/**
 * O registro de temas é o contrato entre `app/themes.css` e a UI inteira.
 * Ele nunca é chamado com valor confiável: tema e ambiente chegam por cookie,
 * e cookie é entrada do usuário. Todo caso abaixo existe porque um valor
 * inesperado aqui ou apaga a página, ou faz um dos três temas ficar errado.
 */
describe("registro de temas (regra 10 do CLAUDE.md)", () => {
  it("declara exatamente os três temas que têm bloco em themes.css", () => {
    // Tema sem bloco CSS renderiza sem paleta; bloco CSS sem entrada aqui é
    // código morto. A lista é a única fonte que as duas pontas compartilham.
    expect(THEMES.map((t) => t.id)).toEqual(["hp", "huly", "graphy"]);
  });

  it("guarda CHAVE de tradução em `description`, nunca a frase pronta", () => {
    // Foi assim que "Dois acentos, geometria de pílula" ficou na interface em
    // inglês: texto dentro de constante não aparece em busca por string no JSX
    // e sobrevive a uma revisão de tradução inteira. O formato `a.b` é o sinal
    // de que o valor ainda é chave.
    for (const tema of THEMES) {
      expect(tema.description).toMatch(/^themeDescriptions\.[a-z]+$/);
      expect(tema.description).toBe(`themeDescriptions.${tema.id}`);
    }
  });

  it("mantém `label` como nome próprio, que não se traduz", () => {
    // HP, Huly e Graphy são nomes de produto. Passar isso pelo dicionário
    // produziria "HP" traduzido, que não existe.
    expect(THEMES.map((t) => t.label)).toEqual(["HP", "Huly", "Graphy"]);
  });

  it("expõe os três ambientes com rótulo em forma de chave", () => {
    expect(MODES.map((m) => m.id)).toEqual(["system", "light", "dark"]);
    for (const modo of MODES) expect(modo.label).toBe(`theme.${modo.id}`);
  });

  it("usa nomes de cookie distintos para os dois eixos", () => {
    // Tema e ambiente são independentes por desenho — escuro não é inversão de
    // claro. Um cookie só forçaria a duplicar a identidade a cada modo.
    expect(THEME_COOKIE).not.toBe(MODE_COOKIE);
    expect([THEME_COOKIE, MODE_COOKIE]).toEqual(["jho_theme", "jho_mode"]);
  });

  it("tem padrões que são membros válidos das próprias listas", () => {
    // Um padrão fora da lista faria toda página cair no fallback de si mesma.
    expect(isTheme(DEFAULT_THEME)).toBe(true);
    expect(isMode(DEFAULT_MODE)).toBe(true);
    expect(DEFAULT_MODE).toBe("system");
  });
});

describe("validação de cookie: entrada desconhecida cai no padrão", () => {
  it("reconhece os valores legítimos e recusa o resto", () => {
    expect(isTheme("graphy")).toBe(true);
    expect(isTheme("dracula")).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isMode("dark")).toBe(true);
    expect(isMode("escuro")).toBe(false);
    expect(isMode(undefined)).toBe(false);
  });

  it("degrada para o padrão em vez de quebrar a página", () => {
    // Cookie é entrada do usuário: pode estar velho (tema removido), vir de
    // outra instalação, ou ter sido editado à mão. Nenhum desses casos pode
    // resultar em página sem paleta.
    expect(resolveTheme("huly")).toBe("huly");
    expect(resolveTheme("tema-que-nao-existe")).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
    expect(resolveTheme("")).toBe(DEFAULT_THEME);

    expect(resolveMode("light")).toBe("light");
    expect(resolveMode("SYSTEM")).toBe(DEFAULT_MODE);
    expect(resolveMode(undefined)).toBe(DEFAULT_MODE);
  });

  it("resolve todo tema e todo ambiente declarado para ele mesmo", () => {
    // Round-trip: o valor que a UI grava no cookie tem que voltar intacto.
    for (const tema of THEMES) expect(resolveTheme(tema.id)).toBe(tema.id as ThemeId);
    for (const modo of MODES) expect(resolveMode(modo.id)).toBe(modo.id as ModeId);
  });
});

describe("modeAttribute: `system` é ausência de atributo, não um valor", () => {
  it("devolve undefined em `system` para a media query poder mandar", () => {
    // Escrever `data-mode="system"` no elemento faria os seletores de escolha
    // explícita casarem por engano, e o modo do sistema operacional deixaria
    // de ser respeitado — que é justamente o que `system` significa.
    expect(modeAttribute("system")).toBeUndefined();
  });

  it("devolve o valor literal quando a escolha foi explícita", () => {
    expect(modeAttribute("light")).toBe("light");
    expect(modeAttribute("dark")).toBe("dark");
  });
});
