# BUG-20260929-density-resets-on-list-changes: densidade compacta some ao paginar, ordenar ou filtrar

- **Status:** open
- **Impact (user-side):** Friction
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao ajustar a densidade da lista
- **Scenarios:** JOBS-filter-fields-follow-url
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Ligar a densidade compacta (`dense=1`) na lista de vagas funciona, mas some
sozinha ao paginar, ordenar ou aplicar um novo filtro — a pessoa precisa
religar manualmente depois de cada ação, quando o resto dos filtros da URL
(regra 9-adjacente: campos seguem a URL) sobrevive normalmente.

## Reproduction

- **Charter:** CH-release-regression-sweep · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210)

1. Em `/jobs`, ligar a densidade compacta (`dense=1`).
2. Paginar, ordenar ou aplicar um filtro novo.
3. Observar se a densidade compacta permanece ligada.

**Expected:** `dense=1` sobrevive à navegação como os demais parâmetros da
URL.
**Actual:** densidade compacta some ao paginar, ordenar ou filtrar.

## Evidence

- Observado nesta sessão (lane jobsnav, candidato C3); ver debrief "Lane
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
