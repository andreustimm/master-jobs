# BUG-20260929-post-login-focus-skips-header: depois do login o foco pula o cabeçalho sem link de pular conteúdo

- **Status:** verified
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Candidato por teclado
- **Journey Step:** J-switch-workspace-screen, logo após o login
- **Scenarios:** NAV-accessible-mobile-transition
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Depois do login, o foco cai direto no conteúdo principal (primeiro preset da
tela), pulando o cabeçalho, e não há link "pular para o conteúdo" (skip
link) para quem navega por teclado voltar ao cabeçalho sem percorrer toda a
tela. Quem usa teclado ou leitor de tela perde o contexto de navegação
global logo na primeira tela após entrar.

## Reproduction

- **Charter:** CH-keyboard-navigation-feature · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), navegação só por
  teclado

1. Fazer login só por teclado.
2. Observar onde o foco pousa na tela seguinte.
3. Tentar localizar um link "pular para o conteúdo".

**Expected:** foco previsível (cabeçalho ou um skip link disponível) depois
do login.
**Actual:** foco cai no main (primeiro preset), sem skip link.

## Evidence

- Observado nesta sessão (lane jobsnav, candidato C14); ver debrief "Lane
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

## Reteste #398

Interface pública, teclado e recarga confirmaram o recorte corrigido. Relatório: docs/qa/reports/2026-09-29T145000Z-acessibilidade-398.md.
VoiceOver/pinch em aparelho físico permanece pendente no cenário abrangente.
