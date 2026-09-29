# BUG-20260929-stale-tab-login-inert: aba antiga fica presa no splash em /login depois de sair em outra aba

- **Status:** open
- **Impact (user-side):** Blocks-Completion
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem; Recrutadora convidada
- **Journey Step:** J-switch-workspace-screen, passo de navegar numa aba depois de a sessão terminar em outra
- **Scenarios:** AUTH-canonical-transition-boundaries
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
- **Origin:** mesma família de `BUG-20260824-canonical-route-splash` (verified,
  fechado para o gatilho de reload em 403/404), com um gatilho novo — não é
  regressão do mesmo caminho, é um caminho novo com o mesmo sintoma de shell
  preso no splash.

## Summary

Quando a sessão termina numa aba (logout, ou expiração), a aba antiga que
ficou aberta em outra tela mostra um comportamento quebrado: um clique no
menu leva a `/login`, mas o shell fica `inert` com "Ainda estamos
carregando…" por mais de 20 segundos — só recarregar a página libera a
tela. Reproduzido 3/3 (candidata ×2, recrutadora ×1). Quem depende de
múltiplas abas (comum ao comparar vagas ou copiar dados entre telas) fica
travado sem explicação.

## Reproduction

- **Charter:** CH-auth-boundary-recovery; CH-recruiter-private-boundary · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), duas abas na mesma sessão

1. Abrir duas abas autenticadas na mesma conta.
2. Sair (logout) numa das abas.
3. Na aba antiga, clicar num item do menu.
4. Observar a tela por mais de 20 s.

**Expected:** a aba antiga detecta a sessão encerrada e leva a `/login`
normalmente, sem shell preso.
**Actual:** shell fica `inert` com "Ainda estamos carregando…" por >20 s; só
reload libera.

## Evidence

- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-auth-boundary-recovery/stale-tab-login-inert.png`
- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-recruiter-private-boundary/stale-tab-login-inert-recruiter.png`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
