# BUG-20260824-canonical-route-splash: splash permanece sobre respostas 403/404

- **Status:** verified
- **Impact (user-side):** Blocks-Completion
- **Severity:** High · **Priority:** P1
- **Personas Affected:** Candidato após falha, Recrutadora convidada e Visitante do perfil público
- **Journey Steps:** J-switch-workspace-screen, step 3; J-open-public-profile, step 2
- **Scenarios:** AUTH-canonical-transition-boundaries; PUB-public-profile-mobile-entry
- **Found:** 2026-08-24 · **Report:** docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
- **Origin:** Full QA da release 1.3.0

## Summary

Ao abrir ou recarregar uma rota que termina em 403 ou 404, o Next inseria novamente o layout pelo payload Flight. O script inline de remoção do splash não executava nesse conteúdo inserido, deixando a camada de carregamento sobre a resposta canônica e impedindo o usuário de ler ou usar a tela.

## Reproduction

- **Charters:** CH-auth-boundary-recovery; CH-recruiter-private-boundary; CH-public-profile-mobile-entry
- **Tours:** Back-Button Tour; Feature Tour
- **Environment:** build Next de produção local / 375 px e 430 px / pt-BR e en

1. Entrar com uma conta sem permissão e abrir uma rota administrativa, ou abrir um perfil público inexistente.
2. Confirmar a resposta 403 ou 404.
3. Recarregar a URL canônica.

**Expected:** A resposta localizada aparece sem camada residual, mantendo o status HTTP e permitindo nova navegação.
**Actual:** O splash permanecia visível sobre a resposta após a recarga.

## Evidence

- docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-candidate-forbidden-admin.png
- docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/recruiter-forbidden-candidate.png
- docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/public-profile-404.png
- docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-public-revoked-404.png
- docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-candidate-forbidden-admin-goal.png
- docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/recruiter-forbidden-candidate-goal.png
- docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/public-profile-404-goal-en.png
- docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-public-revoked-404-goal.png

## Fix

- **Root cause:** requisições de navegação reaproveitavam cabeçalhos internos do App Router, e respostas especiais inseridas por Flight não executavam o script inline que remove o splash de startup.
- **Fix commits:** `7ba2890`, `fe5cdbf`
- **Resolution:** o service worker transforma navegações em requisições HTML limpas; os boundaries localizados preservam 403/404; o observador de commit remove somente um splash de startup reinserido sem timer ativo.
- **Regression tests:** `tests/pwa.test.ts`, `tests/pwa-chrome.test.ts`, `tests/navigation-transition.test.ts` e `tests/e2e/ui.mjs` cobrem cabeçalhos limpos, singleton, reload, idiomas e viewports móveis.

## Verification

- **Retested:** 2026-08-25 · build de produção local · pt-BR e en · 375 px e 430 px
- **Result:** verified — 403/404 permaneceram canônicos e localizados após reload, sem splash residual nem overflow; `pnpm check`, 22 testes PWA em navegador, 180 testes E2E e 8 verificações axe passaram.
