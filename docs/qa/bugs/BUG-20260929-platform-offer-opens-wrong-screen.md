# BUG-20260929-platform-offer-opens-wrong-screen: oferta "Buscar nas plataformas" em Vagas abre Nova trilha vazia em vez de Buscas preenchida

- **Status:** open
- **Impact (user-side):** Blocks-Completion
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-save-term-search, passo de salvar um termo a partir da oferta em Vagas
- **Scenarios:** SRCH-save-term-from-jobs
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Em Vagas, ao buscar um termo sem resultado suficiente no acervo, o produto
oferece "Buscar nas plataformas" como atalho para levar aquele termo a
Buscas. Clicar na oferta não abre Buscas com o termo preenchido — abre a
tela de Nova trilha vazia. Tentar salvar o termo manualmente a partir daí
falha com "Esse termo já está salvo", deixando a pessoa sem conseguir
completar a ação que a própria oferta prometia.

## Reproduction

- **Charter:** CH-target-track-edit-archive (fluxo iniciado a partir de Vagas) · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), 1280×900, pt-BR, conta
  `qa-full-candidate`

1. Em Vagas, buscar o termo "laravel".
2. Clicar na oferta "Buscar nas plataformas".
3. Observar a tela que abre e tentar salvar o termo.

**Expected:** Buscas abre com o termo "laravel" preenchido, pronto para
salvar.
**Actual:** abre Nova trilha vazia; salvar o termo manualmente devolve "Esse
termo já está salvo".

## Evidence

- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-target-track-edit-archive/01-sugestao-laravel.png`
- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-target-track-edit-archive/02-criar-trilha-termo-ja-salvo.png`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
