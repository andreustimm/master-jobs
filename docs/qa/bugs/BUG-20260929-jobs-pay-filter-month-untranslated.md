# BUG-20260929-jobs-pay-filter-month-untranslated: "/month" fica fixo em inglês com a interface em pt-BR

- **Status:** open
- **Impact (user-side):** Cosmetic
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, no filtro de faixa salarial
- **Scenarios:** JOBS-pay-filter
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

No filtro de faixa salarial, com a interface em pt-BR, o sufixo "/month"
permanece fixo em inglês em vez de "/mês". Direção oposta do defeito de
vazamento de português na interface em inglês, mesma causa provável
(literal fora do dicionário).

## Reproduction

- **Charter:** CH-filtered-board-numbers-agree · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210), pt-BR

1. Com a interface em pt-BR, abrir `/jobs`.
2. Abrir o filtro de faixa salarial.
3. Ler o sufixo ao lado do valor.

**Expected:** "/mês".
**Actual:** "/month".

## Evidence

- Leitura direta da tela nesta sessão (lane jobsnav); ver debrief "Lane
  jobsnav" no relatório desta rodada.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
