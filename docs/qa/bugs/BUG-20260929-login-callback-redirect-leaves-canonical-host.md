# BUG-20260929-login-callback-redirect-leaves-canonical-host: token inválido em /login/callback redireciona para fora de 127.0.0.1 e perde idioma

- **Status:** open
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-switch-workspace-screen, ao voltar de um link de callback com token inválido
- **Scenarios:** AUTH-canonical-transition-boundaries
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Regra 12 exige que `dev`/`start` façam bind só em `127.0.0.1`. Abrir
`/login/callback` com um token inválido devolve um 303 para
`http://localhost:3210/login?error=invalid` — saindo do host canônico
`127.0.0.1` para `localhost` — e a mensagem volta em inglês ("Incorrect
email or password.") mesmo quando a sessão estava em pt-BR, perdendo o
idioma escolhido. Precisa ser conferido fora de `next dev` para confirmar se
o comportamento persiste em build de produção.

## Reproduction

- **Charter:** CH-first-party-navigation-inventory · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), pt-BR

1. Com a interface em pt-BR, abrir `/login/callback` com um token inválido.
2. Observar a URL de redirecionamento e o idioma da mensagem de erro.

**Expected:** redirecionamento permanece em `127.0.0.1` e preserva o idioma
da sessão.
**Actual:** 303 para `http://localhost:3210/login?error=invalid`, mensagem em
inglês.

## Evidence

- Leitura direta da resposta HTTP nesta sessão (lane jobsnav); ver debrief
  "Lane jobsnav" no relatório desta rodada. Confirmar fora de `next dev`
  antes de considerar fechado.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** `NextRequest.url` normaliza o loopback `127.0.0.1` para
  `localhost`; construir o 303 com `new URL(..., request.url)` vazava essa
  origem normalizada para o navegador.
- **Fix commit:** `0276c6e`, com o contrato E2E ajustado em `05a4102`.
- **Regression test:** `tests/login-callback-route.test.ts` verifica o
  `NextRequest` real e o `Location` relativo; `tests/e2e/ui/canonical-flows.mjs`
  verifica origem canônica e mensagem pt-BR no build standalone.

## Verification

<!-- filled when status moves to verified -->
- **Retested:** 2026-09-29, `pnpm test:e2e --manual --areas canonical-flows`
  em build standalone, com navegador público em `127.0.0.1:51401`, locale
  pt-BR e viewport 375 × 812.
- **Result:** PASS no percurso do token inválido: a URL permaneceu em
  `127.0.0.1:51401/login?error=invalid`, a mensagem foi lida em português
  antes e depois de um reload independente. Evidência visual ignorada em
  `docs/qa/evidence/2026-09-29T-login-callback-ptbr/`.
