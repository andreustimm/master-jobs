/**
 * Os e-mails da conta, no idioma de quem recebe (#464, ADR-011).
 *
 * Uma função pura por mensagem: recebe o idioma e só o que a mensagem precisa,
 * devolve `{ subject, text }`. O destinatário fica com quem chama, que é quem
 * sabe o endereço da conta. Todo texto vem do dicionário (`email.*`, regra 9).
 *
 * **O que nunca entra:** token de provedor, nome, foto, e-mail do provedor ou
 * qualquer dado de outra pessoa (US-019.AC-2). Os tipos de entrada são
 * estreitos de propósito — não há campo onde esse dado caiba.
 *
 * O código do cadastro e o link de recuperação são credenciais. Estas funções
 * não registram nada; quem decide se o corpo pode aparecer em log é o mailer
 * (`configuredMailer`), e em deployment nenhum o imprime.
 */
import { translator, type LocaleId } from "../../../core/i18n/index.ts";
import type { OidcProviderId } from "../domain/oidc-config.ts";

export type AccountEmail = { subject: string; text: string };

/** Quem ligou ou desligou o provedor. `cli` é o operador, contado como administrador. */
export type ProviderActor = "self" | "automatic" | "admin" | "cli";

function providerName(locale: LocaleId, provider: OidcProviderId): string {
  const { t } = translator(locale);
  return provider === "google" ? t("email.providerGoogle") : t("email.providerLinkedin");
}

/** Data e hora em UTC, no formato do idioma. Fuso fixo: o e-mail não sabe onde a pessoa está. */
function formatMoment(iso: string, locale: LocaleId): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(date);
}

function compose(locale: LocaleId, subject: string, paragraphs: string[]): AccountEmail {
  const { t } = translator(locale);
  return { subject, text: [...paragraphs, t("email.signature")].join("\n\n") };
}

/** Código de 6 dígitos do cadastro manual (US-016). */
export function signupCodeEmail(input: { locale: LocaleId; code: string; minutes: number }): AccountEmail {
  const { t } = translator(input.locale);
  return compose(input.locale, t("email.codeSubject"), [
    t("email.codeIntro"),
    input.code,
    t("email.codeExpiry", { minutes: input.minutes }),
    t("email.codeIgnore"),
  ]);
}

/** Boas-vindas depois de um cadastro feito pela própria pessoa (US-018). */
export function welcomeEmail(input: {
  locale: LocaleId;
  role: "candidate" | "recruiter";
  signInUrl: string;
}): AccountEmail {
  const { t } = translator(input.locale);
  return compose(input.locale, t("email.welcomeSubject"), [
    t("email.welcomeIntro"),
    input.role === "candidate" ? t("email.welcomeCandidate") : t("email.welcomeRecruiter"),
    t("email.welcomeSignIn", { url: input.signInUrl }),
  ]);
}

/**
 * Cadastro com e-mail já registrado (US-016.EC-3).
 *
 * Sem código: a tela responde igual ao cadastro normal, e só a dona do
 * endereço fica sabendo, por aqui, que a conta já existia.
 */
export function accountExistsEmail(input: {
  locale: LocaleId;
  signInUrl: string;
  recoveryUrl: string;
}): AccountEmail {
  const { t } = translator(input.locale);
  return compose(input.locale, t("email.existsSubject"), [
    t("email.existsIntro"),
    t("email.existsSignIn", { url: input.signInUrl }),
    t("email.existsRecover", { url: input.recoveryUrl }),
    t("email.existsIgnore"),
  ]);
}

/** Aviso de provedor ligado ou desligado (US-019): provedor, quando e por quem. */
export function providerNoticeEmail(input: {
  locale: LocaleId;
  provider: OidcProviderId;
  action: "linked" | "unlinked";
  by: ProviderActor;
  /** ISO 8601. */
  at: string;
}): AccountEmail {
  const { t } = translator(input.locale);
  const provider = providerName(input.locale, input.provider);
  const actor =
    input.by === "self"
      ? t("email.actorSelf")
      : input.by === "automatic"
        ? t("email.actorAutomatic", { provider })
        : t("email.actorAdmin");
  const at = formatMoment(input.at, input.locale);
  const linked = input.action === "linked";
  return compose(input.locale, t(linked ? "email.linkedSubject" : "email.unlinkedSubject", { provider }), [
    t(linked ? "email.linkedBody" : "email.unlinkedBody", { provider, at, actor }),
    t("email.noticeIgnore"),
  ]);
}

/** Link de recuperação de senha, de uso único (US-020, G17/G18). */
export function recoveryEmail(input: { locale: LocaleId; url: string; minutes: number }): AccountEmail {
  const { t } = translator(input.locale);
  return compose(input.locale, t("email.recoverySubject"), [
    t("email.recoveryIntro"),
    input.url,
    t("email.recoveryExpiry", { minutes: input.minutes }),
    t("email.recoveryIgnore"),
  ]);
}
