import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  accountAccess,
  findUser,
  historyPageOf,
  MIN_LENGTH,
  recruiterAccessView,
  type OidcProviderId,
  type ProviderMethod,
} from "../../src/contexts/auth/index.ts";
import { formatDate, type LocaleId, type Translator } from "../../src/core/i18n/index.ts";
import { candidateScope, requirePage } from "../auth";
import { getTranslator } from "../i18n";
import { changePasswordAction, disconnectProviderAction, renameAction, setOwnPasswordAction } from "./actions";
import { RecruiterAccessSection } from "./recruiter-access";
import { accountStatus, providerStatus } from "./status";

export const dynamic = "force-dynamic";

/**
 * Minha conta: nome de exibição, senha e formas de entrar da conta DA SESSÃO.
 *
 * Nenhum id na URL nem no formulário — a conta é sempre a de quem está logado.
 * O e-mail aparece só para leitura: ele é o login e o destino da recuperação
 * de senha, e trocá-lo sem confirmar a posse do endereço novo deixaria uma
 * sessão roubada desviar a recuperação. Muda por admin (`docs/security.md`).
 *
 * Sessão emprestada vê a tela, mas sem formulário: a política nega
 * `account:write` e `account:manage-methods` a ela, e mostrar campos e botões
 * que só dariam 403 seria convite.
 *
 * Formas de entrar (#464, US-010): só provedor, datas, origem e
 * disponibilidade — nunca o e-mail, o nome ou a foto do provedor.
 *
 * Acesso de recrutadores (#465): só para quem tem candidato na sessão —
 * recrutador e admin sem candidato não veem a seção. O histórico pagina por
 * `?historyPage=`.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    linked?: string;
    unlinked?: string;
    error?: string;
    provider?: string;
    historyPage?: string;
  }>;
}) {
  const session = await requirePage("account:read");
  const { t, locale } = await getTranslator();
  const params = await searchParams;
  const notice = accountStatus(params.status);
  const social = providerStatus(params);
  const providerName = (id: OidcProviderId) =>
    id === "google" ? t("email.providerGoogle") : t("email.providerLinkedin");
  const user = await findUser(session.userId);
  const access = await accountAccess(session);
  const borrowed = session.impersonatedBy !== null;
  const recruiterAccess =
    candidateScope(session) === null ? null : await recruiterAccessView(session, historyPageOf(params.historyPage));

  return (
    <main className="pt-10 pb-16" data-testid="route-account">
      <h1 className="type-display-md chevron mb-2">{t("account.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">{t("account.lead")}</p>

      {/* Cor só na borda: `--good`, `--bad` e `--warn` são tokens de
          preenchimento (3:1), e texto precisa de 4.5:1 — fica em `foreground`. */}
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          data-testid="account-status"
          className={`type-body-sm mb-6 max-w-[62ch] border-l-4 pl-3 text-foreground ${notice.ok ? "border-[var(--good)]" : "border-[var(--bad)]"}`}
        >
          {t(notice.key)}
        </p>
      )}
      {social && (
        <p
          role={social.ok ? "status" : "alert"}
          data-testid="account-provider-status"
          className={`type-body-sm mb-6 max-w-[62ch] border-l-4 pl-3 text-foreground ${social.ok ? "border-[var(--good)]" : "border-[var(--bad)]"}`}
        >
          {t(social.key, { provider: providerName(social.provider) })}
        </p>
      )}

      {borrowed && (
        <p role="note" data-testid="account-borrowed" className="type-body-sm mb-6 max-w-[62ch] border-l-4 border-[var(--warn)] pl-3 text-foreground">
          {t("account.borrowed")}
        </p>
      )}

      <div className="grid max-w-[40rem] gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("account.profileTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 pt-0">
            <div className="grid gap-1.5">
              <span className="type-micro text-muted-foreground">{t("account.email")}</span>
              <span data-user-content data-testid="account-email" className="type-body-md break-all">
                {session.email}
              </span>
              <p className="type-meta text-muted-foreground">{t("account.emailHint")}</p>
            </div>

            {!borrowed && user && (
              <form action={renameAction} className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="account-name">{t("account.fullName")}</Label>
                  <Input
                    id="account-name"
                    name="fullName"
                    type="text"
                    maxLength={120}
                    required
                    autoComplete="name"
                    defaultValue={user.fullName ?? ""}
                    aria-describedby="account-name-hint"
                  />
                  <p id="account-name-hint" className="type-meta text-muted-foreground">
                    {t("account.fullNameHint")}
                  </p>
                </div>
                <div>
                  <Button type="submit" className="min-h-11" data-testid="account-save-name">
                    {t("account.saveName")}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        {!borrowed && user && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("account.passwordTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-0">
              {user.hasPassword ? (
                <>
                  <p className="type-body-sm text-muted-foreground">{t("account.passwordLead")}</p>
                  <form action={changePasswordAction} className="grid gap-3">
                    {/* O navegador associa a troca à conta certa pelo campo de
                        usuário; oculto, mas presente, é o padrão que os
                        gerenciadores de senha leem. */}
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      defaultValue={session.email}
                      hidden
                      readOnly
                    />
                    <div className="grid gap-1.5">
                      <Label htmlFor="account-current">{t("account.currentPassword")}</Label>
                      <Input
                        id="account-current"
                        name="currentPassword"
                        type="password"
                        required
                        autoComplete="current-password"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="account-new">{t("account.newPassword")}</Label>
                      <Input
                        id="account-new"
                        name="newPassword"
                        type="password"
                        required
                        minLength={MIN_LENGTH}
                        autoComplete="new-password"
                        aria-describedby="account-new-hint"
                      />
                      <p id="account-new-hint" className="type-meta text-muted-foreground">
                        {t("account.passwordHint")}
                      </p>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="account-confirm">{t("account.confirmPassword")}</Label>
                      <Input
                        id="account-confirm"
                        name="confirmPassword"
                        type="password"
                        required
                        minLength={MIN_LENGTH}
                        autoComplete="new-password"
                      />
                    </div>
                    <div>
                      <Button type="submit" className="min-h-11" data-testid="account-change-password">
                        {t("account.changePassword")}
                      </Button>
                    </div>
                  </form>
                </>
              ) : (
                <>
                  <p data-testid="account-no-password" className="type-body-sm text-muted-foreground">
                    {t("account.firstPasswordLead")}
                  </p>
                  <form action={setOwnPasswordAction} className="grid gap-3">
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      defaultValue={session.email}
                      hidden
                      readOnly
                    />
                    <div className="grid gap-1.5">
                      <Label htmlFor="account-first">{t("account.newPassword")}</Label>
                      <Input
                        id="account-first"
                        name="newPassword"
                        type="password"
                        required
                        minLength={MIN_LENGTH}
                        autoComplete="new-password"
                        aria-describedby="account-first-hint"
                      />
                      <p id="account-first-hint" className="type-meta text-muted-foreground">
                        {t("account.passwordHint")}
                      </p>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="account-first-confirm">{t("account.confirmPassword")}</Label>
                      <Input
                        id="account-first-confirm"
                        name="confirmPassword"
                        type="password"
                        required
                        minLength={MIN_LENGTH}
                        autoComplete="new-password"
                      />
                    </div>
                    <div>
                      <Button type="submit" className="min-h-11" data-testid="account-set-password">
                        {t("account.setPassword")}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {access && (
          <Card data-testid="account-methods">
            <CardHeader>
              <CardTitle className="text-lg">{t("account.methodsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-0">
              <p className="type-body-sm text-muted-foreground">{t("account.methodsLead")}</p>
              <ul className="grid gap-3">
                <li className="flex flex-wrap items-baseline justify-between gap-2" data-testid="account-method-password">
                  <span className="type-body-md font-medium">{t("account.methodPassword")}</span>
                  <span className="type-body-sm text-muted-foreground">
                    {access.methods.password ? t("account.methodPasswordSet") : t("account.methodPasswordUnset")}
                  </span>
                </li>
                {access.methods.providers.map((method) => (
                  <ProviderRow
                    key={method.provider}
                    method={method}
                    name={providerName(method.provider)}
                    borrowed={borrowed}
                    locale={locale}
                    t={t}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {access && (
          <Card data-testid="account-terms">
            <CardHeader>
              <CardTitle className="text-lg">{t("account.termsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="type-body-sm text-muted-foreground" data-testid="account-terms-versions">
                {access.terms.termsVersion && access.terms.privacyVersion && access.terms.acceptedAt
                  ? t("account.termsAccepted", {
                      terms: access.terms.termsVersion,
                      privacy: access.terms.privacyVersion,
                      date: formatDate(access.terms.acceptedAt, locale),
                    })
                  : t("account.termsNone")}
              </p>
            </CardContent>
          </Card>
        )}

        {recruiterAccess && <RecruiterAccessSection view={recruiterAccess} borrowed={borrowed} t={t} locale={locale} />}
      </div>
    </main>
  );
}

/** Início do vínculo: a mesma rota do login social, com `intent=link`. */
function connectHref(provider: OidcProviderId): string {
  return `/login/oauth/${provider}?intent=link`;
}

/**
 * Uma linha por provedor: ligado (datas, origem, desligar) ou não (conectar).
 *
 * "Desligar" aparece mesmo quando é a última forma de entrar: a recusa vem do
 * servidor, com a mensagem que diz o que fazer antes (US-008.AC-2). "Conectar"
 * só onde o provedor funciona neste ambiente; ligado e indisponível continua
 * listado, com o aviso (US-010.EC-2).
 */
function ProviderRow({
  method,
  name,
  borrowed,
  locale,
  t,
}: {
  method: ProviderMethod;
  name: string;
  borrowed: boolean;
  locale: LocaleId;
  t: Translator["t"];
}) {
  return (
    <li
      className="grid gap-1.5 border-t border-[var(--color-hairline)] pt-3"
      data-testid={`account-method-${method.provider}`}
      data-linked={method.linked ? "true" : "false"}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="type-body-md font-medium">{name}</span>
        <span className="type-body-sm text-muted-foreground">
          {method.linked ? t("account.methodLinkedAt", { date: formatDate(method.linkedAt, locale) }) : t("account.methodNotLinked")}
        </span>
      </div>
      {method.linked && (
        <>
          <p className="type-meta text-muted-foreground">
            {method.origin === "automatic" ? t("account.methodOriginAutomatic") : t("account.methodOriginManual")}
          </p>
          <p className="type-meta text-muted-foreground" data-testid={`account-method-${method.provider}-last-used`}>
            {method.lastUsed === "never"
              ? t("account.methodNeverUsed")
              : t("account.methodLastUsed", { date: formatDate(method.lastUsed, locale) })}
          </p>
        </>
      )}
      {!method.availableHere && (
        <p className="type-meta text-muted-foreground" data-testid={`account-method-${method.provider}-unavailable`}>
          {t("account.methodUnavailable")}
        </p>
      )}
      {!borrowed && method.linked && (
        <form action={disconnectProviderAction} className="grid gap-1.5">
          <input type="hidden" name="provider" value={method.provider} />
          <p className="type-meta text-muted-foreground">{t("account.relinkWarning", { provider: name })}</p>
          <div>
            <Button
              type="submit"
              variant="outline"
              className="min-h-11"
              data-testid={`account-disconnect-${method.provider}`}
            >
              {t("account.disconnect", { provider: name })}
            </Button>
          </div>
        </form>
      )}
      {!borrowed && !method.linked && method.availableHere && (
        <div>
          {/* Link, não formulário: ligar é um GET que sai para o provedor
              (ADR-012), como os botões do /login. */}
          <a
            href={connectHref(method.provider)}
            data-testid={`account-connect-${method.provider}`}
            className={buttonVariants({ variant: "outline", className: "min-h-11 gap-2" })}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- marca estática, sem otimização */}
            <img src={`/icons/${method.provider}.svg`} alt="" width={18} height={18} />
            {t("account.connect", { provider: name })}
          </a>
        </div>
      )}
    </li>
  );
}
