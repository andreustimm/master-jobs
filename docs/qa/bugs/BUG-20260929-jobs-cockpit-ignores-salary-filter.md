# BUG-20260929-jobs-cockpit-ignores-salary-filter: cockpit ignora a faixa salarial da URL

- **Status:** open
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao aplicar faixa salarial
- **Scenarios:** JOBS-cockpit-count-matches-list; JOBS-pay-filter
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Com uma faixa salarial aplicada na URL, o número do cockpit na tela inicial
(`/`) e o número em `/jobs` discordam: `/` mostra 5.545, `/jobs` mostra
5.143 — a mesma faixa, dois números diferentes. Uma das duas telas está
ignorando o filtro.

## Reproduction

- **Charter:** CH-filtered-board-numbers-agree · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210), conta
  `qa-full-candidate-a`

1. Aplicar uma faixa salarial na URL.
2. Ler o número do cockpit em `/`.
3. Ler o número equivalente em `/jobs`.

**Expected:** os dois números concordam.
**Actual:** `/` dá 5.545, `/jobs` dá 5.143.

## Evidence

- Leitura direta das duas telas nesta sessão (lane jobsnav); ver debrief
  "Lane jobsnav" no relatório desta rodada.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
