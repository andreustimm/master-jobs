"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "../src/core/i18n/index.ts";

/**
 * Persiste o idioma.
 *
 * Cookie, pelo mesmo motivo do tema: o servidor precisa dele para renderizar o
 * texto certo no primeiro byte, e também para pôr o `lang` correto no `<html>`
 * — que é o que leitor de tela e corretor ortográfico consultam.
 *
 * Sem guard: preferência de interface não lê dado de ninguém, e exigir sessão
 * impediria trocar o idioma na tela de login, que é onde alguém que não fala
 * português mais precisa.
 */
export async function setLocaleAction(value: string) {
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, resolveLocale(value), {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: false,
  });
}
