# BUG-20260929-density-resets-on-list-changes: densidade compacta some ao paginar, ordenar ou filtrar

- **Status:** verified
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
- **Root cause:** `dense` nunca fez parte de `FilterState` (`app/filter-state.ts`): `readFilters` não o lia da URL e `toParams`/`facetHref` não o reescreviam ao montar o link de paginação, ordenação, filtro ou preset. Cada navegação remonta a URL a partir do estado, então um campo ausente do estado é descartado nela — `dense=1` só sobrevivia enquanto a pessoa não tocava em outro controle.
- **Fix commit:** 5432c3fe
- **Regression test:** `tests/filter-state.test.ts` (dense entra e sai de `readFilters`/`toParams`/`facetHref`); `tests/e2e/ui/jobs-density.mjs` (desktop e 375px): antes, `dense` se perdia ao paginar, ordenar, filtrar, submeter busca por texto ou trocar de preset; depois, 24/24 passam com reload em cada etapa.

## Verification

<!-- filled when status moves to verified -->
- **Retested:** 29/09/2026, Chromium, standalone com PostgreSQL isolado, jornada pública com agent-browser (desktop e 375×812).
- **Result:** pass — `dense=1` e `aria-current="page"` de Compact persistem após paginação, ordenação, filtro, busca por texto, preset e reload, em desktop e 375px. Relatório `docs/qa/reports/2026-09-29T150058Z-empregador-densidade-397.md`; captura `docs/qa/evidence/2026-09-29T150058Z-empregador-densidade-397/careers-compacta-375.png`.

## Reteste #397

docs/qa/reports/2026-09-29T150058Z-empregador-densidade-397.md. Fonte careers nomeada/agrupada e densidade persistente confirmadas após reload; paginação também coberta no E2E.
