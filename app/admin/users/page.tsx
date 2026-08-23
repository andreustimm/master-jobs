import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  listUsers,
  recruiterLinks,
  ROLES,
  type Role,
  type UserSummary,
} from "../../../src/contexts/auth/index.ts";
import type { TranslationKey, Translator } from "../../../src/core/i18n/index.ts";
import { requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import {
  createUserAction,
  impersonateAction,
  toggleDisabledAction,
  unlinkAction,
} from "../actions";
import { DeleteUserModal, EditUserModal } from "../user-modal";

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

export default async function AdminUsersPage() {
  const { t, locale } = await getTranslator();
  // Guard antes de ler qualquer coisa. `user:manage` só existe para admin, e
  // uma sessão emprestada perde a ação em bloco.
  const session = await requirePage("user:manage");

  const users = await listUsers();
  const links = new Map<number, { id: number; candidateId: number }[]>();
  for (const user of users) {
    if (user.roles.includes("recruiter")) links.set(user.id, await recruiterLinks(user.id));
  }

  return (
    <main className="pt-10 pb-16">
      <h1 className="type-display-md chevron mb-2">{t("admin.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">{t("admin.lead")}</p>

      <Card className="mb-8">
        <CardContent className="pt-0">
          <h2 className="type-display-xs mb-3">{t("admin.newUser")}</h2>
          <form action={createUserAction} className="grid gap-3 sm:grid-cols-2">
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
          </form>
        </CardContent>
      </Card>

      <ul className="grid gap-3">
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            linked={links.get(user.id) ?? []}
            isSelf={user.id === session.userId}
            locale={locale}
            t={t}
          />
        ))}
      </ul>
    </main>
  );
}

function UserRow({
  user,
  linked,
  isSelf,
  locale,
  t,
}: {
  user: UserSummary;
  linked: { id: number; candidateId: number }[];
  isSelf: boolean;
  locale: string;
  t: Translator["t"];
}) {
  void locale;
  const disabled = user.disabledAt !== null;

  return (
    <li>
      <Card className={cn(disabled && "opacity-60")}>
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

          {linked.length > 0 && (
            <p className="type-meta flex flex-wrap items-center gap-x-2 text-muted-foreground">
              <span>{t("admin.linked")}:</span>
              {linked.map((link) => (
                <span key={link.id} className="inline-flex items-center gap-1">
                  #{link.candidateId}
                  {/* Admin revoga, mas não concede: conceder mora na área do
                      candidato, porque o vínculo dá leitura do currículo. */}
                  <form action={unlinkAction} className="inline">
                    <input type="hidden" name="linkId" value={link.id} />
                    <button type="submit" className="cursor-pointer underline-offset-2 hover:underline">
                      {t("admin.unlink")}
                    </button>
                  </form>
                </span>
              ))}
            </p>
          )}

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
              className="ml-auto h-7"
              popoverTarget={`user-edit-${user.id}`}
              popoverTargetAction="show"
              data-testid="user-edit-open"
            >
              {t("admin.edit")}
            </Button>

            <form action={toggleDisabledAction}>
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="disable" value={disabled ? "0" : "1"} />
              <Button type="submit" size="sm" variant="outline" className="h-7">
                {disabled ? t("admin.enable") : t("admin.disable")}
              </Button>
            </form>

            {/* Assumir a si mesmo não faz sentido e o caso de uso recusa; o
                botão some para não oferecer o que não funciona. */}
            {!isSelf && !disabled && (
              <form action={impersonateAction}>
                <input type="hidden" name="userId" value={user.id} />
                <Button type="submit" size="sm" className="h-7" data-testid="impersonate-user">
                  {t("admin.impersonate")}
                </Button>
              </form>
            )}

            {/* Apagar a si mesmo derrubaria a sessão que executa a ação. A
                ação recusa de qualquer jeito; o botão some para não oferecer o
                que não funciona, igual ao de assumir identidade. */}
            {!isSelf && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7"
                popoverTarget={`user-delete-${user.id}`}
                popoverTargetAction="show"
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
