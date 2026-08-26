"use client";

import { useEffect } from "react";
import { NavLinks } from "./nav-links";
import { translator, type LocaleId } from "../src/core/i18n/index.ts";

const id = "menu-mobile";
const HEADER_SELECTOR = "#application-shell > header";

/**
 * Escolhe a navegação pela largura que realmente sobra na barra. Um monitor
 * estreito e uma janela de tablet podem cair no mesmo caso; um breakpoint pelo
 * nome do dispositivo não consegue distinguir isso e cria um clique extra.
 */
function updateNavigationMode() {
  const header = document.querySelector<HTMLElement>(HEADER_SELECTOR);
  const row = header?.firstElementChild as HTMLElement | null;
  const nav = row?.querySelector<HTMLElement>("[data-responsive-nav]");
  const brand = row?.querySelector<HTMLElement>(":scope > [data-nav-brand]");
  const controls = row?.querySelector<HTMLElement>("[data-header-controls]");
  if (!header || !row || !nav || !brand || !controls) return;

  // Quando o modo compacto está ativo, a fileira fica `display: none`. Um
  // clone absoluto permite medir a largura natural de todos os links sem
  // alternar o layout visível e sem causar um flash ao girar o aparelho.
  const probe = nav.cloneNode(true) as HTMLElement;
  probe.removeAttribute("data-responsive-nav");
  Object.assign(probe.style, {
    position: "absolute",
    insetInlineStart: "0",
    insetBlockStart: "0",
    display: "flex",
    flex: "none",
    inlineSize: "max-content",
    minInlineSize: "max-content",
    maxInlineSize: "none",
    overflow: "visible",
    visibility: "hidden",
    pointerEvents: "none",
  });
  row.append(probe);
  const naturalNavWidth = probe.getBoundingClientRect().width;
  probe.remove();

  const rowStyle = getComputedStyle(row);
  const rowPadding =
    Number.parseFloat(rowStyle.paddingLeft) + Number.parseFloat(rowStyle.paddingRight);
  const gap = Number.parseFloat(rowStyle.columnGap || rowStyle.gap || "0");
  const availableNavWidth =
    row.clientWidth -
    rowPadding -
    brand.getBoundingClientRect().width -
    controls.getBoundingClientRect().width -
    gap * 2;
  const nextMode = naturalNavWidth <= availableNavWidth + 1 ? "full" : "compact";

  if (header.dataset.navMode === nextMode) return;
  header.dataset.navMode = nextMode;
  if (nextMode === "full") document.getElementById(id)?.hidePopover?.();
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
 * fechar no Escape, dispensar por clique fora e camada de topo.
 *
 * ## Por que este é o ÚNICO client component da navegação
 *
 * O popover nativo não fecha quando um link dispara navegação SPA: o clique
 * acontece dentro do popover, então não é light dismiss. Fechar ao navegar exige
 * um script de cliente — a exceção mínima à invariante "zero JavaScript" desta
 * árvore, decidida no ADR-001. O fechamento é por event delegation: um único
 * `onClick` no `<nav>` fecha o popover, cobrindo todos os itens sem interceptar
 * a navegação (o `Link` do Next.js segue fazendo SPA normalmente).
 *
 * `NavLinks` continua server em `nav-links.tsx` — a fileira do desktop não
 * entra no bundle de cliente por causa deste menu.
 */
export function MobileNav({
  hasCandidateScope,
  isAdmin,
  rotulo,
  locale,
}: {
  hasCandidateScope: boolean;
  isAdmin: boolean;
  rotulo: string;
  locale: LocaleId;
}) {
  // `t` nasce AQUI, no cliente. Uma função vinda do server como prop não
  // serializa na fronteira server→client (500 na hidratação) — por isso o
  // layout passa o `locale` (string) e o tradutor é construído deste lado.
  const { t } = translator(locale);

  // Fecha o popover no mesmo gesto do clique. `?.` porque um navegador sem a
  // API não pode derrubar a navegação: sem fechamento, mas sem erro.
  function fechar() {
    document.getElementById(id)?.hidePopover?.();
  }

  /**
   * The header gains the safe-area inset when the app is installed. A hard-coded
   * offset would therefore open the popover through the lower half of the header
   * on portrait devices. Measuring the header (rather than the centered trigger,
   * which is shorter than the row) keeps the menu directly below the real header
   * in both browser and standalone mode.
   */
  function posicionar() {
    const header = document.querySelector<HTMLElement>(HEADER_SELECTOR);
    const panel = document.getElementById(id);
    if (!header || !panel) return;

    const top = Math.ceil(header.getBoundingClientRect().bottom);
    panel.style.setProperty("--mobile-nav-top", `${top}px`);
    panel.style.marginTop = "0px";
  }

  // A rotação dispara `resize`, mas alguns WebKit antigos só emitem
  // `orientationchange`. Recalcular enquanto o popover continua aberto evita
  // que ele fique preso à altura do cabeçalho da orientação anterior.
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(HEADER_SELECTOR);
    const row = header?.firstElementChild;
    if (!header || !row) return;

    updateNavigationMode();
    const observer = new ResizeObserver(updateNavigationMode);
    observer.observe(row);
    document.fonts?.ready.then(updateNavigationMode);
    const reposicionarSeAberto = () => {
      const panel = document.getElementById(id);
      if (panel?.matches(":popover-open")) posicionar();
    };
    window.addEventListener("resize", reposicionarSeAberto);
    window.addEventListener("orientationchange", reposicionarSeAberto);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposicionarSeAberto);
      window.removeEventListener("orientationchange", reposicionarSeAberto);
    };
  }, [locale]);

  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        popoverTargetAction="toggle"
        onClick={posicionar}
        data-testid="mobile-nav-trigger"
        data-responsive-mobile-nav-trigger
        aria-label={rotulo}
        // `py-2.5` pelo alvo de toque, igual aos links da barra larga: o ícone
        // sozinho daria uma área menor que o mínimo confortável no celular.
        className="responsive-mobile-nav-trigger flex shrink-0 items-center gap-1.5 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
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
        data-testid="mobile-nav-popover"
        data-responsive-mobile-nav-popover
        // Ancorado no topo e ocupando a largura: um menu estreito no canto
        // obrigaria a mirar, e mirar num celular é o que produz toque errado.
        className="responsive-mobile-nav-popover w-full max-w-none rounded-none border-b border-[var(--color-hairline)] bg-card p-0 text-card-foreground backdrop:bg-black/40"
      >
        <nav className="grid px-4 py-2" onClick={fechar}>
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
