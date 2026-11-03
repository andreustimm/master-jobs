/**
 * Quem é a pessoa que voltou do Google ou do LinkedIn (#464, ADR-001).
 *
 * Puro: recebe o que o adapter validou e o que o banco sabe, devolve a decisão.
 * Quem consulta o banco e aplica a decisão é `app/oidc-login.ts` (regra 4).
 *
 * Três regras sustentam tudo aqui:
 *
 * 1. **A identidade é `(provider, subject)`, nunca o e-mail.** Uma vez ligada,
 *    entra por ela mesmo que o e-mail no provedor tenha mudado — e sem
 *    consultar o e-mail (US-001.AC-3).
 * 2. **Só e-mail VERIFICADO liga sozinho.** Ligar por e-mail que o provedor não
 *    verificou é o ataque clássico de tomada de conta por pré-sequestro: alguém
 *    cria no provedor uma conta com o e-mail da vítima e entra na conta dela
 *    aqui. Sem verificação, nada é criado nem ligado (US-003).
 * 3. **Recusa não revela cadastro.** Conta desabilitada recebe a mesma recusa
 *    neutra com ou sem vínculo, e "e-mail não verificado" é idêntico com ou sem
 *    conta para aquele endereço (US-003.AC-2) — por isso a verificação vem
 *    antes da consulta pelo e-mail.
 */
import type { OidcProviderId } from "./oidc-config.ts";

/** A mesma normalização do e-mail das contas: sem espaço nas pontas, minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** O que a decisão precisa saber da identidade. É o `VerifiedIdentity` da porta. */
export type ResolvableIdentity = {
  provider: OidcProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
};

export type IdentityDecision =
  /** A identidade já está ligada a uma conta habilitada. */
  | { kind: "signin"; userId: number }
  /** E-mail verificado igual ao de uma conta habilitada sem este provedor: liga e entra. */
  | { kind: "auto_link"; userId: number }
  /** A conta do e-mail já tem OUTRA identidade deste provedor (US-002.EC-1). */
  | { kind: "conflict"; provider: OidcProviderId }
  /** Conta desabilitada, ligada ou pelo e-mail. Neutra: não diz qual. */
  | { kind: "refused" }
  /** E-mail verificado sem conta: segue para o cadastro (US-004). */
  | { kind: "signup"; email: string }
  /** Sem e-mail verificado e sem vínculo: orientação, nada criado (US-003). */
  | { kind: "unverified"; provider: OidcProviderId };

export function resolveIdentity(input: {
  identity: ResolvableIdentity;
  /** A conta ligada a `(provider, subject)`, se houver. */
  linkedUser: { id: number; disabled: boolean } | null;
  /** A conta cujo e-mail normalizado é igual ao do provedor, se houver. */
  emailUser: { id: number; disabled: boolean; hasProvider: boolean } | null;
}): IdentityDecision {
  const { identity, linkedUser, emailUser } = input;

  // Regra 1: ligada decide sozinha. O e-mail nem é olhado.
  if (linkedUser !== null) {
    return linkedUser.disabled ? { kind: "refused" } : { kind: "signin", userId: linkedUser.id };
  }

  // Regra 3: antes de olhar a conta do e-mail. Assim a resposta é a mesma
  // exista ou não uma conta com esse endereço.
  const email = identity.email === null ? "" : normalizeEmail(identity.email);
  if (!identity.emailVerified || email === "") {
    return { kind: "unverified", provider: identity.provider };
  }

  if (emailUser === null) return { kind: "signup", email };
  // Desabilitada vence o conflito: a recusa neutra não conta que há vínculo.
  if (emailUser.disabled) return { kind: "refused" };
  if (emailUser.hasProvider) return { kind: "conflict", provider: identity.provider };
  return { kind: "auto_link", userId: emailUser.id };
}

export type ManualLinkDecision =
  | { kind: "link"; userId: number }
  /** A identidade já é de OUTRA conta (US-007.EC-1). */
  | { kind: "taken" }
  /** Esta conta já tem este provedor — a mesma identidade ou outra (US-007.EC-2). */
  | { kind: "already_linked" }
  /** Sem sessão própria: expirou no consentimento, ou é sessão emprestada (G24). */
  | { kind: "session_required" };

/**
 * Ligar pela página da conta (US-007).
 *
 * Aceita qualquer e-mail, verificado ou não: quem prova a posse da conta aqui é
 * a sessão, não o provedor. Por isso a sessão precisa ser da própria pessoa —
 * sessão emprestada por um admin nunca liga (G24): seria o admin dando a si
 * mesmo uma porta permanente na conta alheia.
 */
export function decideManualLink(input: {
  sessionUser: { id: number; impersonated: boolean } | null;
  /** A conta a que `(provider, subject)` já está ligada, se alguma. */
  linkedUserId: number | null;
  /** A conta da sessão já tem uma identidade deste provedor. */
  sessionHasProvider: boolean;
}): ManualLinkDecision {
  const { sessionUser, linkedUserId, sessionHasProvider } = input;
  if (sessionUser === null || sessionUser.impersonated) return { kind: "session_required" };
  if (linkedUserId !== null) {
    return linkedUserId === sessionUser.id ? { kind: "already_linked" } : { kind: "taken" };
  }
  if (sessionHasProvider) return { kind: "already_linked" };
  return { kind: "link", userId: sessionUser.id };
}
