/**
 * Temas e ambientes.
 *
 * Dois eixos independentes:
 *
 *   tema     identidade visual — paleta, geometria, tracking
 *   ambiente luminosidade — claro, escuro, ou o que o sistema disser
 *
 * Separados porque escuro não é uma inversão de claro: é outra paleta com as
 * mesmas decisões de contraste a tomar. Tratar ambiente como propriedade do
 * tema obrigaria a duplicar a identidade a cada modo.
 *
 * Acrescentar um tema é uma entrada em `THEMES` mais um bloco em
 * `app/themes.css`. Nada em `components/` muda, porque nenhum componente
 * conhece tema — todos leem token semântico.
 */
export const THEMES = [
  {
    id: "hp",
    label: "HP",
    description: "Azul corporativo, cantos discretos",
  },
  {
    id: "huly",
    label: "Huly",
    description: "Dois acentos, geometria de pílula",
  },
  {
    id: "graphy",
    label: "Graphy",
    description: "Cobalto, hairline no lugar de sombra",
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/**
 * `system` é ausência de escolha, e por isso é o padrão.
 *
 * Ele não vira um `data-mode` no HTML: a `prefers-color-scheme` do CSS decide.
 * Escrever `data-mode="system"` no elemento faria os seletores de escolha
 * explícita casarem por engano.
 */
export const MODES = [
  { id: "system", label: "Sistema" },
  { id: "light", label: "Claro" },
  { id: "dark", label: "Escuro" },
] as const;

export type ModeId = (typeof MODES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "hp";
export const DEFAULT_MODE: ModeId = "system";

export const THEME_COOKIE = "jho_theme";
export const MODE_COOKIE = "jho_mode";

export function isTheme(value: string | undefined): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function isMode(value: string | undefined): value is ModeId {
  return MODES.some((m) => m.id === value);
}

/** Entrada desconhecida cai no padrão, nunca quebra a página. */
export function resolveTheme(value: string | undefined): ThemeId {
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function resolveMode(value: string | undefined): ModeId {
  return isMode(value) ? value : DEFAULT_MODE;
}

/**
 * O valor do atributo `data-mode`, ou undefined em `system`.
 *
 * Em `system` o atributo tem que estar AUSENTE para a media query mandar.
 */
export function modeAttribute(mode: ModeId): "light" | "dark" | undefined {
  return mode === "system" ? undefined : mode;
}
