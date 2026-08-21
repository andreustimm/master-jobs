/**
 * Detecção de modo standalone, para o CSS saber que está rodando como app.
 *
 * ## O defeito que isto corrige
 *
 * `app/layout.tsx` declara `viewportFit: "cover"`, que manda o conteúdo ocupar
 * a tela inteira — inclusive **atrás** do recorte da câmera e da barra de
 * status. É o que se quer num app instalado: o fundo vai até a borda em vez de
 * deixar uma tarja.
 *
 * A contrapartida é que alguém precisa devolver o espaço ao conteúdo, e nada
 * fazia isso. O resultado na tela era o relógio do sistema escrito por cima do
 * nome do aplicativo, e o indicador de bateria por cima do seletor de idioma.
 *
 * ## Por que uma classe, e não `@media (display-mode: standalone)`
 *
 * A media query existe e funciona — mas só depois que o navegador resolve o
 * modo de exibição. Em Android, o app abre pela splash nativa e a primeira
 * pintura acontece antes disso em parte dos aparelhos, o que produz um salto:
 * o cabeçalho nasce colado no topo e desce quando a media query passa a valer.
 *
 * Marcar o `<html>` no primeiro script do documento decide antes da primeira
 * pintura. E a classe cobre um caso que a media query não cobre: iOS antigo,
 * onde standalone se descobre por `navigator.standalone`.
 *
 * ## Por que não afeta o navegador
 *
 * Toda regra de safe-area em `globals.css` está sob `html.pwa-standalone`. No
 * navegador comum a classe não existe, o padding não se aplica, e a página
 * continua exatamente como era — a barra do navegador já reserva o espaço.
 */

/** Classe posta no `<html>` quando o app roda instalado. */
export const STANDALONE_CLASS = "pwa-standalone";

/**
 * O app está rodando instalado?
 *
 * Recebe as duas fontes por parâmetro em vez de ler `window`, para o teste
 * poder exercitar cada combinação sem simular navegador inteiro.
 *
 * `navigator.standalone` é a fonte do iOS antigo e só existe lá; `display-mode`
 * é a moderna. `minimal-ui` entra junto porque o Android usa esse modo quando o
 * manifest pede `standalone` e o sistema decide manter uma barra fina — o
 * conteúdo continua indo até a borda, que é o que importa aqui.
 */
export function isStandalone(input: {
  matchMedia?: (query: string) => { matches: boolean };
  navigatorStandalone?: boolean;
}): boolean {
  if (input.navigatorStandalone === true) return true;
  if (!input.matchMedia) return false;
  return (
    input.matchMedia("(display-mode: standalone)").matches ||
    input.matchMedia("(display-mode: minimal-ui)").matches ||
    input.matchMedia("(display-mode: fullscreen)").matches
  );
}

/**
 * Script inline que marca o `<html>`.
 *
 * Sem ESM e sem depender de nada carregado: precisa rodar como primeiro
 * script do documento, antes de qualquer pintura. Envolto em `try` porque um
 * `matchMedia` ausente não pode derrubar o documento inteiro — o custo de
 * falhar aqui é o padding não aparecer, e o de estourar é a página em branco.
 */
export function renderStandaloneScript(): string {
  return `(function(){try{
var m=window.matchMedia;
var standalone=(navigator.standalone===true)||(m&&(
m("(display-mode: standalone)").matches||
m("(display-mode: minimal-ui)").matches||
m("(display-mode: fullscreen)").matches));
if(standalone)document.documentElement.classList.add(${JSON.stringify(STANDALONE_CLASS)});
}catch(e){}})();`;
}
