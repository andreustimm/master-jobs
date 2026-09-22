import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { findUser, MIN_LENGTH } from "../../src/contexts/auth/index.ts";
import { requirePage } from "../auth";
import { getTranslator } from "../i18n";
import { changePasswordAction, renameAction } from "./actions";
import { accountStatus } from "./status";

export const dynamic = "force-dynamic";

/**
 * Minha conta: nome de exibição e senha da conta DA SESSÃO.
 *
 * Nenhum id na URL nem no formulário — a conta é sempre a de quem está logado.
 * O e-mail aparece só para leitura: ele é o login e o destino da recuperação
 * de senha, e trocá-lo sem confirmar a posse do endereço novo deixaria uma
 * sessão roubada desviar a recuperação. Muda por admin (`docs/security.md`).
 *
 * Sessão emprestada vê a tela, mas sem formulário: a política nega
 * `account:write` a ela, e mostrar campos que só dariam 403 seria convite.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePage("account:read");
  const { t } = await getTranslator();
  const { status } = await searchParams;
  const notice = accountStatus(status);
  const user = await findUser(session.userId);
  const borrowed = session.impersonatedBy !== null;

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
                <p data-testid="account-no-password" className="type-body-sm text-muted-foreground">
                  {t("account.noPassword")}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
