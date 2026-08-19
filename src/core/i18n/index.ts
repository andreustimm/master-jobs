/**
 * Tradução.
 *
 * Um objeto por idioma, tipado contra o português. Sem biblioteca: o que este
 * projeto precisa é procurar uma string por chave, e uma dependência de i18n
 * traria carregamento assíncrono, contexto de React e formatação ICU que
 * ninguém aqui usa.
 *
 * Interpolação existe (`{count}`) porque frase montada por concatenação não
 * traduz — a ordem das palavras muda entre idiomas, e "1.504 correspondem" não
 * é "1.504 match" com as partes trocadas de lugar.
 */
import { en } from "./en.ts";
import { ptBR, type Dictionary } from "./pt-BR.ts";
import { DEFAULT_LOCALE, type LocaleId } from "./locales.ts";

export * from "./locales.ts";
export type { Dictionary } from "./pt-BR.ts";

const DICTIONARIES: Record<LocaleId, Dictionary> = {
  "pt-BR": ptBR as Dictionary,
  en,
};

export function dictionary(locale: LocaleId = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export type Translator = {
  readonly locale: LocaleId;
  /** `t("nav.jobs")`, com interpolação opcional de `{chave}`. */
  t(path: string, values?: Record<string, string | number>): string;
  /** O dicionário inteiro, para quem prefere acesso tipado. */
  readonly d: Dictionary;
};

export function translator(locale: LocaleId = DEFAULT_LOCALE): Translator {
  const d = dictionary(locale);

  return {
    locale,
    d,
    t(path, values) {
      const parts = path.split(".");
      let current: unknown = d;
      for (const part of parts) {
        current = (current as Record<string, unknown>)?.[part];
      }

      // Devolve a chave quando a tradução não existe. É feio de propósito:
      // um espaço em branco passa despercebido, `nav.missing` na tela não.
      if (typeof current !== "string") return path;

      if (!values) return current;
      return current.replace(/\{(\w+)\}/g, (match, key: string) =>
        key in values ? String(values[key]) : match,
      );
    },
  };
}

/** Número no formato do idioma — 1.504 em pt-BR, 1,504 em en. */
export function formatNumber(value: number, locale: LocaleId): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Data curta no formato do idioma. */
export function formatDate(iso: string, locale: LocaleId): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
