import { cookies, headers } from "next/headers";
import {
  LOCALE_COOKIE,
  isLocale,
  negotiateLocale,
  translator,
  type LocaleId,
  type Translator,
} from "../src/core/i18n/index.ts";

/**
 * O tradutor da requisição.
 *
 * Toda página chama isto em vez de escrever texto direto. Uma string literal
 * numa página é uma tradução que nunca vai existir — e não aparece em nenhuma
 * busca por chave, então some do radar.
 *
 * Ordem: escolha gravada, depois `Accept-Language`. Ignorar o cabeçalho
 * significaria servir português a quem já disse ao navegador que prefere
 * inglês.
 */
export async function getTranslator(): Promise<Translator> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return translator(saved);
  return translator(negotiateLocale((await headers()).get("accept-language")));
}

export async function getLocale(): Promise<LocaleId> {
  return (await getTranslator()).locale;
}
