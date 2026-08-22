import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A navegação em duas larguras.
 *
 * ## O defeito
 *
 * A fileira de links rolava na horizontal com a barra de rolagem escondida. Num
 * aparelho de 375px — depois da marca, do seletor de idioma, do de aparência e
 * do estado da sessão — sobrava espaço para UM link, e nada indicava que havia
 * mais. Quem olhava concluía que o menu tinha sumido, e estava certo do ponto de
 * vista que importa: o que não se vê e não se anuncia não existe.
 *
 * ## O que estes casos protegem
 *
 * Não a aparência — largura de tela não se mede em teste de nó. O que se afirma
 * é a **fonte única**: os dois menus renderizam o mesmo componente, então um
 * link novo entra nos dois ou em nenhum. Duplicar a lista era o desenho óbvio, e
 * o modo de falhar dele é silencioso: a rota nova aparece no desktop, some no
 * celular, e ninguém repara porque quem desenvolve olha no desktop.
 *
 * Também protege a separação feita em ADR-002: `MobileNav` é o único client
 * component da navegação (fecha o popover ao navegar), e `NavLinks` — usado na
 * fileira desktop — permanece server, sem `"use client"`.
 */

const layout = readFileSync("app/layout.tsx", "utf8");
const navLinks = readFileSync("app/nav-links.tsx", "utf8");
const mobileNav = readFileSync("app/mobile-nav.tsx", "utf8");

/**
 * O arquivo sem comentários.
 *
 * Necessário, e não zelo: a primeira versão do caso do `<details>` reprovou
 * porque o comentário que EXPLICA por que ele não foi usado contém a palavra.
 * Um teste que lê prosa afirma sobre o texto, não sobre o comportamento — e
 * seria contornável apagando a explicação, que é o pior incentivo possível.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const navLinksCodigo = semComentarios(navLinks);
const mobileNavCodigo = semComentarios(mobileNav);

/** As rotas que o menu oferece. */
const ROTAS = ["/jobs", "/compare", "/pipeline", "/referrals", "/candidate", "/admin/users"];

describe("os links moram num lugar só", () => {
  it("todas as rotas do menu estão em nav-links.tsx", () => {
    for (const rota of ROTAS) {
      expect(navLinks).toContain(`href="${rota}"`);
    }
  });

  it("o layout NÃO tem link de navegação próprio", () => {
    // A garantia de que os dois menus não podem divergir. Se alguém acrescentar
    // uma rota direto no layout, ela aparece na fileira e não no menu do
    // celular — e este caso reprova antes disso chegar em alguém.
    for (const rota of ROTAS) {
      expect(layout).not.toContain(`href="${rota}"`);
    }
  });

  it("os dois menus usam o mesmo componente", () => {
    // `NavLinks` na fileira, `MobileNav` no celular — e `MobileNav` renderiza
    // `NavLinks` por dentro. O layout importa os dois de arquivos distintos
    // desde a ADR-002.
    expect(layout).toContain("<NavLinks");
    expect(layout).toContain("<MobileNav");
    expect(mobileNav).toContain("<NavLinks");
  });
});

describe("cada menu aparece na sua largura", () => {
  it("a fileira é escondida no celular e mostrada a partir de `sm`", () => {
    expect(layout).toContain("hidden min-w-0 flex-1 items-center gap-5 overflow-x-auto sm:flex");
  });

  it("o botão e o menu do celular somem a partir de `sm`", () => {
    // Sem isto, os dois menus apareceriam juntos no desktop.
    const botao = mobileNav.slice(mobileNav.indexOf("popoverTargetAction=\"show\""));
    expect(botao).toContain("sm:hidden");
    expect(mobileNav.match(/sm:hidden/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("o menu fecha ao navegar, e só ele vira client", () => {
  it("usa popover nativo, como o resto do sistema", () => {
    // Mesma escolha do modal de vaga e do rodapé: o navegador cuida de abrir,
    // fechar no Escape, dispensar por clique fora e camada de topo.
    expect(mobileNav).toContain('popover="auto"');
    expect(mobileNav).toContain("popoverTarget=");
  });

  it("fecha por event delegation no clique do `<nav>`", () => {
    // ADR-002: um único `onClick` no wrapper fecha o popover com `hidePopover`,
    // cobrindo todos os itens sem interceptar a navegação.
    expect(mobileNav).toContain("onClick=");
    expect(mobileNav).toContain("hidePopover");
  });

  it("não chama `preventDefault` — a navegação SPA segue intacta", () => {
    expect(mobileNav).not.toContain("preventDefault");
  });

  it("`MobileNav` é client, mas `NavLinks` (fileira) continua server", () => {
    // A separação da ADR-002: o fechamento exige script, e o custo fica
    // isolado no menu. A fileira desktop não pode entrar no bundle de cliente.
    expect(mobileNav).toContain('"use client"');
    expect(navLinksCodigo).not.toContain('"use client"');
  });

  it("não usa `details`, que não fecha ao clicar fora", () => {
    // Funcionaria sem script, e deixaria o menu aberto por cima do conteúdo
    // depois que a pessoa desistiu dele — pior que o problema original.
    //
    // Sobre o CÓDIGO, não sobre o arquivo: o comentário que explica esta escolha
    // menciona `details`, e a primeira versão deste caso reprovou por causa
    // disso. Um teste que lê prosa se contorna apagando a explicação.
    expect(mobileNavCodigo).not.toContain("<details");
  });

  it("o alvo de toque do botão não é só o ícone", () => {
    // `py-2.5`, igual aos links da fileira: o ícone sozinho daria uma área
    // menor que o mínimo confortável no celular.
    expect(mobileNav).toContain("py-2.5");
  });
});
