/**
 * Idiomas suportados.
 *
 * Português é o padrão porque é o idioma do usuário e de toda a interface
 * escrita até aqui. Inglês existe porque o material de candidatura é em inglês
 * e porque, se isto virar produto, o mercado-alvo é internacional.
 */
export const LOCALES = [
  /**
   * `flag` é emoji, não imagem: nenhuma requisição, escala com a fonte, e
   * funciona em qualquer tema sem precisar de duas versões.
   *
   * A bandeira representa a VARIANTE do idioma, não o idioma — daí a dos EUA
   * para `en`, que é a variante escrita nos dicionários. Bandeira para idioma
   * é impreciso por natureza (o inglês não é dos EUA, o português não é do
   * Brasil), então ela vem acompanhada do nome escrito, que é o que de fato
   * identifica a opção.
   */
  { id: "pt-BR", label: "Português", short: "PT", flag: "🇧🇷" },
  { id: "en", label: "English", short: "EN", flag: "🇺🇸" },
] as const;

export type LocaleId = (typeof LOCALES)[number]["id"];

export const DEFAULT_LOCALE: LocaleId = "pt-BR";
export const LOCALE_COOKIE = "jho_locale";

export function isLocale(value: string | undefined): value is LocaleId {
  return LOCALES.some((l) => l.id === value);
}

export function resolveLocale(value: string | undefined): LocaleId {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Escolhe um idioma a partir do cabeçalho `Accept-Language`.
 *
 * Usado só quando não há escolha gravada. Compara pela raiz (`pt` casa com
 * `pt-PT` e `pt-BR`), porque recusar português de Portugal e cair no inglês
 * seria pior que servir a variante brasileira.
 */
export function negotiateLocale(header: string | null | undefined): LocaleId {
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: (tag ?? "").trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((entry) => entry.tag && Number.isFinite(entry.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const exact = LOCALES.find((l) => l.id.toLowerCase() === tag);
    if (exact) return exact.id;
    const root = tag.split("-")[0];
    const byRoot = LOCALES.find((l) => l.id.toLowerCase().split("-")[0] === root);
    if (byRoot) return byRoot.id;
  }
  return DEFAULT_LOCALE;
}
