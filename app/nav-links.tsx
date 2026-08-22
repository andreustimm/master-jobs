import Link from "next/link";
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
        <Link href="/" className={linkClass}>
          {t("nav.cockpit")}
        </Link>
      )}
      {hasCandidateScope && (
        <Link href="/jobs" className={linkClass}>
          {t("nav.jobs")}
        </Link>
      )}
      <Link href="/compare" className={linkClass}>
        {t("nav.compareJob")}
      </Link>
      {hasCandidateScope && (
        <Link href="/pipeline" className={linkClass}>
          {t("nav.pipeline")}
        </Link>
      )}
      {hasCandidateScope && (
        <Link href="/referrals" className={linkClass}>
          {t("nav.referrals")}
        </Link>
      )}
      {hasCandidateScope && (
        <Link href="/candidate" className={linkClass}>
          {t("nav.candidate")}
        </Link>
      )}
      {isAdmin && (
        <Link href="/admin/users" className={linkClass}>
          {t("admin.nav")}
        </Link>
      )}
    </>
  );
}
