import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ROLES, type Role, type UserSummary } from "../../src/contexts/auth/index.ts";
import type { TranslationKey, Translator } from "../../src/core/i18n/index.ts";
import { deleteUserAction, updateUserAction } from "./actions";

/**
 * Edição e exclusão de conta, em modal.
 *
 * **Popover nativo, como o modal de vaga.** Nenhum JavaScript é enviado: o
 * navegador cuida de abrir, fechar no Escape, dispensar por clique fora, foco e
 * camada de topo. É o que permite esta tela continuar sendo Server Component —
 * a alternativa seria um componente cliente com estado só para mostrar um
 * formulário, e o formulário já sabe se enviar sozinho.
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

const ROLE_LABEL = {
  admin: "admin.roleAdmin",
  candidate: "admin.roleCandidate",
  recruiter: "admin.roleRecruiter",
} as const satisfies Record<Role, TranslationKey>;

/** Mesma caixa do modal de vaga: divergir aqui faria duas modais diferentes. */
const CAIXA = cn(
  "m-auto max-h-[85dvh] w-[min(92vw,520px)] overflow-y-auto rounded-xl bg-card p-0 text-card-foreground",
  "ring-1 ring-foreground/10 backdrop:bg-black/40",
);

function BotaoFechar({ alvo, rotulo }: { alvo: string; rotulo: string }) {
  return (
    <button
      type="button"
      popoverTarget={alvo}
      popoverTargetAction="hide"
      aria-label={rotulo}
      className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted"
    >
      ×
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
  const id = `user-edit-${user.id}`;

  return (
    <div id={id} popover="auto" className={CAIXA}>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--color-hairline)] bg-card px-5 py-4">
        <div className="min-w-0">
          <h2 className="type-display-xs leading-tight">{t("admin.editTitle")}</h2>
          {/* E-mail é dado do usuário, não texto de interface. */}
          <p data-user-content className="type-body-sm mt-0.5 truncate text-muted-foreground">
            {user.email}
          </p>
        </div>
        <BotaoFechar alvo={id} rotulo={t("admin.close")} />
      </header>

      <form action={updateUserAction} className="grid gap-4 px-5 py-4">
        <input type="hidden" name="userId" value={user.id} />

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-name`}>{t("admin.fullName")}</Label>
          <Input
            id={`${id}-name`}
            name="fullName"
            type="text"
            maxLength={120}
            required
            autoComplete="off"
            defaultValue={user.fullName ?? ""}
          />
          <p className="type-meta text-muted-foreground">{t("admin.fullNameHint")}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-email`}>{t("admin.email")}</Label>
          <Input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            autoComplete="off"
            defaultValue={user.email}
          />
        </div>

        <fieldset>
          <legend className="type-micro mb-1.5 text-muted-foreground">{t("admin.roles")}</legend>
          <div className="flex flex-wrap gap-3">
            {ROLES.map((role) => (
              <label key={role} className="flex cursor-pointer items-center gap-1.5 type-body-sm">
                <input
                  type="checkbox"
                  name="roles"
                  value={role}
                  defaultChecked={user.roles.includes(role)}
                  className="cursor-pointer"
                />
                {t(ROLE_LABEL[role])}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" popoverTarget={id} popoverTargetAction="hide">
            {t("admin.cancel")}
          </Button>
          <Button type="submit">{t("admin.saveChanges")}</Button>
        </div>
      </form>
    </div>
  );
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
    <div id={id} popover="auto" className={CAIXA}>
      <header className="flex items-start justify-between gap-4 border-b border-[var(--color-hairline)] px-5 py-4">
        <div className="min-w-0">
          <h2 className="type-display-xs leading-tight">{t("admin.deleteTitle")}</h2>
          <p data-user-content className="type-body-sm mt-0.5 truncate text-muted-foreground">
            {user.fullName ?? user.email}
          </p>
        </div>
        <BotaoFechar alvo={id} rotulo={t("admin.close")} />
      </header>

      <div className="grid gap-3 px-5 py-4">
        {/* O que sobrevive está escrito antes do botão, e não depois: quem lê
            depois de clicar já não tem escolha. */}
        <p className="type-body-sm">{t("admin.deleteWarning")}</p>
        <p className="type-meta text-muted-foreground">{t("admin.deleteReversible")}</p>

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" popoverTarget={id} popoverTargetAction="hide">
            {t("admin.cancel")}
          </Button>
          <form action={deleteUserAction}>
            <input type="hidden" name="userId" value={user.id} />
            <Button type="submit" variant="destructive">
              {t("admin.deleteConfirm")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
