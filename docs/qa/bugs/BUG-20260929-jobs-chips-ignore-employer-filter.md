# BUG-20260929-jobs-chips-ignore-employer-filter: chips de qualidade ignoram o filtro de empregador

- **Status:** verified
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao filtrar por empregador
- **Scenarios:** JOBS-cockpit-count-matches-list
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

O quadro filtrado promete que nenhum número discorda de si mesmo (é o nome
da própria jornada). Com `company=Turing` na URL, a lista mostra 19 vagas,
mas o chip "sem bloqueio" continua mostrando "5545" — o total sem filtro
nenhum, não o total filtrado. A pessoa lê dois números que deveriam
concordar e não concordam.

## Reproduction

- **Charter:** CH-filtered-board-numbers-agree · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210), conta
  `qa-full-candidate-a`

1. Abrir `/jobs`.
2. Filtrar por `company=Turing`.
3. Comparar a contagem da lista com o número no chip "sem bloqueio".

**Expected:** o chip reflete o filtro aplicado (19).
**Actual:** chip mostra "5545" (total geral, ignora o filtro de empregador).

## Evidence

- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-filtered-board-numbers-agree/company-turing-chips-5545-vs-19.png`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** `boardFacets` recebia só o recorte da faceta e não o filtro de empresa, enquanto a lista usava o filtro completo.
- **Fix commit:** `7bdacc7f7c323dfb6d3fa2f14b657b149487b8ac`
- **Regression test:** `tests/jobs-board.test.ts` — IT-396-01 falhou antes e passa depois.

## Verification

<!-- filled when status moves to verified -->
- **Retested:** 2026-09-29 · Andreus em triagem · `CH-filtered-board-numbers-agree` · sessão manual isolada e `/jobs?company=Aurora` após recarga.
- **Result:** cockpit e lista mostram 1 vaga e o chip sem bloqueio mostra 1; o cenário está `pass`.
