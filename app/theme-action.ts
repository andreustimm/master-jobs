"use server";

import { cookies } from "next/headers";
import { MODE_COOKIE, resolveMode, resolveTheme, THEME_COOKIE } from "../src/core/theme.ts";

/**
 * Persiste tema e ambiente.
 *
 * Cookie, não localStorage, porque o servidor precisa dos dois para renderizar
 * os atributos certos no primeiro byte. Resolver no cliente produz o flash de
 * tema errado que todo site com modo escuro tem quando escolhe o caminho fácil.
 *
 * Sem guard: preferência de interface não lê nem escreve dado de ninguém, e
 * exigir sessão impediria trocar o tema na própria tela de login.
 */
export async function setAppearanceAction(theme: string, mode: string) {
  const jar = await cookies();
  const options = {
    path: "/",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 365,
    // Legível por script de propósito: é preferência, não segredo.
    httpOnly: false,
  };
  jar.set(THEME_COOKIE, resolveTheme(theme), options);
  jar.set(MODE_COOKIE, resolveMode(mode), options);
}
