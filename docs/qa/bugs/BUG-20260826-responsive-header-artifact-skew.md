# BUG-20260826-responsive-header-artifact-skew: cabeçalho empilha os links e exibe os dois menus

- **Status:** verified
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus no celular
- **Journey Step:** J-switch-workspace-screen — Trocar de tela de trabalho, step 1
- **Scenarios:** NAV-first-party-navigation-contract
- **Found:** 2026-08-26 · **Report:** docs/qa/reports/2026-08-26T174227129000Z-c759d603-responsive-header-artifact-skew.md

## Summary

Ao abrir qualquer tela, Andreus encontra os links globais empilhados verticalmente dentro de um cabeçalho de centenas de pixels. O botão de menu compacto aparece ao mesmo tempo, e abrir o menu escurece uma interface que já está quebrada.

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

## Fix

- **Root cause:** o HTML removeu as classes utilitárias de visibilidade e passou a depender exclusivamente de seletores CSS novos e medição no cliente. Produção combinou esse HTML com um artefato CSS anterior; o valor padrão de `nav` tornou a fileira visível e vertical antes e durante a hidratação.
- **Fix commits:** `062eb64`, `cce67ae`, `055af8a`, `a56a0c1`
- **Regression tests:** `tests/nav-mobile.test.ts` falhou antes e passa depois para o fallback, o painel compacto largo e o nome truncado aplicável; `tests/e2e/ui.mjs` mede altura, direção, exclusão mútua e abertura do painel compacto em 1280px.

## Verification

- **Retested:** 2026-08-26T19:11Z–19:18Z, mesmas rotas e persona em build limpo `a56a0c1` de produção local · **Report:** docs/qa/reports/2026-08-26T174227129000Z-c759d603-responsive-header-artifact-skew.md
- **Result:** Em 375×812, 812×375 e 768×1024 somente o hambúrguer ficou visível; em 1280×900 somente a fileira horizontal ficou visível. A altura permaneceu em 57px, sem overflow, o segundo toque fechou o menu e um nome no limite permitido foi truncado sem perder o valor completo.
