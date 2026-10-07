import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminRecruiterAccess,
  listUsersWithMethods,
  ROLES,
  type AdminCandidateAccess,
  type OidcProviderId,
  type Role,
  type UserSummary,
} from "../../../src/contexts/auth/index.ts";
import { formatDate, type LocaleId, type TranslationKey, type Translator } from "../../../src/core/i18n/index.ts";
import { requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import { MutationFeedbackForm } from "../../mutation-feedback";
import {
  adminCancelInviteAction,
  adminDisconnectProviderAction,
  adminRevokeGrantAction,
  createUserAction,
  impersonateAction,
  toggleDisabledAction,
} from "../actions";
import { DeleteUserModal, EditUserModal } from "../user-modal";
import { USER_MODAL_BOX } from "../user-modal-styles";

export const dynamic = "force-dynamic";

/**
 * Administração de contas.
 *
 * O que esta tela deliberadamente NÃO faz: mostrar dado de candidato. Nem
 * currículo, nem funil, nem candidatura. A política nega isso ao admin, e uma
 * tela que contornasse a política por conveniência tornaria a política
 * decorativa. Para ver o dado de alguém, o admin assume a identidade — e o
 * botão que faz isso grava quem assumiu de quem.
 */

const ROLE_LABEL = {
  admin: "admin.roleAdmin",
  candidate: "admin.roleCandidate",
  recruiter: "admin.roleRecruiter",
} as const satisfies Record<Role, TranslationKey>;

function providerLabel(provider: OidcProviderId, t: Translator["t"]): string {
  return provider === "google" ? t("email.providerGoogle") : t("email.providerLinkedin");
}

export default async function AdminUsersPage() {
  const { t, locale } = await getTranslator();
  // Guard antes de ler qualquer coisa. `user:manage` só existe para admin, e
  // uma sessão emprestada perde a ação em bloco.
  const session = await requirePage("user:manage");

  const users = await listUsersWithMethods();
  const access = await adminRecruiterAccess(
    session,
    users.flatMap((user) => (user.candidateId === null ? [] : [user.candidateId])),
  );

  return (
    <main className="pt-10 pb-16" data-testid="route-admin-users">
      <h1 className="type-display-md chevron mb-2">{t("admin.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">{t("admin.lead")}</p>

      <Card className="mb-8">
        <CardContent className="pt-0">
          <h2 className="type-display-xs mb-3">{t("admin.newUser")}</h2>
          <MutationFeedbackForm
            action={createUserAction}
            successMessage={t("feedback.success")}
            errorMessage={t("feedback.error")}
            dismissLabel={t("feedback.dismiss")}
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="fullName">{t("admin.fullName")}</Label>
              <Input id="fullName" name="fullName" type="text" maxLength={120} required autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">{t("admin.email")}</Label>
              <Input id="email" name="email" type="email" required autoComplete="off" />
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="type-micro mb-1.5 text-muted-foreground">{t("admin.roles")}</legend>
              <div className="flex flex-wrap gap-3">
                {ROLES.map((role) => (
                  <label key={role} className="flex cursor-pointer items-center gap-1.5 type-body-sm">
                    <input type="checkbox" name="roles" value={role} className="cursor-pointer" />
                    {t(ROLE_LABEL[role])}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="type-meta sm:col-span-2 text-muted-foreground">
              {t("admin.noPasswordHint")}
            </p>
            <div className="sm:col-span-2">
              <Button type="submit">{t("admin.create")}</Button>
            </div>
          </MutationFeedbackForm>
        </CardContent>
      </Card>

      <ul className="grid gap-3">
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            access={user.candidateId === null ? undefined : access.get(user.candidateId)}
            isSelf={user.id === session.userId}
            locale={locale}
            t={t}
          />
        ))}
      </ul>
    </main>
  );
}

/**
 * Concessões ativas e convites pendentes do candidato desta conta (US-023).
 *
 * Só revogar e cancelar, cada um com confirmação: conceder e convidar não
 * existem aqui, nem como botão nem como action (ADR-008, US-024.AC-1). `div`,
 * não `p`: cada item carrega um `form`, e o parser HTML fecharia o `p` antes
 * dele — o servidor e o React montariam árvores diferentes.
 */
function RecruiterAccessBlock({
  userId,
  access,
  locale,
  t,
}: {
  userId: number;
  access: AdminCandidateAccess;
  locale: LocaleId;
  t: Translator["t"];
}) {
  const endOf = (expiresAt: string | null) =>
    expiresAt === null ? t("recruiterAccess.noEnd") : formatDate(expiresAt, locale);
  return (
    <div className="type-meta grid gap-2 text-muted-foreground" data-testid="admin-recruiter-access">
      <span className="font-medium text-foreground">{t("admin.access")}</span>
      <ul className="grid gap-2">
        {access.grants.map((grant) => (
          <li key={`g${grant.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="admin-recruiter-grant">
            <span data-user-content className="break-all text-foreground">
              {grant.recruiterEmail}
            </span>
            <span>{t("admin.accessGrant", { since: formatDate(grant.createdAt, locale), end: endOf(grant.expiresAt) })}</span>
            <ConfirmAdminAction
              id={`grant-revoke-${userId}-${grant.id}`}
              action={adminRevokeGrantAction}
              field={{ name: "grantId", value: grant.id }}
              label={t("admin.revokeGrant")}
              title={t("admin.revokeGrantTitle")}
              email={grant.recruiterEmail}
              body={t("admin.revokeGrantBody")}
              confirm={t("admin.revokeGrantConfirm")}
              testId="admin-recruiter-grant-revoke"
              messages={{
                revoked: t("admin.grantRevoked"),
                already_ended: t("admin.accessAlreadyEnded"),
                not_found: t("admin.accessNotFound"),
              }}
              t={t}
            />
          </li>
        ))}
        {access.invites.map((invite) => (
          <li key={`i${invite.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="admin-recruiter-invite">
            <span data-user-content className="break-all text-foreground">
              {invite.email}
            </span>
            <span>
              {t("admin.accessInvite", { sent: formatDate(invite.createdAt, locale), until: formatDate(invite.expiresAt, locale) })}
            </span>
            <ConfirmAdminAction
              id={`invite-cancel-${userId}-${invite.id}`}
              action={adminCancelInviteAction}
              field={{ name: "inviteId", value: invite.id }}
              label={t("admin.cancelInvite")}
              title={t("admin.cancelInviteTitle")}
              email={invite.email}
              body={t("admin.cancelInviteBody")}
              confirm={t("admin.cancelInviteConfirm")}
              testId="admin-recruiter-invite-cancel"
              messages={{
                cancelled: t("admin.inviteCancelled"),
                already_ended: t("admin.accessAlreadyEnded"),
                not_found: t("admin.accessNotFound"),
              }}
              t={t}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Botão que abre a confirmação; só o de dentro executa. Mesmo popover nativo da exclusão de conta. */
function ConfirmAdminAction({
  id,
  action,
  field,
  label,
  title,
  email,
  body,
  confirm,
  testId,
  messages,
  t,
}: {
  id: string;
  action: (formData: FormData) => Promise<unknown>;
  field: { name: string; value: number };
  label: string;
  title: string;
  email: string;
  body: string;
  confirm: string;
  testId: string;
  messages: Record<string, string>;
  t: Translator["t"];
}) {
  const [before, after] = title.split("{email}");
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-11 xl:h-7 xl:min-h-0"
        popoverTarget={id}
        popoverTargetAction="show"
        data-testid={testId}
      >
        {label}
      </Button>
      <div id={id} popover="auto" role="dialog" className={USER_MODAL_BOX} data-testid={`${testId}-dialog`}>
        <div className="grid gap-3 px-5 py-5">
          <h2 className="type-display-xs leading-tight break-words">
            {before}
            <span data-user-content>{email}</span>
            {after}
          </h2>
          <p className="type-caption-sm">{body}</p>
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" popoverTarget={id} popoverTargetAction="hide" className="min-h-11">
              {t("admin.cancel")}
            </Button>
            {/* `autoComplete="off"`: ao recarregar, o navegador restauraria o id
                oculto pela posição, e depois de uma revogação a posição de uma
                concessão é a de outra. */}
            <MutationFeedbackForm
              action={action}
              autoComplete="off"
              successMessage={t("feedback.success")}
              errorMessage={t("feedback.error")}
              resultMessages={messages}
              dismissLabel={t("feedback.dismiss")}
            >
              <input type="hidden" name={field.name} value={field.value} />
              <Button type="submit" variant="destructive" className="min-h-11" data-testid={`${testId}-confirm`}>
                {confirm}
              </Button>
            </MutationFeedbackForm>
          </div>
        </div>
      </div>
    </>
  );
}

function UserRow({
  user,
  access,
  isSelf,
  locale,
  t,
}: {
  user: UserSummary & { providers: OidcProviderId[] };
  access: AdminCandidateAccess | undefined;
  isSelf: boolean;
  locale: LocaleId;
  t: Translator["t"];
}) {
  const disabled = user.disabledAt !== null;

  return (
    <li>
      <Card>
        <CardContent className="grid gap-3 pt-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Nome e e-mail são dado do usuário, não texto de interface. O
                nome vem primeiro porque é como a pessoa se chama; o e-mail
                continua visível ao lado porque é ele que identifica a conta de
                forma única — dois "João Silva" só se distinguem por ele. */}
            <span data-user-content className="type-body-lg font-medium">
              {user.fullName ?? user.email}
            </span>
            {user.fullName !== null && (
              <span data-user-content className="type-meta text-muted-foreground">
                {user.email}
              </span>
            )}
            <Badge variant="outline" className="type-micro">
              {disabled ? t("admin.disabled") : t("admin.active")}
            </Badge>
            {!user.hasPassword && (
              <Badge variant="outline" className="type-micro text-muted-foreground">
                {t("admin.noPassword")}
              </Badge>
            )}
            {user.candidateId !== null && (
              <span className="type-meta font-mono text-muted-foreground">
                {t("admin.candidate")} #{user.candidateId}
              </span>
            )}
            <span className="type-meta ml-auto font-mono text-muted-foreground">
              {user.createdAt.slice(0, 10)}
            </span>
          </div>

          {access && (access.grants.length > 0 || access.invites.length > 0) && (
            <RecruiterAccessBlock userId={user.id} access={access} locale={locale} t={t} />
          )}

          {/* Formas de entrar (#464, US-011): quais provedores e se há senha.
              `div` pelo mesmo motivo do bloco de vínculos: cada provedor
              carrega um `form`. Admin só desliga — ligar não existe aqui. */}
          <div
            className="type-meta flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground"
            data-testid="user-methods"
          >
            <span>{t("admin.methods")}:</span>
            {user.hasPassword && (
              <Badge variant="outline" className="type-micro" data-testid="user-method-password">
                {t("admin.methodPassword")}
              </Badge>
            )}
            {user.providers.map((provider) => (
              <span key={provider} className="inline-flex items-center gap-1" data-testid={`user-method-${provider}`}>
                <Badge variant="outline" className="type-micro">
                  {providerLabel(provider, t)}
                </Badge>
                <MutationFeedbackForm
                  action={adminDisconnectProviderAction}
                  successMessage={t("admin.providerUnlinked")}
                  errorMessage={t("feedback.error")}
                  resultMessages={{
                    unlinked: t("admin.providerUnlinked"),
                    last_method: t("account.errorLastMethod"),
                    not_linked: t("account.errorNotLinked"),
                    no_account: t("account.errorNotLinked"),
                  }}
                  dismissLabel={t("feedback.dismiss")}
                  className="inline"
                >
                  <input type="hidden" name="userId" value={user.id} />
                  <input type="hidden" name="provider" value={provider} />
                  <button
                    type="submit"
                    className="min-h-11 cursor-pointer underline-offset-2 hover:underline xl:min-h-0"
                    data-testid={`user-disconnect-${provider}`}
                  >
                    {t("admin.disconnectProvider", { provider: providerLabel(provider, t) })}
                  </button>
                </MutationFeedbackForm>
              </span>
            ))}
            {!user.hasPassword && user.providers.length === 0 && <span>{t("admin.methodNone")}</span>}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Papéis viraram leitura aqui. Editar mora na modal desde que o
                e-mail e o nome entraram: três campos abertos vezes o número de
                contas seria uma tela impossível de ler. */}
            <p className="type-body-sm flex flex-wrap items-center gap-1.5 text-muted-foreground">
              {user.roles.map((role) => (
                <Badge key={role} variant="outline" className="type-micro">
                  {t(ROLE_LABEL[role])}
                </Badge>
              ))}
            </p>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto min-h-11 xl:h-7 xl:min-h-0"
              popoverTarget={`user-edit-${user.id}`}
              popoverTargetAction="show"
              data-testid="user-edit-open"
            >
              {t("admin.edit")}
            </Button>

            <MutationFeedbackForm
              action={toggleDisabledAction}
              successMessage={t("feedback.success")}
              errorMessage={t("feedback.error")}
              dismissLabel={t("feedback.dismiss")}
            >
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="disable" value={disabled ? "0" : "1"} />
              <Button type="submit" size="sm" variant="outline" className="min-h-11 xl:h-7 xl:min-h-0">
                {disabled ? t("admin.enable") : t("admin.disable")}
              </Button>
            </MutationFeedbackForm>

            {/* Assumir a si mesmo não faz sentido e o caso de uso recusa; o
                botão some para não oferecer o que não funciona. */}
            {!isSelf && !disabled && (
              <MutationFeedbackForm
                action={impersonateAction}
                successMessage={t("feedback.success")}
                errorMessage={t("feedback.error")}
                dismissLabel={t("feedback.dismiss")}
              >
                <input type="hidden" name="userId" value={user.id} />
                <Button type="submit" size="sm" className="min-h-11 xl:h-7 xl:min-h-0" data-testid="impersonate-user">
                  {t("admin.impersonate")}
                </Button>
              </MutationFeedbackForm>
            )}

            {/* Apagar a si mesmo derrubaria a sessão que executa a ação. A
                ação recusa de qualquer jeito; o botão some para não oferecer o
                que não funciona, igual ao de assumir identidade. */}
            {!isSelf && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="min-h-11 xl:h-7 xl:min-h-0"
                popoverTarget={`user-delete-${user.id}`}
                popoverTargetAction="show"
                data-testid="user-delete-open"
              >
                {t("admin.delete")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <EditUserModal user={user} t={t} />
      {!isSelf && <DeleteUserModal user={user} t={t} />}
    </li>
  );
}
