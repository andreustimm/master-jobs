# BUG-20260823-pipeline-empty-state-mixed-locale: Funil vazio mistura idiomas

- **Status:** verified
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Candidato por teclado
- **Journey Step:** J-switch-workspace-screen, step 2
- **Scenarios:** NAV-switch-screen-ready
- **Found:** 2026-08-23 · **Report:** docs/qa/reports/2026-08-23-task-02-loading-transicoes.md
- **Origin:**

## Summary

Ao chegar ao Funil com a interface em inglês, o candidato vê o título e a explicação em inglês, mas o card vazio em português. A tela funciona, porém a mistura reduz a confiança na troca de idioma.

## Reproduction

- **Charter:** CH-keyboard-screen-transition · **Tour:** Accessibility Tour
- **Environment:** laptop / 1280×900 / wifi local / en-US

1. Entrar normalmente com uma conta candidate sem itens no funil.
2. Abrir Jobs e navegar por teclado até Pipeline.
3. Ler o estado vazio depois que a transição termina.

**Expected:** Todo texto de interface do destino usa inglês.
**Actual:** O card vazio diz “Nada no funil ainda. Comece pela lista de vagas.”.

## Evidence

- docs/qa/evidence/2026-08-23-task-02-loading-transicoes/CH-keyboard-screen-transition-goal.png
- A recarga direta de `/pipeline` manteve a mesma mistura.
- docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-keyboard-screen-transition-pipeline-en.png
- docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-keyboard-screen-transition-mobile-en.png

## Fix

- **Root cause:** `app/pipeline/page.tsx` contém o estado vazio como literal JSX, fora do dicionário tipado.
- **Fix commit:** `bfd27a9`
- **Regression test:** `tests/e2e/ui.mjs` — entra como candidato com locale `en`, navega ao Funil, exige as três mensagens inglesas, recarrega e rejeita todas as equivalentes portuguesas.

## Verification

- **Retested:** 2026-08-24 · Candidato por teclado · `J-switch-workspace-screen` step 2 · `CH-keyboard-screen-transition`
- **Result:** verified — transição, recarga e viewport móvel exibiram somente a edição inglesa; o estado vazio continuou operável e sem overflow.
