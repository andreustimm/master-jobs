/**
 * O cookie do fluxo OIDC: cifrado, autenticado e com validade (#464, ADR-012).
 *
 * Guarda `state`, `nonce`, o verificador PKCE, a intenção e o `next` entre o
 * início e o retorno do provedor. AES-256-GCM: a cifra esconde o verificador
 * (que troca o código por token) e a etiqueta de autenticação recusa qualquer
 * byte alterado — inclusive um `next` trocado à mão.
 *
 * A chave sai de `JHO_SESSION_SECRET` por HKDF-SHA256 com rótulo próprio, para
 * que a mesma variável possa servir a outro uso no futuro sem que uma chave
 * derivada decifre o que é da outra.
 *
 * Funções sem estado: a chave e o relógio entram por parâmetro, para o teste
 * provar validade e adulteração sem esperar dez minutos.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { isOidcProvider } from "../domain/oidc-config.ts";
import type { OidcFlowState } from "../ports.ts";

/** Validade do fluxo: do clique em "Continuar com…" até o retorno do provedor. */
export const FLOW_TTL_MS = 10 * 60_000;

/** Nome do cookie do fluxo. Escopo e atributos ficam com a rota que o grava. */
export const FLOW_COOKIE = "jho_oidc_flow";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Dado associado: um texto cifrado de outro propósito não abre aqui. */
const AAD = Buffer.from("master-jobs/oidc-flow/v1");
const HKDF_INFO = "master-jobs/oidc-flow/v1";

/** A chave de 32 bytes do cookie, derivada do segredo configurado. */
export function flowKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), HKDF_INFO, 32));
}

/** `iv ‖ texto cifrado ‖ etiqueta`, em base64url — cabe num cookie sem escape. */
export function sealFlow(state: OidcFlowState, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

function isFlowState(value: unknown): value is OidcFlowState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isOidcProvider(typeof v.provider === "string" ? v.provider : null) &&
    typeof v.state === "string" && v.state.length > 0 &&
    typeof v.nonce === "string" && v.nonce.length > 0 &&
    typeof v.codeVerifier === "string" && v.codeVerifier.length > 0 &&
    (v.intent === "signin" || v.intent === "link") &&
    (v.next === null || typeof v.next === "string") &&
    typeof v.createdAt === "string"
  );
}

/**
 * Abre o cookie. `null` para adulterado, de outra chave, malformado ou vencido.
 *
 * Não distingue os motivos: para quem chama, todos viram "esta tentativa
 * expirou" (US-001.EC-4), e cada distinção a mais é pista para quem forja.
 * Validade inclusiva: exatamente 10 minutos ainda vale; um segundo depois, não.
 */
export function openFlow(sealed: string | null | undefined, key: Buffer, now: Date): OidcFlowState | null {
  if (!sealed) return null;
  let raw: Buffer;
  try {
    raw = Buffer.from(sealed, "base64url");
  } catch {
    return null;
  }
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  let state: unknown;
  try {
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    state = JSON.parse(plain);
  } catch {
    return null;
  }
  if (!isFlowState(state)) return null;
  const created = Date.parse(state.createdAt);
  if (Number.isNaN(created)) return null;
  const age = now.getTime() - created;
  // Criado "no futuro" além de um minuto de folga de relógio entre instâncias
  // não é fluxo nosso; o cookie autenticado torna isso improvável, não impossível.
  if (age > FLOW_TTL_MS || age < -60_000) return null;
  return state;
}

export type FlowCheck = { ok: true; flow: OidcFlowState } | { ok: false; reason: "expired" };

/**
 * Confere o `state` do retorno contra o do cookie (US-001.EC-4, EC-5).
 *
 * Sem cookie, ou com `state` diferente — outra aba, retorno repetido, ataque
 * de CSRF no login —, a resposta é a mesma: "esta tentativa expirou".
 * Comparação em tempo constante, porque o `state` é segredo do fluxo.
 */
export function checkCallbackState(flow: OidcFlowState | null, callbackState: string | null | undefined): FlowCheck {
  if (flow === null || !callbackState) return { ok: false, reason: "expired" };
  const expected = Buffer.from(flow.state, "utf8");
  const received = Buffer.from(callbackState, "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, flow };
}
