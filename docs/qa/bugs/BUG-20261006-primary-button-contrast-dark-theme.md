# BUG-20261006-primary-button-contrast-dark-theme: no tema escuro, botão primário e filtro ativo ficam abaixo do contraste AA

- **Status:** fixed
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem noturna (tema escuro)
- **Journey Step:** J-preserve-application-decision, ao ler "Buscar" e "ampliar busca" ativo em `/pipeline`; o mesmo em `/jobs`
- **Scenarios:** PIPE-filter-applications
- **Found:** 2026-10-06 · **Report:** docs/qa/reports/2026-10-06-qa-478-funil-filtros.md
- **Origin:** anterior à #478 — o token é compartilhado; `/jobs` tem 9 nós
  com a mesma violação.

## Summary

Texto `#0b0d10` sobre o preenchimento primário `#296ef9` dá 4,34:1, abaixo do
4,5:1 do WCAG 1.4.3 para texto pequeno. No Funil: o botão "Buscar" e o
"ampliar busca" ligado. Em Vagas: o link de busca, a trilha principal, o modo
"todas", a ordem ativa, a densidade e o tamanho de página ativos.

## Reproduction

- **Charter:** CH-filter-pipeline · **Tour:** Back-Button Tour
- **Environment:** `tests/e2e/run-isolated.mjs --manual`, 1280 px, tema escuro
  (padrão do navegador do driver), axe-core 4.12.1 via `agent-browser a11y`

1. Abrir `/pipeline?q=engenheiro&semantic=1&company=Vercel&stage=applied`.
2. Rodar a auditoria axe na página.

**Expected:** nenhuma violação `color-contrast`.
**Actual:** 2 nós (`pipeline-query-submit`, `pipeline-broaden`) a 4,34:1; em
`/jobs?q=engenheiro`, 9 nós.

## Evidence

- Saída do `agent-browser a11y` registrada no relatório (seção Lentes).

## Fix

- **Root cause:** a cópia do tema escuro dentro de
  `@media (prefers-color-scheme: dark)` em `app/themes.css` tinha derivado da
  escolha explícita: no tema HP herdado do sistema, `--primary` era `#296ef9`
  (4,34:1 com `--primary-foreground` `#0b0d10`), enquanto o escuro escolhido
  já usava `#4d8bff`. Quem tinha o sistema no escuro via todo preenchimento
  primário abaixo do AA — por isso o mesmo achado em `/pipeline` e `/jobs`.
- **Fix commit:** `891042f` (PR #499) — o bloco do sistema passa a
  `--primary: #4d8bff`, igual à escolha explícita.
- **Regression test:** `tests/design.test.ts` ("paints the dark mode the same
  whether chosen or inherited from the system", que exige os dois blocos
  escuros iguais em todos os temas, e "keeps primary-foreground on primary at
  WCAG AA in every theme and mode").

## Verification

<!-- filled when status moves to verified -->
