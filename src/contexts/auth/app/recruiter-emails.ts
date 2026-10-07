/**
 * Os e-mails do acesso de recrutador, no idioma de quem recebe (#465, ADR-005).
 *
 * Mesmo padrão de `account-emails.ts`: uma função pura por mensagem, que
 * recebe só o que a mensagem precisa e devolve `{ subject, text }`; todo texto
 * vem do dicionário (`email.recruiter*`, regra 9). O destinatário e o envio
 * ficam com quem chama, depois do commit.
 *
 * **O que nunca entra:** currículo, funil, notas (nem a nota da sugestão),
 * piso salarial, contato do perfil e token fora do link. Os tipos de entrada
 * não têm campo onde esse dado caiba.
 *
 * Nome de pessoa, título e empresa são dado de usuário: viram uma linha só
 * antes de entrar em assunto ou corpo, para que um nome com quebra de linha
 * não forje cabeçalho (`Bcc:`) nem parágrafo. O texto é puro — marcação chega
 * como foi digitada e nada a interpreta.
 */
import { translator, type LocaleId } from "../../../core/i18n/index.ts";

export type RecruiterEmail = { subject: string; text: string };

/** Uma linha só: controle, quebra e separador viram espaço. */
function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s{2,}/g, " ").trim();
}

function compose(locale: LocaleId, subject: string, paragraphs: string[]): RecruiterEmail {
  const { t } = translator(locale);
  return { subject: oneLine(subject), text: [...paragraphs, t("email.signature")].join("\n\n") };
}

/** Data e hora em UTC, no formato do idioma — a validade do link não depende de fuso de ninguém. */
function formatUtc(iso: string, locale: LocaleId): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(date);
}

/**
 * Fim do acesso no fuso que o candidato escolheu (ADR-016): o recrutador lê o
 * mesmo dia que o candidato marcou, com o fuso dito ao lado.
 */
function formatInZone(iso: string, tz: string | null, locale: LocaleId): { date: string; tz: string } {
  const date = new Date(iso);
  const zone = tz ?? "UTC";
  if (Number.isNaN(date.getTime())) return { date: iso, tz: zone };
  try {
    return {
      date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: zone }).format(date),
      tz: zone,
    };
  } catch {
    return { date: formatUtc(iso, locale), tz: "UTC" };
  }
}

function endSentence(locale: LocaleId, expiresAt: string | null, expiryTz: string | null): string {
  const { t } = translator(locale);
  if (expiresAt === null) return t("email.recruiterNoEnd");
  return t("email.recruiterEndsAt", formatInZone(expiresAt, expiryTz, locale));
}

/**
 * Convite a quem ainda não tem conta de recrutador (US-002.AC-2): nomeia o
 * candidato, diz o escopo, a validade do link e que a conta precisa usar este
 * mesmo endereço. `needsRecruiterAccount` acrescenta que é preciso conta de
 * recrutador (US-001.EC-7) sem dizer se já existe uma conta com o endereço.
 */
export function inviteEmail(input: {
  locale: LocaleId;
  candidateName: string;
  url: string;
  validUntil: string;
  needsRecruiterAccount?: boolean;
}): RecruiterEmail {
  const { t } = translator(input.locale);
  const candidate = oneLine(input.candidateName);
  return compose(input.locale, t("email.recruiterInviteSubject", { candidate }), [
    t("email.recruiterInviteIntro", { candidate }),
    t("email.recruiterScope", { candidate }),
    t("email.recruiterInviteSameEmail"),
    ...(input.needsRecruiterAccount ? [t("email.recruiterInviteNeedsRecruiter")] : []),
    t("email.recruiterInviteValidity", { date: formatUtc(input.validUntil, input.locale) }),
    input.url,
    t("email.recruiterInviteIgnore", { candidate }),
  ]);
}

/** Acesso concedido (US-001.AC-4, US-005.AC-1): candidato, escopo, fim e o link da página dele. */
export function accessGrantedEmail(input: {
  locale: LocaleId;
  candidateName: string;
  url: string;
  expiresAt: string | null;
  expiryTz: string | null;
}): RecruiterEmail {
  const { t } = translator(input.locale);
  const candidate = oneLine(input.candidateName);
  return compose(input.locale, t("email.recruiterGrantedSubject", { candidate }), [
    t("email.recruiterGrantedIntro", { candidate }),
    t("email.recruiterScope", { candidate }),
    endSentence(input.locale, input.expiresAt, input.expiryTz),
    t("email.recruiterOpenLink", { url: input.url }),
  ]);
}

/** Prazo mudou (US-006.AC-3): o novo fim, ou que o acesso não termina mais. */
export function endDateChangedEmail(input: {
  locale: LocaleId;
  candidateName: string;
  url: string;
  expiresAt: string | null;
  expiryTz: string | null;
}): RecruiterEmail {
  const { t } = translator(input.locale);
  const candidate = oneLine(input.candidateName);
  return compose(input.locale, t("email.recruiterEndChangedSubject", { candidate }), [
    t("email.recruiterEndChangedIntro", { candidate }),
    input.expiresAt === null
      ? t("email.recruiterNoLongerEnds")
      : endSentence(input.locale, input.expiresAt, input.expiryTz),
    t("email.recruiterOpenLink", { url: input.url }),
  ]);
}

/** Por que o acesso acabou. O candidato não dá motivo, e o e-mail não inventa um (US-008.AC-3). */
export type AccessEndCause = "candidate" | "admin" | "expired";

/** Acesso encerrado (US-008.AC-3, US-010.AC-2, US-017): só a causa, sem link — a página já responde 404. */
export function accessEndedEmail(input: {
  locale: LocaleId;
  candidateName: string;
  cause: AccessEndCause;
}): RecruiterEmail {
  const { t } = translator(input.locale);
  const candidate = oneLine(input.candidateName);
  const cause =
    input.cause === "candidate"
      ? t("email.recruiterEndedByCandidate", { candidate })
      : input.cause === "admin"
        ? t("email.recruiterEndedByAdmin", { candidate })
        : t("email.recruiterEndedExpired", { candidate });
  return compose(input.locale, t("email.recruiterEndedSubject", { candidate }), [
    cause,
    t("email.recruiterEndedAfter"),
  ]);
}

/**
 * Sugestões de um recrutador, agrupadas (US-020.AC-1, EC-5): nome do
 * recrutador, cada vaga com a empresa e um link para `/suggestions`. A nota da
 * sugestão não vem por e-mail — fica na tela, como texto.
 */
export function suggestionsDigestEmail(input: {
  locale: LocaleId;
  recruiterName: string;
  items: readonly { title: string; company: string }[];
  url: string;
}): RecruiterEmail {
  const { t } = translator(input.locale);
  const recruiter = oneLine(input.recruiterName);
  return compose(input.locale, t("email.recruiterDigestSubject", { recruiter }), [
    t("email.recruiterDigestIntro", { recruiter, count: input.items.length }),
    input.items
      .map((item) => t("email.recruiterDigestItem", { title: oneLine(item.title), company: oneLine(item.company) }))
      .join("\n"),
    t("email.recruiterDigestDecide", { url: input.url }),
    t("email.recruiterDigestFunnel"),
  ]);
}
