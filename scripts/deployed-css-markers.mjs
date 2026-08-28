/**
 * Marcadores de geração que o CSS servido em produção precisa conter.
 *
 * Módulo puro, separado do gate (`check-deployed-css.mjs`) porque o gate
 * executa fetch no top-level: importá-lo num teste executaria a checagem
 * contra produção. Assim o teste de contrato (`tests/pwa-chrome.test.ts`)
 * importa só a lista e prova que cada marcador existe nas FONTES — um typo
 * aqui falha no `pnpm check`, em segundos, em vez de falhar no job
 * pós-deploy dez minutos depois do merge.
 *
 * A checagem é por fonte, não por build minificado: cobre typo e remoção,
 * que são os riscos reais. Um marcador legítimo pode sumir do build por
 * causa de cache — e essa é exatamente a condição que o gate existe para
 * acusar em produção.
 */

/**
 * "safe-area-inset-top" — o padrão de área segura ligado aos insets do
 * aparelho (app/globals.css).
 * "--safe-area-top-floor" — o piso de 48px para launcher que entrega inset 0
 * (app/design-tokens.css, BUG-20260825).
 * "data-responsive-nav" — a navegação responsiva medida (app/layout.tsx).
 * "1760px" — o teto do shell determinístico (app/layout.tsx, app/footer.tsx).
 * "app-shell-content" + "2.5vw" — a geração que mantém a superfície do
 * cabeçalho full-bleed e limita somente o conteúdo móvel a 95%.
 * A media query completa — a geração que remove o piso artificial somente na
 * paisagem baixa de telefone, preservando retrato e tablet.
 */
export const DEPLOYED_CSS_MARKERS = [
  "--safe-area-top-floor",
  "safe-area-inset-top",
  "data-responsive-nav",
  "1760px",
  "app-shell-content",
  "2.5vw",
  "@media (pointer:coarse) and (orientation:landscape) and (max-width:1023px) and (max-height:500px)",
];

/**
 * Marcadores que identificam gerações sabidamente quebradas. Um gate apenas
 * positivo aceitava a folha antiga porque ela também continha os tokens novos
 * genéricos. Este seletor é exatamente o observado no CSS publicado em
 * 2026-08-27: ele aplica a área segura no wrapper externo e encolhe o topo.
 */
export const FORBIDDEN_DEPLOYED_CSS_MARKERS = ["html.pwa-standalone body>div"];

export function inspectDeployedCss(css) {
  return {
    missing: DEPLOYED_CSS_MARKERS.filter((marker) => !css.includes(marker)),
    forbidden: FORBIDDEN_DEPLOYED_CSS_MARKERS.filter((marker) => css.includes(marker)),
  };
}
