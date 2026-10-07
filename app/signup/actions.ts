"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  SIGNUP_COOKIE,
  beginManualSignup,
  confirmManualSignupCode,
  finishSocialSignup,
  resendManualSignupCode,
  type SignupError,
} from "../../src/contexts/auth/index.ts";
import { clientKey, createRateLimiter } from "../../src/core/rate-limit.ts";
import { SESSION_COOKIE } from "../auth";
import { getLocale } from "../i18n";
import { scoreAfterResponse } from "../score-queue-drain";

/**
 * O cadastro aberto (#464, ADR-007): as quatro entradas públicas da tela.
 *
 * **Sem `guard`, por desenho** — quem se cadastra ainda não tem sessão. Estão
 * registradas em `UNGUARDED_BY_DESIGN` com o que substitui a permissão: o
 * cookie do cadastro (token de 32 bytes, só o hash no banco), o código de uso
 * único com cinco tentativas, os limites por e-mail e por IP, e o papel que
 * nunca é admin. Nenhuma recebe id de conta ou de candidato: a conta nasce da
 * pendência, e o candidato é sempre uma linha nova (regra 15, G25).
 */

/** O que a tela recebe de volta numa recusa. A mensagem é montada lá, no idioma dela. */
export type SignupActionResult = {
  ok: false;
  code: SignupError | "rate_limited";
  attemptsLeft?: number;
  retryInSeconds?: number;
};

/**
 * Teto de envios do formulário manual por IP, por instância. O formulário roda
 * scrypt e extrai PDF antes de qualquer limite do banco: sem este teto, um
 * laço de requisições sem sessão viraria custo de CPU e memória à vontade.
 */
const startLimiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000 });

const SIGNUP_COOKIE_PATH = "/signup";

async function requestContext() {
  const requestHeaders = await headers();
  return {
    clientIp: clientKey(requestHeaders),
    locale: await getLocale(),
    request: {
      host: requestHeaders.get("host"),
      proto: process.env.NODE_ENV === "production" ? ("https" as const) : ("http" as const),
    },
  };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function profileFields(formData: FormData) {
  return {
    role: formData.get("role"),
    name: text(formData, "name"),
    headline: text(formData, "headline"),
    cvPasted: text(formData, "cv"),
    cvFile: formData.get("cvFile"),
    termsAccepted: formData.get("terms") === "on",
  };
}

/** Grava a sessão nova e encerra a pendência deste navegador. */
async function enter(signedIn: {
  token: string;
  expiresAt: string;
  location: string;
  candidateId: number | null;
}): Promise<never> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signedIn.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(signedIn.expiresAt),
  });
  jar.delete({ name: SIGNUP_COOKIE, path: SIGNUP_COOKIE_PATH });
  // Currículo novo, nota nova: a fatia roda depois da resposta (#280).
  if (signedIn.candidateId !== null) scoreAfterResponse(signedIn.candidateId);
  revalidatePath("/", "layout");
  redirect(signedIn.location as Route);
}

/** Formulário manual: valida, grava a pendência e manda o código (US-016). */
export async function startManualSignup(formData: FormData): Promise<SignupActionResult> {
  const context = await requestContext();
  if (!startLimiter.check(context.clientIp).allowed) return { ok: false, code: "rate_limited" };

  const result = await beginManualSignup(
    {
      ...profileFields(formData),
      email: text(formData, "email"),
      password: text(formData, "password"),
      locale: context.locale,
      clientIp: context.clientIp,
    },
    context.request,
  );
  if (!result.ok) return { ok: false, code: result.error };

  if (result.value.token !== null) {
    (await cookies()).set(SIGNUP_COOKIE, result.value.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: SIGNUP_COOKIE_PATH,
      maxAge: 24 * 60 * 60,
    });
  }
  redirect("/signup/verify");
}

/** Envio da tela no modo social: cria a conta e entra (US-004, US-005). */
export async function completeSocialSignup(formData: FormData): Promise<SignupActionResult> {
  const context = await requestContext();
  const result = await finishSocialSignup(
    {
      ...profileFields(formData),
      token: (await cookies()).get(SIGNUP_COOKIE)?.value ?? null,
      locale: context.locale,
      clientIp: context.clientIp,
    },
    context.request,
  );
  if (!result.ok) return { ok: false, code: result.error };
  return enter(result.value);
}

/** O código do e-mail: cria a conta e entra (US-017). */
export async function confirmSignupCode(formData: FormData): Promise<SignupActionResult> {
  const context = await requestContext();
  const result = await confirmManualSignupCode(
    {
      token: (await cookies()).get(SIGNUP_COOKIE)?.value ?? null,
      code: text(formData, "code"),
      clientIp: context.clientIp,
    },
    context.request,
  );
  if (!result.ok) {
    return { ok: false, code: result.error, attemptsLeft: result.attemptsLeft, retryInSeconds: result.retryInSeconds };
  }
  return enter(result.value);
}

/** "Reenviar código" (US-017.EC-8). */
export async function resendSignupCode(): Promise<SignupActionResult | { ok: true }> {
  const context = await requestContext();
  const result = await resendManualSignupCode((await cookies()).get(SIGNUP_COOKIE)?.value ?? null, context.request);
  if (!result.ok) return { ok: false, code: result.error, retryInSeconds: result.retryInSeconds };
  return { ok: true };
}
