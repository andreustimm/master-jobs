import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  HEADLESS_UA,
  isHeadlessUA,
  renderSplashCSS,
  renderSplashHTML,
  renderSplashScript,
  SPLASH_FADE_MS,
  SPLASH_HIDDEN_CLASS,
  SPLASH_MAX_MS,
  SPLASH_MIN_MS,
  SPLASH_ROOT_ID,
  TRANSITION_SPLASH_ROOT_ID,
} from "../src/core/pwa/splash.ts";
import { TRANSITION_MIN_MS, TRANSITION_PROLONGED_MS } from "../src/core/pwa/transition.ts";
import { isStandalone, renderStandaloneScript, STANDALONE_CLASS } from "../src/core/pwa/standalone.ts";

/**
 * A moldura de PWA: área segura e tela de abertura.
 *
 * ## O que dá para testar aqui, e o que não dá
 *
 * Os dois módulos produzem **texto** — HTML, CSS e um script que só roda no
 * navegador. Executar esse script exigiria um DOM falso, e o que se provaria
 * seria o comportamento do dublê, não o do aparelho. Então o que se afirma é o
 * contrato do texto gerado: os seletores existem, as durações batem entre o
 * script e o CSS, e os caminhos de saída estão todos escritos.
 *
 * A parte que ninguém testa daqui é a que só o celular responde: se o padding
 * de área segura de fato desce o cabeçalho abaixo do relógio. Isso se confere
 * com o aparelho na mão, e é onde o defeito apareceu.
 *
 * `isStandalone` é a exceção: é lógica pura, recebe as fontes por parâmetro, e
 * cada combinação é exercitada de verdade.
 */

describe("modo instalado", () => {
  it("reserva a área segura só no cabeçalho da aplicação", () => {
    const css = readFileSync("app/globals.css", "utf8");

    // Um seletor global de `header` também zera o padding-top dos cabeçalhos
    // de página e das modais quando o Android abre em `minimal-ui`.
    expect(css).toContain("html.pwa-standalone #application-shell > header {");
    expect(css).toContain("html.pwa-standalone #application-shell > header > div,");
    expect(css).not.toMatch(/html\.pwa-standalone header\s*\{/);
    expect(css).not.toMatch(/html\.pwa-standalone header\s*>\s*div/);
  });

  it("iOS antigo é reconhecido por navigator.standalone", () => {
    // Aparelho da era em que `display-mode` ainda não existia. Sem este ramo,
    // o app instalado no iPhone antigo ficaria com o conteúdo sob a barra.
    expect(isStandalone({ navigatorStandalone: true })).toBe(true);
  });

  it("os três display-modes contam como instalado", () => {
    for (const modo of ["standalone", "minimal-ui", "fullscreen"]) {
      const matchMedia = (q: string) => ({ matches: q.includes(modo) });
      expect(isStandalone({ matchMedia })).toBe(true);
    }
  });

  it("navegador comum não é instalado", () => {
    // O ramo que importa mais: um falso positivo aqui põe padding de área
    // segura numa aba de navegador, que já reserva o espaço — e o resultado é
    // uma faixa vazia no topo de toda página.
    expect(isStandalone({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it("sem matchMedia e sem navigator.standalone, assume navegador", () => {
    // Ambiente sem as duas fontes. Assumir instalado seria escolher o defeito
    // visível; assumir navegador é a opção que não estraga nada.
    expect(isStandalone({})).toBe(false);
  });

  it("o script marca o html com a classe que o CSS espera", () => {
    const script = renderStandaloneScript();

    expect(script).toContain(JSON.stringify(STANDALONE_CLASS));
    expect(script).toContain("document.documentElement.classList.add");
    // Envolto em try: `matchMedia` ausente não pode derrubar o documento. O
    // custo de falhar aqui é o padding não aparecer; o de estourar é a página
    // em branco.
    expect(script).toContain("try{");
    expect(script).toContain("catch(e){}");
  });
});

describe("tela de abertura", () => {
  it("o HTML carrega o rótulo traduzido e não a marca no leitor de tela", () => {
    const html = renderSplashHTML("Carregando o Master Jobs");

    expect(html).toContain(`id="${SPLASH_ROOT_ID}"`);
    expect(html).toContain('aria-label="Carregando o Master Jobs"');
    // Quem usa leitor recebe "carregando" uma vez, e não marca + ícone +
    // girador em sequência.
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("reaproveita o ícone do manifest em vez de pedir outro arquivo", () => {
    // Uma requisição a mais bem no momento em que a página tenta aparecer é o
    // oposto do que a splash existe para resolver.
    expect(renderSplashHTML("x")).toContain("/icons/icon-192.png");
  });

  it("o CSS cobre a tela inteira, respeita a área segura e some pela classe", () => {
    const css = renderSplashCSS();

    expect(css).toContain(`#${SPLASH_ROOT_ID}{position:fixed;inset:0`);
    // A splash também fica sob o recorte: sem isto o ícone nasceria centrado
    // numa área que exclui o topo, e saltaria ao sair.
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain(`.${SPLASH_HIDDEN_CLASS}{opacity:0`);
  });

  it("a duração do fade é a mesma no CSS e no script", () => {
    // Se divergirem, o elemento sai do DOM antes de terminar de desaparecer —
    // um corte seco no lugar da transição. É o tipo de defeito que só aparece
    // em rede rápida.
    expect(renderSplashCSS()).toContain(`${SPLASH_FADE_MS}ms`);
    expect(renderSplashScript()).toContain(`fadeMs=${SPLASH_FADE_MS}`);
  });

  it("movimento reduzido desliga a animação, sem esconder o indicador", () => {
    const css = renderSplashCSS();

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    // A barra continua visível, parada: quem pediu menos movimento ainda
    // precisa saber que algo está carregando.
    expect(css).toMatch(/prefers-reduced-motion[^}]*}[^@]*animation:none/);
  });

  it("o script tem os três caminhos de saída", () => {
    const script = renderSplashScript();

    // Documento pronto: espera o mínimo e sai.
    expect(script).toContain(`minMs=${SPLASH_MIN_MS}`);
    expect(script).toContain("DOMContentLoaded");
    // Teto absoluto: rede pendurada ou listener que nunca dispara não podem
    // deixar a splash presa para sempre.
    expect(script).toContain(`setTimeout(tirar,maxMs)`);
    expect(script).toContain(`maxMs=${SPLASH_MAX_MS}`);
    // Guarda contra os três dispararem juntos — o documento pode ficar pronto
    // no mesmo quadro em que o teto vence.
    expect(script).toContain("if(removida)return;removida=true");
  });

  it("o script também remove a splash se ele próprio estourar", () => {
    const script = renderSplashScript();
    const catchBlock = script.slice(script.lastIndexOf("catch(e)"));

    // O último recurso. Um erro dentro do próprio script deixaria a tela
    // coberta permanentemente — pior que nunca ter tido splash.
    expect(catchBlock).toContain("removeChild");
  });

  it("navegador de automação não vê a splash", () => {
    for (const ua of ["HeadlessChrome/120", "Playwright/1.4", "jsdom/22", "Cypress"]) {
      expect(isHeadlessUA(ua)).toBe(true);
    }
    // Sem esta saída, todo teste de ponta a ponta passaria os primeiros 900ms
    // clicando no que está atrás da splash.
    expect(renderSplashScript()).toContain(HEADLESS_UA.toString());
  });

  it("navegador de gente não cai no ramo de automação", () => {
    const chrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
    expect(isHeadlessUA(chrome)).toBe(false);
    expect(isHeadlessUA("")).toBe(false);
  });

  it("a duração mínima é menor que o teto", () => {
    // Invertidos, a splash sairia pelo teto antes do mínimo e o mínimo nunca
    // teria efeito — a aritmética some sem nenhum sintoma visível.
    expect(SPLASH_MIN_MS).toBeLessThan(SPLASH_MAX_MS);
    expect(SPLASH_FADE_MS).toBeLessThan(SPLASH_MIN_MS);
  });

  it("UT-031 compartilha semântica, safe areas, contenção e redução de movimento", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const transition = css.slice(css.indexOf(".navigation-transition {"));

    for (const token of ["--background", "--foreground", "--primary", "--safe-area-top"]) {
      expect(transition).toContain(`var(${token})`);
    }
    expect(transition).toContain("overflow-wrap: anywhere");
    expect(transition).toContain("min-block-size: 100dvh");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*navigation-transition[\s\S]*animation: none/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*navigation-transition[\s\S]*transition: none/);
    expect(transition).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("UT-032 preserva o ciclo e a raiz de startup separados da transição", () => {
    const html = renderSplashHTML("x");
    const rootMatches = html.match(new RegExp(`id="${SPLASH_ROOT_ID}"`, "g")) ?? [];

    expect(SPLASH_MIN_MS).toBe(900);
    expect(TRANSITION_MIN_MS).toBe(180);
    expect(TRANSITION_PROLONGED_MS).toBe(3000);
    expect(TRANSITION_SPLASH_ROOT_ID).not.toBe(SPLASH_ROOT_ID);
    expect(rootMatches).toHaveLength(1);
    expect(renderSplashScript()).toContain(HEADLESS_UA.toString());
  });
});
