/**
 * Tela de abertura, inline, sem JavaScript de aplicação.
 *
 * ## O problema
 *
 * Recarregar a página mostrava fundo branco até a folha de estilo e a fonte
 * chegarem. Num app instalado isso é pior que no navegador: a splash nativa do
 * sistema some, entrega uma tela vazia, e só então o conteúdo aparece. O
 * intervalo é curto e é justamente o que faz um app parecer improvisado.
 *
 * ## Por que inline, e não um componente
 *
 * O HTML e o CSS vão dentro do documento, então a tela existe **antes** de
 * qualquer requisição de estilo ou script. Um componente React só apareceria
 * depois do bundle — ou seja, depois exatamente do intervalo que ele deveria
 * cobrir.
 *
 * ## A diferença para o desenho de onde isto veio
 *
 * O sistema de referência usa um componente cliente que chama
 * `window.__pwaSplashRemove()` quando o React hidrata, com o script inline como
 * plano B. Aqui não há plano A: **toda página é Server Component e o dashboard
 * não envia bundle de aplicação**, que é a invariante em que o modal de vaga se
 * apoia. Então o script inline é o mecanismo único, e `DOMContentLoaded` é o
 * sinal — ele dispara quando o documento está pronto, que é tudo o que existe
 * para esperar quando não há hidratação.
 *
 * ## Os três tempos
 *
 * - **Mínimo.** Sem ele, numa rede rápida a tela pisca: aparece e some no mesmo
 *   quadro, o que incomoda mais que a espera que ela evita.
 * - **Máximo.** Rede pendurada, `DOMContentLoaded` que não chega, script que
 *   estoura antes do listener: em qualquer um desses a splash ficaria para
 *   sempre. O teto transforma um app quebrado num app lento.
 * - **Fade.** A remoção instantânea produz um corte; a transição costura o
 *   fim da splash com o começo do conteúdo.
 */

export const SPLASH_ROOT_ID = "app-splash";

/** Identifies the startup element whose parser-executed removal timer is live. */
export const SPLASH_REFERENCE_KEY = "__masterJobsStartupSplash";

export function removeInertSplashDuplicates(
  splashes: Iterable<HTMLElement>,
  registeredSplash: HTMLElement | null | undefined,
): void {
  for (const splash of splashes) {
    if (splash !== registeredSplash) splash.remove();
  }
}

/** Separate identity for the client-side route transition surface. */
export const TRANSITION_SPLASH_ROOT_ID = "navigation-transition-overlay";

/** Brand primitives shared by startup HTML and the React presenter. */
export const SPLASH_BRAND_CLASS = "app-splash__marca";
export const SPLASH_ICON_CLASS = "app-splash__icone";
export const SPLASH_NAME_CLASS = "app-splash__nome";
export const SPLASH_PROGRESS_CLASS = "app-splash__barra";
export const SPLASH_ICON_SRC = "/icons/icon-192.png";
export const SPLASH_ICON_SIZE = 72;
export const SPLASH_PRODUCT_NAME = "Master Jobs";

/** Classe que dispara o fade-out. */
export const SPLASH_HIDDEN_CLASS = "app-splash--saindo";

/** Duração do fade, em ms. Mantida em sincronia com o CSS abaixo. */
export const SPLASH_FADE_MS = 260;

/** Quanto tempo a splash fica visível no mínimo, para não piscar. */
export const SPLASH_MIN_MS = 900;

/** Teto absoluto. Depois disso ela sai, tenha o documento carregado ou não. */
export const SPLASH_MAX_MS = 3000;

/**
 * Navegador de automação.
 *
 * Sem esta saída, todo teste de ponta a ponta passaria os primeiros 900 ms
 * olhando para a splash e clicando no que está atrás dela. O `e2e` não é um
 * usuário com pressa: é um usuário que não deveria ver isto.
 */
export const HEADLESS_UA = /HeadlessChrome|Playwright|Puppeteer|Cypress|jsdom|WebdriverIO/i;

export function isHeadlessUA(userAgent: string): boolean {
  return userAgent ? HEADLESS_UA.test(userAgent) : false;
}

/**
 * O HTML da splash. Vai como primeiro filho do `<body>`.
 *
 * `aria-hidden` no conteúdo e `role="status"` no container: quem usa leitor de
 * tela recebe "carregando" uma vez, e não a marca, o ícone e o girador em
 * sequência. O ícone é o mesmo do manifest — reaproveitar evita uma requisição
 * a mais bem no momento em que a página está tentando aparecer.
 */
export function renderSplashHTML(rotulo: string): string {
  return `<div id="${SPLASH_ROOT_ID}" role="status" aria-live="polite" aria-label="${rotulo}">
<div class="${SPLASH_BRAND_CLASS}" aria-hidden="true">
<img class="${SPLASH_ICON_CLASS}" src="${SPLASH_ICON_SRC}" alt="" width="${SPLASH_ICON_SIZE}" height="${SPLASH_ICON_SIZE}" decoding="async" />
<span class="${SPLASH_NAME_CLASS}">${SPLASH_PRODUCT_NAME}</span>
</div>
<div class="${SPLASH_PROGRESS_CLASS}" aria-hidden="true"><span></span></div>
</div>`;
}

/**
 * CSS da splash, inline no `<head>`.
 *
 * As cores saem dos tokens do tema, com literal de reserva ao lado: o
 * `data-theme` já está no `<html>` vindo do servidor, então os tokens resolvem
 * na primeira pintura — mas se a folha de estilo demorar, o literal segura, e
 * ele é o mesmo valor que `THEME_COLOR` declara para a barra do navegador.
 * Divergir aqui produziria uma faixa de cor diferente por alguns quadros.
 */
export function renderSplashCSS(): string {
  return `#${SPLASH_ROOT_ID}{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5rem;background:var(--background,#ffffff);color:var(--foreground,#101215);opacity:1;visibility:visible;pointer-events:none;transition:opacity ${SPLASH_FADE_MS}ms ease-out,visibility ${SPLASH_FADE_MS}ms ease-out;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
@media (prefers-color-scheme: dark){#${SPLASH_ROOT_ID}{background:var(--background,#101215);color:var(--foreground,#ffffff)}}
#${SPLASH_ROOT_ID}.${SPLASH_HIDDEN_CLASS}{opacity:0;visibility:hidden}
#${SPLASH_ROOT_ID} .app-splash__marca{display:flex;flex-direction:column;align-items:center;gap:.875rem;animation:app-splash-entrada 420ms ease-out both}
#${SPLASH_ROOT_ID} .app-splash__icone{width:72px;height:72px;border-radius:18px;display:block}
#${SPLASH_ROOT_ID} .app-splash__nome{font-family:ui-monospace,SFMono-Regular,"IBM Plex Mono",monospace;font-size:.9375rem;font-weight:500;letter-spacing:-0.01em;opacity:.85}
#${SPLASH_ROOT_ID} .app-splash__barra{position:relative;width:120px;height:2px;border-radius:2px;overflow:hidden;background:color-mix(in oklab,currentColor 12%,transparent)}
#${SPLASH_ROOT_ID} .app-splash__barra span{position:absolute;inset-block:0;left:0;width:40%;border-radius:inherit;background:currentColor;opacity:.55;animation:app-splash-varre 1.1s ease-in-out infinite}
@keyframes app-splash-entrada{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes app-splash-varre{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
@media (prefers-reduced-motion: reduce){#${SPLASH_ROOT_ID} .app-splash__marca{animation:none}#${SPLASH_ROOT_ID} .app-splash__barra span{animation:none;width:100%;opacity:.3}#${SPLASH_ROOT_ID}{transition:none}}`;
}

/**
 * O script que a remove.
 *
 * DOM puro, sem módulo, sem dependência: roda como primeiro script do
 * documento. `removida` guarda contra os três caminhos dispararem juntos — o
 * documento pode ficar pronto no mesmo quadro em que o teto vence.
 */
export function renderSplashScript(): string {
  return `(function(){try{
var id=${JSON.stringify(SPLASH_ROOT_ID)};
var saindo=${JSON.stringify(SPLASH_HIDDEN_CLASS)};
var minMs=${SPLASH_MIN_MS},maxMs=${SPLASH_MAX_MS},fadeMs=${SPLASH_FADE_MS};
var headless=${HEADLESS_UA.toString()};
var inicio=Date.now(),removida=false;
var splash=document.getElementById(id);window[${JSON.stringify(SPLASH_REFERENCE_KEY)}]=splash;
function tirar(){
if(removida)return;removida=true;
var el=splash;if(!el)return;
el.classList.add(saindo);
setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},fadeMs+50);
}
function agendar(){setTimeout(tirar,Math.max(0,minMs-(Date.now()-inicio)));}
if(headless.test(navigator.userAgent||"")){tirar();return;}
if(document.readyState!=="loading"){agendar();}
else{document.addEventListener("DOMContentLoaded",agendar,{once:true});}
setTimeout(tirar,maxMs);
}catch(e){var el=document.getElementById(${JSON.stringify(SPLASH_ROOT_ID)});if(el&&el.parentNode)el.parentNode.removeChild(el);}})();`;
}
