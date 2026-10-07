# BUG-20261006-pipeline-active-stage-invisible: no Funil, nada mostra qual estágio está escolhido

- **Status:** fixed
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-preserve-application-decision, ao combinar filtros com um estágio em `/pipeline`
- **Scenarios:** PIPE-filter-applications
- **Found:** 2026-10-06 · **Report:** docs/qa/reports/2026-10-06-qa-478-funil-filtros.md
- **Origin:** anterior à #478 — o cartão do estágio já usava só
  `border-[var(--primary)]` sem largura de borda. Com os filtros novos, o
  estágio passou a ser um filtro a mais que a pessoa precisa enxergar.

## Summary

Os cartões de contagem do Funil (Todos, A fazer, Pré-selecionada…) são também
o filtro de estágio, mas o escolhido fica igual aos outros: a cor da borda
muda para a primária, porém a borda tem 0 px. Nenhum cartão expõe
`aria-current`. Com empresa, canal e score combinados, a pessoa só sabe em que
estágio está pela URL ou pelo selo de cada linha.

## Reproduction

- **Charter:** CH-filter-pipeline · **Tour:** Back-Button Tour
- **Environment:** `tests/e2e/run-isolated.mjs --manual`, 1280 px, pt-BR

1. Abrir `/pipeline?company=Gopher+Labs+QA&company=Vercel`.
2. Clicar no cartão "2 Candidatura enviada".

**Expected:** o cartão escolhido se distingue (visual e `aria-current`).
**Actual:** os três cartões idênticos; estilo computado do escolhido
`border-top-width: 0px` com cor `rgb(41, 110, 249)`; `aria-current` ausente.

## Evidence

- `docs/qa/evidence/2026-10-06-qa-478-funil-filtros/01-seletor-aberto-apos-aplicar.png`

## Fix

- **Root cause:** o cartão escolhido em `app/pipeline/page.tsx` recebia só
  `border-[var(--primary)]`, sem largura de borda: a cor mudava numa borda de
  0 px. O `Card` desenha o contorno com `ring-1`, e nenhum link de estágio
  declarava `aria-current`.
- **Fix commit:** `891042f` (PR #499) — o escolhido troca o contorno por um
  anel de 2 px na cor primária (`ring-2 ring-primary`) e o link do estágio
  ganha `aria-current`.
- **Regression test:** E2E-494 em `tests/e2e/ui/pipeline-filters.mjs` ("o
  estágio escolhido tem aria-current e marca visível diferente dos outros").

## Verification

<!-- filled when status moves to verified -->
