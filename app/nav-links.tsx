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

/**
 * O menu do celular.
 *
 * ## O defeito que isto corrige
 *
 * A barra de links rolava na horizontal com a barra de rolagem escondida. Num
 * aparelho de 375px, depois da marca, do idioma, da aparência e do estado da
 * sessão, sobrava espaço para **um** link — e nada indicava que havia mais.
 * Quem olhava concluía que o menu tinha sumido, e estava certo do ponto de vista
 * que importa: o que não se vê e não se anuncia não existe.
 *
 * ## Popover, como o resto do sistema
 *
 * Mesmo mecanismo do modal de vaga e do rodapé: o navegador cuida de abrir,
 * fechar no Escape, dispensar por clique fora e camada de topo. Zero JavaScript
 * enviado, que é a invariante desta árvore.
 *
 * `<details>` também funcionaria sem script, mas não fecha ao clicar fora — um
 * menu que fica aberto por cima do conteúdo depois que a pessoa desistiu dele é
 * pior que o problema original.
 */
export function MobileNav({
  hasCandidateScope,
  isAdmin,
  rotulo,
  t,
}: {
  hasCandidateScope: boolean;
  isAdmin: boolean;
  rotulo: string;
  t: Translator["t"];
}) {
  const id = "menu-mobile";

  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        popoverTargetAction="show"
        aria-label={rotulo}
        // `py-2.5` pelo alvo de toque, igual aos links da barra larga: o ícone
        // sozinho daria uma área menor que o mínimo confortável no celular.
        className="flex shrink-0 items-center gap-1.5 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:hidden"
      >
        {/* Três traços desenhados em CSS. Um SVG aqui seria mais markup para o
            mesmo desenho, e o ícone precisa acompanhar `currentColor`. */}
        <span aria-hidden="true" className="relative flex h-4 w-5 flex-col justify-between">
          <span className="block h-0.5 w-full rounded-full bg-current" />
          <span className="block h-0.5 w-full rounded-full bg-current" />
          <span className="block h-0.5 w-full rounded-full bg-current" />
        </span>
      </button>

      <div
        id={id}
        popover="auto"
        // Ancorado no topo e ocupando a largura: um menu estreito no canto
        // obrigaria a mirar, e mirar num celular é o que produz toque errado.
        className="m-0 mt-14 w-full max-w-none rounded-none border-b border-[var(--color-hairline)] bg-card p-0 text-card-foreground backdrop:bg-black/40 sm:hidden"
      >
        <nav className="grid px-4 py-2">
          <NavLinks
            hasCandidateScope={hasCandidateScope}
            isAdmin={isAdmin}
            // Linha inteira clicável, e não só o texto: num menu vertical o alvo
            // é a linha, e um `py-3` generoso é o que separa item de item no
            // toque.
            linkClass="flex items-center border-b border-[var(--color-hairline)] py-3 text-sm text-muted-foreground transition-colors last:border-b-0 hover:text-foreground"
            t={t}
          />
        </nav>
      </div>
    </>
  );
}
