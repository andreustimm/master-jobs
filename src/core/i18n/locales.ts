/**
 * Idiomas suportados.
 *
 * Português é o padrão porque é o idioma do usuário e de toda a interface
 * escrita até aqui. Inglês existe porque o material de candidatura é em inglês
 * e porque, se isto virar produto, o mercado-alvo é internacional.
 */
export const LOCALES = [
  { id: "pt-BR", label: "Português", short: "PT" },
  { id: "en", label: "English", short: "EN" },
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
