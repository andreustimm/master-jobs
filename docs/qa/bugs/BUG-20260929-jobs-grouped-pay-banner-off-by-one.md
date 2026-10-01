# BUG-20260929-jobs-grouped-pay-banner-off-by-one: aviso de faixa salarial soma um a mais quando agrupado

- **Status:** verified
- **Impact (user-side):** Cosmetic
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao agrupar vagas repetidas com filtro de faixa salarial
- **Scenarios:** JOBS-pay-filter
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Com "agrupar repetidas" ligado e um filtro de faixa salarial aplicado, o
aviso da faixa soma 5.143 + 403 = 5.546, mas o total mostrado é 5.545 — um a
mais que o esperado pela soma. Diferença pequena (1 em ~5.500), mas é
exatamente o tipo de número que discorda de si mesmo que a jornada promete
nunca mostrar.

## Reproduction

- **Charter:** CH-filtered-board-numbers-agree · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210)

1. Em `/jobs`, aplicar um filtro de faixa salarial.
2. Ligar "agrupar repetidas".
3. Somar os dois números do aviso da faixa e comparar com o total mostrado.

**Expected:** soma bate com o total mostrado.
**Actual:** 5.143 + 403 = 5.546, total mostrado 5.545.

## Evidence

- Cálculo direto nesta sessão (lane jobsnav, candidato C8); ver debrief
  "Lane jobsnav" no relatório desta rodada.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** o aviso calculava publicações fora da faixa com uma seleção canônica diferente da consulta agrupada da lista.
- **Fix commit:** `7bdacc7f7c323dfb6d3fa2f14b657b149487b8ac`
- **Regression test:** `tests/jobs-board.test.ts` — IT-396-02 cobre irmãos do mesmo grupo; `tests/e2e/ui/searches.mjs` cobre agrupamento com faixa.

## Verification

<!-- filled when status moves to verified -->
- **Retested:** 2026-09-29 · Andreus em triagem · `CH-filtered-board-numbers-agree` · E2E isolado com fixture de remuneração e agrupamento.
- **Result:** a área `searches` passou 80/80 e o aviso não duplica grupo; o cenário está `pass`.
