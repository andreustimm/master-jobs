import { cookies, headers } from "next/headers";
import {
  INVITE_COOKIE,
  recruiterLandingAfterSignIn,
  type Session,
} from "../src/contexts/auth/index.ts";

/**
 * O convite que atravessa o cadastro e o login (#465, ADR-018).
 *
 * O token cru mora só no cookie `jho_invite`, `httpOnly` e `SameSite=Lax`: a
 * ida ao Google ou ao LinkedIn volta por navegação de topo, que leva cookie
 * `Lax`, e nenhum script da página o lê. Quem o lê é o servidor, no fim do
 * cadastro e depois de todo login; a leitura o apaga, porque ele vale uma
 * conclusão só. O token nunca vai para log.
 */

export const INVITE_COOKIE_PATH = "/";

/** O token do cookie desta requisição, sem apagar (a tela de cadastro só mostra a linha "Convidado por"). */
export async function inviteCookieToken(): Promise<string | null> {
  return (await cookies()).get(INVITE_COOKIE)?.value ?? null;
}

/** Lê e apaga o cookie: quem chama conclui o convite agora, e ele não serve duas vezes. */
export async function takeInviteCookie(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(INVITE_COOKIE)?.value ?? null;
  if (token !== null) jar.delete({ name: INVITE_COOKIE, path: INVITE_COOKIE_PATH });
  return token;
}

/** Origem da requisição para os links do e-mail, como as outras actions (G17). */
export async function requestOrigin(): Promise<{ host: string | null; proto: "http" | "https" }> {
  return {
    host: (await headers()).get("host"),
    proto: process.env.NODE_ENV === "production" ? "https" : "http",
  };
}

/**
 * Depois de todo login bem-sucedido (senha, link mágico, provedor): conclui
 * os convites da conta de recrutador e devolve o destino — a página do
 * candidato, o aviso em `/recruiter` ou `fallback`.
 */
export async function landingAfterSignIn(session: Session, fallback: string): Promise<string> {
  const token = await takeInviteCookie();
  return recruiterLandingAfterSignIn(session, token, fallback, await requestOrigin());
}
