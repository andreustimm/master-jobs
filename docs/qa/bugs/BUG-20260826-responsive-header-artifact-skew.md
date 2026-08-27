# BUG-20260826-responsive-header-artifact-skew: cabeçalho empilha os links e exibe os dois menus

- **Status:** fixed
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus no celular
- **Journey Step:** J-switch-workspace-screen — Trocar de tela de trabalho, step 1
- **Scenarios:** NAV-first-party-navigation-contract; NAV-full-width-shell
- **Found:** 2026-08-26 · **Report:** docs/qa/reports/2026-08-26T174227129000Z-c759d603-responsive-header-artifact-skew.md

## Summary

Ao abrir qualquer tela, Andreus encontra os links globais empilhados verticalmente dentro de um cabeçalho de centenas de pixels. O botão de menu compacto aparece ao mesmo tempo, e abrir o menu escurece uma interface que já está quebrada.

**Regressão reencontrada em 2026-08-27:** produção continua servindo a folha
antiga. O topo fica recuado nas laterais inclusive em desktop, e uma janela
larga mostra o hambúrguer apesar de haver espaço para a navegação completa.

## Reproduction

- **Charter:** CH-mobile-responsive-regression · **Tour:** Feature Tour
- **Environment:** produção `jobs.mastertimm.com.br`, Safari e Chrome mobile em retrato e paisagem, pt-BR

1. Abrir `/`, `/jobs` ou `/admin/users` em um celular ou tablet.
2. Observar o cabeçalho antes de tocar no hambúrguer.
3. Tocar no hambúrguer e comparar o menu aberto com os links já visíveis no cabeçalho.

**Expected:** O cabeçalho ocupa uma linha e mostra exatamente um modo de navegação: links completos quando cabem ou hambúrguer quando não cabem.
**Actual:** Os links completos ficam empilhados e visíveis junto do hambúrguer, aumentando o cabeçalho e escondendo conteúdo útil.

## Evidence

- Capturas de produção fornecidas pelo usuário em 2026-08-26, nas rotas `/`, `/jobs` e `/admin/users`, em retrato e paisagem.
- O HTML de produção contém `data-responsive-nav`, mas o CSS referenciado não contém `data-responsive-nav`, `#application-shell` nem `#menu-mobile`; sem um guard estrutural o navegador aplica `display: block` ao elemento `nav`.
- Capturas de 2026-08-27 mostram o seletor publicado
  `html.pwa-standalone body>div` e o menu compacto numa viewport desktop larga.
- `pnpm check:deployed-css` reproduziu a divergência: faltavam
  `--safe-area-top-floor`, `data-responsive-nav`, `app-shell-content` e
  `2.5vw`, enquanto o seletor obsoleto permanecia presente.

## Fix

- **Root cause:** o HTML e o CSS publicados são de gerações diferentes. Além
  disso, o gate aceitava apenas marcadores positivos genéricos que também
  existiam na folha antiga; por isso o seletor comprovadamente quebrado não
  tornava o deploy vermelho.
- **Fix commits:** `1570ccd`
- **Regression tests:** `tests/mobile.test.ts` e `tests/pwa-chrome.test.ts`
  travam a superfície full-bleed e as calhas móveis; `tests/e2e/ui.mjs` mede a
  largura real e exige a navegação completa em desktop; o gate pós-deploy
  rejeita `html.pwa-standalone body>div`.

## Verification

- **Retested:** 2026-08-27, build de produção isolado em Chromium e WebKit · **Report:** docs/qa/reports/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh.md
- **Result:** 207/207 verificações passaram: topo full-bleed, 95% úteis no celular, navegação completa em 1280px/1920px e ausência de overflow. Produção permanece na geração antiga até este commit percorrer o deploy.
