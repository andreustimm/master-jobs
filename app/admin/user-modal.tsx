import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { UserSummary } from "../../src/contexts/auth/index.ts";
import type { Translator } from "../../src/core/i18n/index.ts";
import { deleteUserAction } from "./actions";
import { EditUserForm, type UserEditLabels } from "./edit-user-form";
import { USER_MODAL_BOX } from "./user-modal-styles";

/**
 * Edição e exclusão de conta, em modal.
 *
 * **Popover nativo, como o modal de vaga.** O navegador continua responsável
 * por Escape, clique fora, foco e camada de topo. Só a edição é uma pequena
 * ilha cliente: ela precisa esperar a Server Action, fechar apenas no sucesso e
 * anunciar o resultado. A confirmação de exclusão permanece sem estado local.
 *
 * **Por que a edição vive numa modal e não na linha.** A linha já tinha os
 * papéis inline, e ficou desse jeito enquanto papel era a única coisa editável.
 * Com e-mail e nome entrando, editar na linha significaria três campos abertos
 * vezes o número de contas — uma tela que grita. A modal também dá o que a
 * edição inline não dava: um lugar para o rótulo e a dica de cada campo.
 *
 * **Por que a exclusão tem confirmação própria.** É a única ação irreversível
 * desta tela, e um clique só a separaria de um engano. A confirmação é outro
 * popover em vez de `confirm()` porque diálogo do navegador trava a página e
 * não cabe texto explicando o que sobrevive à exclusão — que é justamente o que
 * alguém precisa ler antes de decidir.
 */

function BotaoFechar({ alvo, rotulo }: { alvo: string; rotulo: string }) {
  return (
    <button
      type="button"
      popoverTarget={alvo}
      popoverTargetAction="hide"
      aria-label={rotulo}
      className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-action)] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--primary-text)]"
    >
      <X aria-hidden="true" className="size-5" />
    </button>
  );
}

export function EditUserModal({
  user,
  t,
}: {
  user: UserSummary;
  t: Translator["t"];
}) {
  const labels: UserEditLabels = {
    title: t("admin.editTitle"),
    close: t("admin.close"),
    email: t("admin.email"),
    fullName: t("admin.fullName"),
    fullNameHint: t("admin.fullNameHint"),
    roles: t("admin.roles"),
    roleLabels: {
      admin: t("admin.roleAdmin"),
      candidate: t("admin.roleCandidate"),
      recruiter: t("admin.roleRecruiter"),
    },
    cancel: t("admin.cancel"),
    save: t("admin.saveChanges"),
    saving: t("admin.savingChanges"),
    success: t("admin.saveSuccess"),
    dismissNotification: t("admin.dismissNotification"),
    errors: {
      invalidEmail: t("admin.errorInvalidEmail"),
      nameRequired: t("admin.errorNameRequired"),
      rolesRequired: t("admin.errorRolesRequired"),
      lastAdmin: t("admin.errorLastAdmin"),
      unexpected: t("admin.errorUnexpected"),
    },
  };

  return <EditUserForm user={user} labels={labels} />;
}

export function DeleteUserModal({
  user,
  t,
}: {
  user: UserSummary;
  t: Translator["t"];
}) {
  const id = `user-delete-${user.id}`;

  return (
    <div id={id} popover="auto" className={USER_MODAL_BOX}>
      <header className="flex items-start justify-between gap-4 border-b border-[var(--hairline)] px-5 py-6">
        <div className="min-w-0">
          <h2 className="type-display-xs leading-tight">{t("admin.deleteTitle")}</h2>
          <p data-user-content className="type-caption-sm mt-1 truncate text-muted-foreground">
            {user.fullName ?? user.email}
          </p>
        </div>
        <BotaoFechar alvo={id} rotulo={t("admin.close")} />
      </header>

      <div className="grid gap-3 px-5 py-4">
        {/* O que sobrevive está escrito antes do botão, e não depois: quem lê
            depois de clicar já não tem escolha. */}
        <p className="type-caption-sm">{t("admin.deleteWarning")}</p>
        <p className="type-meta text-muted-foreground">{t("admin.deleteReversible")}</p>

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" popoverTarget={id} popoverTargetAction="hide" className="min-h-11">
            {t("admin.cancel")}
          </Button>
          <form action={deleteUserAction}>
            <input type="hidden" name="userId" value={user.id} />
            <Button type="submit" variant="destructive" className="min-h-11">
              {t("admin.deleteConfirm")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
