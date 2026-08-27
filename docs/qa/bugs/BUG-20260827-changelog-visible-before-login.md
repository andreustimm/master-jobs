# BUG-20260827-changelog-visible-before-login: Novidades aparece antes da autenticação

- **Status:** fixed
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P1
- **Persona Affected:** Visitante sem sessão
- **Journey Step:** J-switch-workspace-screen — Entrar no sistema, step 1
- **Scenarios:** AUTH-canonical-transition-boundaries
- **Found:** 2026-08-27 · **Report:** docs/qa/reports/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh.md

## Summary

O rodapé da tela de login oferecia a modal de Novidades da versão 1.3.8. O
changelog é conteúdo interno da aplicação e só deve existir depois que uma
sessão válida foi resolvida.

## Reproduction

- **Charter:** CH-installed-pwa-update-resume · **Tour:** Feature Tour
- **Environment:** `/login`, sem cookie de sessão, pt-BR e en

1. Abrir `/login` sem sessão.
2. Inspecionar o rodapé.

**Expected:** O rodapé mostra somente a versão; nenhum gatilho ou conteúdo de Novidades é renderizado.
**Actual:** O gatilho abre o changelog mesmo sem autenticação.

## Evidence

- Relato direto do usuário em 2026-08-27.
- `tests/e2e/ui.mjs` confirma que `[data-testid="changelog-open"]` não existe antes do login.

## Fix

- **Root cause:** o layout conhecia a sessão, mas o `Footer` era renderizado sem essa fronteira e carregava o changelog incondicionalmente.
- **Fix commit:** `1570ccd`
- **Regression tests:** `tests/changelog.test.ts` cobre a renderização de servidor e `tests/e2e/ui.mjs` cobre a tela pública real.

## Verification

- **Retested:** 2026-08-27, build de produção isolado, sem sessão e depois com login válido · **Report:** docs/qa/reports/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh.md
- **Result:** sem sessão o gatilho inexiste; após o login a modal continua disponível e todos os 24 cenários do changelog passaram.
