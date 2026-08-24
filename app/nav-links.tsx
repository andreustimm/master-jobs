import { TransitionLink } from "./transition-link";
import type { Translator } from "../src/core/i18n/index.ts";

/**
 * Os links de navegação, escritos uma vez e usados em dois lugares.
 *
 * ## Por que um componente, e não um array com `map`
 *
 * `typedRoutes` valida cada `href` contra a árvore real de rotas, em tempo de
 * compilação. Uma união mapeada — `LINKS.map(l => <Link href={l.href}>)` —
 * transforma o literal numa `string` e **anula a checagem**: a rota renomeada
 * passaria a compilar e quebraria só no clique.
 *
 * Então os `Link` ficam literais aqui dentro, e quem precisa deles chama o
 * componente. A barra larga e o menu do celular mostram exatamente o mesmo
 * conjunto, porque é o mesmo código — que era o defeito de duplicar a lista:
 * um link novo entraria num lugar e não no outro.
 */
export function NavLinks({
  hasCandidateScope,
  isAdmin,
  linkClass,
  t,
}: {
  hasCandidateScope: boolean;
  isAdmin: boolean;
  linkClass: string;
  t: Translator["t"];
}) {
  return (
    <>
      {hasCandidateScope && (
        <TransitionLink href="/" className={linkClass} data-testid="nav-cockpit">
          {t("nav.cockpit")}
        </TransitionLink>
      )}
      {hasCandidateScope && (
        <TransitionLink href="/jobs" className={linkClass} data-testid="nav-jobs">
          {t("nav.jobs")}
        </TransitionLink>
      )}
      <TransitionLink href="/compare" className={linkClass} data-testid="nav-compare">
        {t("nav.compareJob")}
      </TransitionLink>
      {hasCandidateScope && (
        <TransitionLink href="/pipeline" className={linkClass} data-testid="nav-pipeline">
          {t("nav.pipeline")}
        </TransitionLink>
      )}
      {hasCandidateScope && (
        <TransitionLink href="/referrals" className={linkClass} data-testid="nav-referrals">
          {t("nav.referrals")}
        </TransitionLink>
      )}
      {hasCandidateScope && (
        <TransitionLink href="/candidate" className={linkClass} data-testid="nav-candidate">
          {t("nav.candidate")}
        </TransitionLink>
      )}
      {isAdmin && (
        <TransitionLink href="/admin/users" className={linkClass} data-testid="nav-admin-users">
          {t("admin.nav")}
        </TransitionLink>
      )}
    </>
  );
}
