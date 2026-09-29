# BUG-20260929-pwa-filter-overlay-blocks-same-screen: filtro na mesma tela em Vagas abre overlay opaco de carregamento (regressão do contrato #220)

- **Status:** open
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus no celular
- **Journey Step:** J-switch-workspace-screen, passo de aplicar um filtro sem trocar de rota
- **Scenarios:** NAV-same-screen-soft-transition; NAV-slow-screen-truthful
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
- **Origin:** regressão do contrato fechado pela issue #220 ("Reservar o overlay
  opaco para troca de rota"), que exigia transição suave quando só filtro,
  ordem, página ou densidade mudam no mesmo pathname.

## Summary

Aplicar um filtro rápido em `/jobs` (Não triadas, Com salário,
Recém-publicadas) — sem trocar de rota — abre um overlay opaco de tela cheia
com "Ainda estamos carregando…" depois de aproximadamente 3 segundos.
Reproduzido 3/3. A issue #220 fechou exatamente esse contrato: mudança só de
filtro/ordem/página/densidade no mesmo pathname deve usar transição suave e
manter a tela interativa, reservando o overlay opaco para troca de rota. Esta
sessão mostra que o contrato voltou a quebrar para pelo menos estes três
filtros.

## Reproduction

- **Charter:** CH-mobile-responsive-regression · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210), 375×812, persona Andreus
  no celular

1. Abrir `/jobs` com uma lista carregada.
2. Alternar o filtro "Não triadas", depois "Com salário", depois
   "Recém-publicadas", sem trocar de rota.
3. Observar a tela ~3 s depois de cada clique.

**Expected:** transição suave, tela permanece interativa (contrato da issue
#220).
**Actual:** overlay opaco de tela cheia "Ainda estamos carregando…" cobre a
tela, 3/3 tentativas.

## Evidence

- Reproduzido 3/3 nesta sessão (lane pwa); sem captura de tela dedicada —
  ver debrief "Lane pwa" no relatório desta rodada para a sequência exata.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
