/**
 * Formas de entrar na conta: listar, desligar provedor e definir a primeira
 * senha (#464, US-008–US-013, US-019, ADR-004).
 *
 * Orquestra; não decide. A decisão de "pode desligar" é
 * `domain/methods.ts#canDisconnect`, reconferida pelo store dentro da
 * transação com a linha da conta travada. Tudo de fora entra por
 * `MethodsDeps`, montado em `index.ts` (regra 4).
 *
 * **Ligar provedor não mora aqui.** Ligar exige o navegador da dona da conta
 * passando pelo provedor (`intent=link` em `oidc-login.ts`); nem o admin nem a
 * CLI têm caminho para isso (US-011.AC-3, US-013.EC-3).
 */
import { DEFAULT_LOCALE, isLocale, type LocaleId } from "../../../core/i18n/index.ts";
import {
  methodsView,
  type AccountMethodsRecord,
  type MethodsView,
  type UnlinkOutcome,
} from "../domain/methods.ts";
import type { OidcProviderId } from "../domain/oidc-config.ts";
import { checkPassword } from "../domain/password.ts";
import type { Mailer } from "../ports-mailer.ts";
import type { AuthRepository } from "../ports.ts";
import { providerNoticeEmail, type ProviderActor } from "./account-emails.ts";

export type MethodsDeps = {
  store: {
    accountMethods(userId: number): Promise<AccountMethodsRecord | null>;
    unlinkIdentityChecked(userId: number, provider: OidcProviderId): Promise<UnlinkOutcome>;
    setFirstPassword(userId: number, hash: string): Promise<boolean>;
  };
  repository: AuthRepository;
  mailer(): Mailer;
  hashPassword(password: string): Promise<string>;
  /** Provedores que este ambiente oferece (`availableProviders`). */
  available(): readonly OidcProviderId[];
  now(): Date;
};

/* --------------------------------- Listar --------------------------------- */

export type AccountAccess = {
  methods: MethodsView;
  terms: AccountMethodsRecord["terms"];
};

/** A lista de métodos da conta (US-010) e as versões dos termos aceitas (US-021.AC-3). */
export async function listMethods(userId: number, deps: Pick<MethodsDeps, "store" | "available">): Promise<AccountAccess | null> {
  const record = await deps.store.accountMethods(userId);
  if (record === null) return null;
  return {
    methods: methodsView({ hasPassword: record.hasPassword, identities: record.identities }, deps.available()),
    terms: record.terms,
  };
}

/* -------------------------------- Desligar -------------------------------- */

/**
 * Quem desligou. `admin` leva o e-mail de quem fez, para a auditoria nomear a
 * pessoa (US-011.AC-2); o aviso à dona da conta diz só "um administrador".
 */
export type DisconnectActor =
  | { by: "self" }
  | { by: "admin"; adminUserId: number; adminEmail: string }
  | { by: "cli" };

export type DisconnectError = Exclude<UnlinkOutcome, "unlinked">;
export type DisconnectResult = { ok: true } | { ok: false; error: DisconnectError };

function actorDetail(actor: DisconnectActor): string {
  if (actor.by === "admin") return `admin ${actor.adminEmail} (#${actor.adminUserId})`;
  return actor.by;
}

/**
 * Desliga `provider` da conta `userId`, com a proteção do último método.
 *
 * Quem chama já decidiu que pode (sessão própria, admin ou operador da CLI);
 * esta função não conhece sessão. Recusa não grava nada nem manda e-mail.
 */
export async function disconnectProvider(
  input: { userId: number; provider: OidcProviderId; actor: DisconnectActor },
  deps: MethodsDeps,
): Promise<DisconnectResult> {
  const outcome = await deps.store.unlinkIdentityChecked(input.userId, input.provider);
  if (outcome !== "unlinked") return { ok: false, error: outcome };

  const contact = await deps.store.accountMethods(input.userId);
  await deps.repository.record({
    kind: "identity_unlinked",
    userId: input.userId,
    email: contact?.email ?? null,
    detail: `${input.provider}: ${actorDetail(input.actor)}`,
  });
  await sendProviderNotice(
    { userId: input.userId, provider: input.provider, action: "unlinked", by: input.actor.by },
    {
      contact: async () => (contact === null ? null : { email: contact.email, locale: contact.locale }),
      mailer: deps.mailer,
      repository: deps.repository,
      now: deps.now,
    },
  );
  return { ok: true };
}

/* ----------------------------- Primeira senha ----------------------------- */

export type FirstPasswordResult = { ok: true } | { ok: false; error: "weak_password" | "has_password" };

/**
 * Primeira senha de uma conta que só entra por provedor (US-009).
 *
 * As regras são as de sempre (`checkPassword`, mínimo de 12), conferidas
 * antes de qualquer escrita. Conta que já tem senha recusa: trocar exige
 * provar a atual, e é outro caminho. Nenhuma sessão cai (US-009.EC-2).
 */
export async function setFirstPassword(
  input: { userId: number; email: string; password: string },
  deps: Pick<MethodsDeps, "store" | "repository" | "hashPassword">,
): Promise<FirstPasswordResult> {
  if (!checkPassword(input.password).ok) return { ok: false, error: "weak_password" };
  const hash = await deps.hashPassword(input.password);
  if (!(await deps.store.setFirstPassword(input.userId, hash))) return { ok: false, error: "has_password" };
  await deps.repository.record({
    kind: "password_set",
    userId: input.userId,
    email: input.email,
    detail: "primeira senha definida pela própria conta; sessões mantidas",
  });
  return { ok: true };
}

/* ---------------------------------- Aviso --------------------------------- */

export type NoticeDeps = {
  contact(userId: number): Promise<{ email: string; locale: string | null } | null>;
  mailer(): Mailer;
  repository: AuthRepository;
  now(): Date;
};

/**
 * Aviso de provedor ligado ou desligado (US-019), no idioma da conta.
 *
 * Falha de envio não desfaz a mudança: fica registrada como
 * `email_send_failed` com o tipo da mensagem (ADR-011, US-019.EC-1).
 */
export async function sendProviderNotice(
  input: { userId: number; provider: OidcProviderId; action: "linked" | "unlinked"; by: ProviderActor },
  deps: NoticeDeps,
): Promise<void> {
  const contact = await deps.contact(input.userId);
  if (contact === null) return;
  const locale: LocaleId = isLocale(contact.locale ?? undefined) ? (contact.locale as LocaleId) : DEFAULT_LOCALE;
  const mail = providerNoticeEmail({
    locale,
    provider: input.provider,
    action: input.action,
    by: input.by,
    at: deps.now().toISOString(),
  });
  const result = await deps.mailer().send({ to: contact.email, subject: mail.subject, text: mail.text });
  if (!result.ok) {
    await deps.repository.record({
      kind: "email_send_failed",
      userId: input.userId,
      detail: input.action === "linked" ? "provider_linked" : "provider_unlinked",
    });
  }
}
