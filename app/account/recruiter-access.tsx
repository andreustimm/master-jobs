import type { Route } from "next";
import { Fragment, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CandidateAccessView, GrantRow, HistoryRow, InviteRow } from "../../src/contexts/auth/index.ts";
import { formatDate, type LocaleId, type TranslationKey, type Translator } from "../../src/core/i18n/index.ts";
import { TransitionLink } from "../transition-link";
import {
  cancelInviteAction,
  dismissInviteAction,
  grantRecruiterAccessAction,
  resendInviteAction,
  revokeRecruiterAccessAction,
  setGrantEndDateAction,
} from "./recruiter-access-actions";
import { AccessActionButton, EndDateForm, GrantAccessForm, type ErrorLabels } from "./recruiter-access-forms";

/**
 * "Acesso de recrutadores" em Minha conta (#465, US-001 – US-012).
 *
 * A declaração de escopo vem antes de tudo e fica junto do formulário: quem
 * concede lê o que o recrutador vai e não vai ver antes do primeiro acesso.
 * Status é sempre texto (nunca só cor), e nome e e-mail de recrutador são dado
 * de usuário (`data-user-content`), mostrados como texto literal.
 *
 * Sessão emprestada (`borrowed`) vê a lista e o histórico sem formulário nem
 * botão: a política nega `access:manage` a ela, e mostrar o controle seria
 * oferecer o que só daria 403 (G24, US-024.AC-2).
 */

type T = Translator["t"];

const ERROR_CODES = [
  "blank_email",
  "invalid_email",
  "self",
  "already_active",
  "already_invited",
  "cap_reached",
  "too_many_pending",
  "date_invalid",
  "date_past",
  "date_too_far",
  "already_ended",
  "not_found",
  "unexpected",
] as const;

function errorLabels(t: T): ErrorLabels {
  const out: Record<string, string> = {};
  for (const code of ERROR_CODES) out[code] = t(`recruiterAccessError.${code}`);
  return out as ErrorLabels;
}

/**
 * Interpola um modelo do dicionário com nós: o texto da interface fica fora, e
 * só o valor que é dado de usuário (e-mail, nome do admin) leva a marca.
 */
function fill(template: string, values: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={index}>{key !== undefined && key in values ? values[key] : part}</Fragment>;
  });
}

function userValue(value: string): ReactNode {
  return <span data-user-content>{value}</span>;
}

function withEmail(template: string, email: string): ReactNode {
  return fill(template, { email: userValue(email) });
}

/** O fuso gravado já passou por `parseEndDate`, que só guarda fuso que o `Intl` conhece. */
function inZone(iso: string, tz: string | null, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: tz ?? "UTC" }).format(new Date(iso));
}

/** O dia escolhido, como o campo de data o espera (`YYYY-MM-DD`), no fuso em que foi escolhido. */
function dayInZone(iso: string | null, tz: string | null): string {
  if (iso === null) return "";
  // `en-CA` escreve a data como ano-mês-dia, o formato do `<input type="date">`.
  return inZone(iso, tz, "en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function endLabel(row: { expiresAt: string | null; expiryTz: string | null }, t: T, locale: LocaleId): string {
  if (row.expiresAt === null) return t("recruiterAccess.noEnd");
  return t("recruiterAccess.endsAt", {
    date: inZone(row.expiresAt, row.expiryTz, locale, { dateStyle: "medium" }),
    tz: row.expiryTz ?? "UTC",
  });
}

function dateTime(iso: string, locale: LocaleId): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

const DISPLAY_KEY = {
  active: "recruiterAccess.statusActive",
  account_disabled: "recruiterAccess.statusAccountDisabled",
  not_recruiter: "recruiterAccess.statusNotRecruiter",
} as const satisfies Record<GrantRow["display"], TranslationKey>;

export function RecruiterAccessSection({
  view,
  borrowed,
  t,
  locale,
}: {
  view: CandidateAccessView;
  borrowed: boolean;
  t: T;
  locale: LocaleId;
}) {
  const errors = errorLabels(t);
  return (
    <Card data-testid="recruiter-access">
      <CardHeader>
        <CardTitle className="text-lg">{t("recruiterAccess.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 pt-0">
        <div className="grid gap-2" data-testid="recruiter-access-scope">
          <p className="type-body-sm text-muted-foreground">{t("recruiterAccess.lead")}</p>
          <p className="type-body-sm">{t("recruiterAccess.scopeSees")}</p>
          <p className="type-body-sm">{t("recruiterAccess.scopeNever")}</p>
        </div>

        {borrowed ? (
          <p role="note" data-testid="recruiter-access-borrowed" className="type-body-sm border-l-4 border-[var(--warn)] pl-3 text-foreground">
            {t("recruiterAccess.borrowed")}
          </p>
        ) : (
          <GrantAccessForm
            action={grantRecruiterAccessAction}
            locale={locale}
            errors={errors}
            labels={{
              email: t("recruiterAccess.email"),
              emailHint: t("recruiterAccess.emailHint"),
              endDate: t("recruiterAccess.endDate"),
              endDateHint: t("recruiterAccess.endDateHint"),
              timezone: t("recruiterAccess.timezone"),
              submit: t("recruiterAccess.submit"),
              granted: t("recruiterAccess.granted"),
              invited: t("recruiterAccess.invited"),
            }}
          />
        )}

        <section className="grid gap-3" aria-labelledby="recruiter-access-active">
          <h3 id="recruiter-access-active" className="type-body-md font-medium">
            {t("recruiterAccess.activeTitle")}
          </h3>
          {view.grants.length === 0 ? (
            <p className="type-body-sm text-muted-foreground" data-testid="recruiter-access-empty">
              {t("recruiterAccess.empty")}
            </p>
          ) : (
            <ul className="grid gap-3">
              {view.grants.map((grant) => (
                <GrantItem key={grant.id} grant={grant} borrowed={borrowed} errors={errors} t={t} locale={locale} />
              ))}
            </ul>
          )}
        </section>

        {view.invites.length > 0 && (
          <section className="grid gap-3" aria-labelledby="recruiter-access-invites">
            <h3 id="recruiter-access-invites" className="type-body-md font-medium">
              {t("recruiterAccess.invitesTitle")}
            </h3>
            <ul className="grid gap-3">
              {view.invites.map((invite) => (
                <InviteItem key={invite.id} invite={invite} borrowed={borrowed} errors={errors} t={t} locale={locale} />
              ))}
            </ul>
          </section>
        )}

        <HistorySection view={view} t={t} locale={locale} />
      </CardContent>
    </Card>
  );
}

function GrantItem({
  grant,
  borrowed,
  errors,
  t,
  locale,
}: {
  grant: GrantRow;
  borrowed: boolean;
  errors: ErrorLabels;
  t: T;
  locale: LocaleId;
}) {
  return (
    <li className="grid gap-2 border-t border-[var(--color-hairline)] pt-3" data-testid="recruiter-grant">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 break-all">
          {grant.recruiterName !== null && grant.recruiterName.trim() !== "" && (
            <span data-user-content className="type-body-md font-medium" data-testid="recruiter-grant-name">
              {grant.recruiterName}{" "}
            </span>
          )}
          <span data-user-content className="type-body-sm text-muted-foreground" data-testid="recruiter-grant-email">
            {grant.recruiterEmail}
          </span>
        </span>
        <span className="type-body-sm font-medium" data-testid="recruiter-grant-status">
          {t(DISPLAY_KEY[grant.display])}
        </span>
      </div>
      <p className="type-meta flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span data-testid="recruiter-grant-since">{t("recruiterAccess.since", { date: formatDate(grant.createdAt, locale) })}</span>
        <span data-testid="recruiter-grant-end">{endLabel(grant, t, locale)}</span>
        <span data-testid="recruiter-grant-last-access">
          {grant.lastAccessedAt === null
            ? t("recruiterAccess.neverAccessed")
            : t("recruiterAccess.lastAccess", { date: dateTime(grant.lastAccessedAt, locale) })}
        </span>
      </p>
      {!borrowed && (
        <div className="flex flex-wrap items-end gap-3">
          <EndDateForm
            action={setGrantEndDateAction}
            grantId={grant.id}
            current={dayInZone(grant.expiresAt, grant.expiryTz)}
            locale={locale}
            errors={errors}
            labels={{
              endDate: t("recruiterAccess.endDate"),
              save: t("recruiterAccess.saveEnd"),
              clear: t("recruiterAccess.clearEnd"),
              saved: t("recruiterAccess.endSaved"),
            }}
          />
          <AccessActionButton
            action={revokeRecruiterAccessAction}
            fields={{ grantId: grant.id }}
            label={t("recruiterAccess.revoke")}
            testId="recruiter-grant-revoke"
            success={t("recruiterAccess.revoked")}
            errors={errors}
            locale={locale}
            variant="destructive"
            confirm={{
              title: withEmail(t("recruiterAccess.revokeTitle"), grant.recruiterEmail),
              body: t("recruiterAccess.revokeBody"),
              confirm: t("recruiterAccess.revokeConfirm"),
              keep: t("recruiterAccess.keep"),
            }}
          />
        </div>
      )}
    </li>
  );
}

function InviteItem({
  invite,
  borrowed,
  errors,
  t,
  locale,
}: {
  invite: InviteRow;
  borrowed: boolean;
  errors: ErrorLabels;
  t: T;
  locale: LocaleId;
}) {
  const expired = invite.status === "expired";
  return (
    <li className="grid gap-2 border-t border-[var(--color-hairline)] pt-3" data-testid="recruiter-invite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span data-user-content className="type-body-md min-w-0 break-all" data-testid="recruiter-invite-email">
          {invite.email}
        </span>
        <span className="type-body-sm font-medium" data-testid="recruiter-invite-status">
          {expired ? t("recruiterAccess.inviteExpired") : t("recruiterAccess.invitePending")}
        </span>
      </div>
      <p className="type-meta flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>{t("recruiterAccess.inviteSent", { date: formatDate(invite.createdAt, locale) })}</span>
        <span data-testid="recruiter-invite-valid-until">
          {t("recruiterAccess.inviteValidUntil", { date: formatDate(invite.expiresAt, locale) })}
        </span>
        <span>{endLabel({ expiresAt: invite.accessExpiresAt, expiryTz: invite.expiryTz }, t, locale)}</span>
      </p>
      {invite.deliveryFailed && (
        <p className="type-meta border-l-4 border-[var(--bad)] pl-2 text-foreground" data-testid="recruiter-invite-delivery-failed">
          {t("recruiterAccess.deliveryFailed")}
        </p>
      )}
      {!borrowed && (
        <div className="flex flex-wrap items-center gap-3">
          <AccessActionButton
            action={resendInviteAction}
            fields={{ inviteId: invite.id }}
            label={t("recruiterAccess.resend")}
            testId="recruiter-invite-resend"
            success={t("recruiterAccess.resent")}
            errors={errors}
            locale={locale}
          />
          {expired ? (
            <AccessActionButton
              action={dismissInviteAction}
              fields={{ inviteId: invite.id }}
              label={t("recruiterAccess.dismiss")}
              testId="recruiter-invite-dismiss"
              success={t("recruiterAccess.dismissed")}
              errors={errors}
              locale={locale}
            />
          ) : (
            <AccessActionButton
              action={cancelInviteAction}
              fields={{ inviteId: invite.id }}
              label={t("recruiterAccess.cancelInvite")}
              testId="recruiter-invite-cancel"
              success={t("recruiterAccess.inviteCancelled")}
              errors={errors}
              locale={locale}
              variant="destructive"
              confirm={{
                title: withEmail(t("recruiterAccess.cancelInviteTitle"), invite.email),
                body: t("recruiterAccess.cancelInviteBody"),
                confirm: t("recruiterAccess.cancelInviteConfirm"),
                keep: t("recruiterAccess.keep"),
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * A linha do histórico como frase: o quê, com quem e quem fez. `kind` e
 * `actor` vêm de listas fechadas pelo `CHECK` da tabela, as mesmas chaves do
 * dicionário.
 */
function historyText(row: HistoryRow, t: T, locale: LocaleId): { what: ReactNode; who: ReactNode } {
  let key = row.kind;
  let date = "";
  if (row.kind === "end_date_changed") {
    if (row.detail === null || row.detail === "none") key = "end_date_cleared";
    else date = formatDate(row.detail, locale);
  }
  const what = fill(t(`recruiterAccessEvent.${key}` as TranslationKey), { email: userValue(row.recruiterEmail), date });
  if (row.actor !== "admin") return { what, who: t(`recruiterAccessActor.${row.actor}` as TranslationKey) };
  const who = row.actorName
    ? fill(t("recruiterAccessActor.admin"), { name: userValue(row.actorName) })
    : t("recruiterAccessActor.adminUnnamed");
  return { what, who };
}

function HistorySection({ view, t, locale }: { view: CandidateAccessView; t: T; locale: LocaleId }) {
  const { rows, page, pages } = view.history;
  return (
    <section className="grid gap-3" aria-labelledby="recruiter-access-history" data-testid="recruiter-access-history">
      <h3 id="recruiter-access-history" className="type-body-md font-medium">
        {t("recruiterAccess.historyTitle")}
      </h3>
      {rows.length === 0 ? (
        <p className="type-body-sm text-muted-foreground" data-testid="recruiter-access-history-empty">
          {t("recruiterAccess.historyEmpty")}
        </p>
      ) : (
        <ol className="grid gap-2">
          {rows.map((row) => {
            const { what, who } = historyText(row, t, locale);
            return (
              <li key={row.id} className="type-body-sm grid gap-0.5" data-testid="recruiter-access-history-entry" data-kind={row.kind}>
                <span className="break-words">
                  {what} {who}
                </span>
                <time dateTime={row.at} className="type-meta text-muted-foreground">
                  {dateTime(row.at, locale)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      {pages > 1 && (
        <nav className="type-body-sm flex flex-wrap items-center gap-3" aria-label={t("recruiterAccess.historyTitle")}>
          {page > 1 && (
            <TransitionLink href={`/account?historyPage=${page - 1}` as Route} className="min-h-11 content-center underline" data-testid="recruiter-access-history-newer">
              {t("recruiterAccess.historyNewer")}
            </TransitionLink>
          )}
          <span className="text-muted-foreground">{t("recruiterAccess.historyPage", { page, pages })}</span>
          {page < pages && (
            <TransitionLink href={`/account?historyPage=${page + 1}` as Route} className="min-h-11 content-center underline" data-testid="recruiter-access-history-older">
              {t("recruiterAccess.historyOlder")}
            </TransitionLink>
          )}
        </nav>
      )}
    </section>
  );
}
