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
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
