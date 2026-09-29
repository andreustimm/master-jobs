# BUG-20260929-jobs-sort-group-missing-aria-current: ordem ativa e "agrupar repetidas" não expõem aria-current

- **Status:** verified
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Candidato por teclado
- **Journey Step:** J-trust-the-filtered-board, ao identificar qual ordem/agrupamento está ativo
- **Scenarios:** JOBS-search-relevance
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Os controles de ordem (relevância/data) e "agrupar repetidas" não expõem
`aria-current` (ou equivalente) no estado ativo. Quem usa leitor de tela ou
navegação por teclado não tem como saber qual opção está selecionada sem
inspecionar visualmente — a informação existe na tela (destaque visual) mas
não é exposta de forma acessível.

## Reproduction

- **Charter:** CH-relevance-and-availability-catch-up · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), árvore de acessibilidade
  via `playwright-cli`

1. Em `/jobs`, aplicar uma ordem (ex.: relevância) e ligar "agrupar
   repetidas".
2. Ler a árvore de acessibilidade dos controles de ordem e agrupamento.

**Expected:** o controle ativo expõe `aria-current` (ou `aria-pressed`
equivalente).
**Actual:** nenhum atributo de estado ativo exposto.

## Evidence

- Árvore de acessibilidade lida nesta sessão (lane jobsnav, candidato C11);
  ver debrief "Lane jobsnav" no relatório desta rodada.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**

## Reteste #398

Interface pública, teclado e recarga confirmaram o recorte corrigido. Relatório: docs/qa/reports/2026-09-29T145000Z-acessibilidade-398.md.
VoiceOver/pinch em aparelho físico permanece pendente no cenário abrangente.
