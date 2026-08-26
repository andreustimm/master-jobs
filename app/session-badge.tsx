import { isOpenMode } from "../src/contexts/auth/index.ts";
import { currentSession } from "./auth";
import { getTranslator } from "./i18n";
import { logoutAction } from "./logout-action";
import { MutationFeedbackForm } from "./mutation-feedback";
import { TransitionLink } from "./transition-link";

/**
 * Who you are, and under which mode.
 *
 * Exists because the honest answer to "is auth working?" in single-user mode is
 * "yes, and it deliberately does not ask you for anything" — which is
 * indistinguishable from "no" unless the UI says so.
 */
export async function SessionBadge() {
  const open = isOpenMode();
  const session = await currentSession();
  const { t } = await getTranslator();

  if (open) {
    // Avisa, e avisa em cor de alerta: o modo aberto expõe currículo, funil e
    // export a qualquer requisição que alcance o servidor.
    return (
      <span
        className="type-micro rounded-full border border-[var(--bad)] px-2 py-0.5 text-[var(--bad)]"
        title={t("nav.unprotectedTitle")}
      >
        {t("nav.unprotected")}
      </span>
    );
  }

  if (!session) {
    return (
      <TransitionLink href="/login" className="type-micro text-[var(--primary-text)] hover:underline">
        {t("nav.signIn")}
      </TransitionLink>
    );
  }

  return (
    <MutationFeedbackForm
      action={logoutAction}
      successMessage={t("feedback.success")}
      errorMessage={t("feedback.error")}
      dismissLabel={t("feedback.dismiss")}
      className="flex items-center gap-2"
    >
      {/* O nome, e o e-mail só quando não há nome.
          Tratar a pessoa pelo nome é o padrão; o e-mail é a identificação da
          conta, não como alguém se chama. A queda para o e-mail não é detalhe:
          toda conta criada antes da coluna `full_name` existir tem nulo aqui, e
          sem a queda o topo ficaria vazio para elas.

          O endereço inteiro estoura uma tela de 375px junto com o botão de
          aparência. Some no celular: quem está logado sabe quem é, e o botão
          de sair é o que precisa estar ao alcance. */}
      <span
        data-user-content
        className="hidden max-w-[24ch] truncate type-micro text-muted-foreground sm:inline"
        title={session.fullName ?? session.email}
      >
        {session.fullName ?? session.email}
      </span>
      <button
        type="submit"
        data-testid="sign-out"
        className="type-micro text-[var(--primary-text)] hover:underline"
      >
        {t("nav.signOut")}
      </button>
    </MutationFeedbackForm>
  );
}
