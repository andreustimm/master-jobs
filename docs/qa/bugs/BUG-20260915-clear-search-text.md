# BUG-20260915-clear-search-text: Limpar deixa a busca antiga no campo

- **Status:** open
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-find-jobs-by-work-mode, recuperar busca sem resultados
- **Scenarios:** JOBS-work-mode-continuity
- **Found:** 2026-09-15 · **Report:** ../reports/2026-09-15T154024495800Z-d256aed5-job-work-mode-filter.md

## Summary

Ao limpar uma busca sem resultados, a pessoa volta a ver vagas, mas o campo
continua mostrando a busca anterior. Ao buscar novamente, o texto antigo retorna
à URL e ao recorte.

## Reproduction

- **Charter:** CH-work-mode-continuity · **Tour:** Back-Button Tour
- **Environment:** Chromium, 1280×900, Wi-Fi, pt-BR, build local de produção.

1. Entrar, buscar Aurora Digital e selecionar Remoto.
2. Na lista, digitar Cargo indisponível Aurora e buscar.
3. Clicar em Limpar e observar campo, URL e resultados.

**Expected:** Campo vazio, parâmetro `q` ausente e resultados correspondentes.
**Actual:** A URL perde `q` e a lista muda; o campo mantém Cargo indisponível Aurora.

## Evidence

- ../evidence/2026-09-15T154024495800Z-d256aed5-job-work-mode-filter/CH-work-mode-continuity-baseline-clear-stale.png
- Recarga da mesma URL limpa o campo, confirmando que a divergência é da navegação.

## Fix

- **Root cause:** Campo não controlado com `defaultValue` conserva a edição local quando a URL muda por navegação.
- **Fix commit:** pendente
- **Regression test:** tests/e2e/work-mode.mjs, checkClearingSearch.

## Verification

Pendente de correção e nova sessão da mesma persona.
