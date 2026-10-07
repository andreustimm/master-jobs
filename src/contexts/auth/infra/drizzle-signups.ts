/**
 * Cadastro pendente em `auth_signup` (#464, ADR-009).
 *
 * Esta parte grava só a pendência social: o provedor verificou o e-mail, não
 * há conta com ele, e a pessoa vai para `/signup` escolher papel e mandar o
 * currículo (US-004). Nada aqui cria conta, vínculo ou sessão; a conclusão é do
 * serviço de cadastro.
 *
 * O cookie leva um token aleatório de 32 bytes; a tabela guarda só o SHA-256
 * dele, como sessão e link mágico. O IP chega já em HMAC (`signupIpHmac`).
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { getDb } from "../../../core/db/client.ts";
import { authSignup } from "../../../core/db/schema.ts";
import type { OidcProviderId } from "../domain/oidc-config.ts";

/** Validade da pendência social, do consentimento ao envio do formulário (PRD). */
export const SOCIAL_SIGNUP_MINUTES = 15;

/** Cookie do cadastro pendente. Escopo `/signup`: só a tela e as ações dela o leem. */
export const SIGNUP_COOKIE = "jho_signup";

export function signupTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * HMAC-SHA256 do IP do cliente com `JHO_SIGNUP_IP_SECRET` (ADR-009).
 *
 * O IP cru nunca é gravado: o HMAC basta para contar cadastros por endereço, e
 * sem a chave não se volta ao IP — nem testando os quatro bilhões de IPv4,
 * que é o que um hash sem chave permitiria.
 */
export function signupIpHmac(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export async function createSocialSignup(input: {
  email: string;
  provider: OidcProviderId;
  subject: string;
  locale: string;
  ipHmac: string;
  now: Date;
}): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + SOCIAL_SIGNUP_MINUTES * 60_000).toISOString();
  await getDb().insert(authSignup).values({
    kind: "social",
    tokenHash: signupTokenHash(token),
    email: input.email,
    locale: input.locale,
    provider: input.provider,
    subject: input.subject,
    ipHmac: input.ipHmac,
    createdAt: input.now.toISOString(),
    expiresAt,
  });
  return { token, expiresAt };
}
