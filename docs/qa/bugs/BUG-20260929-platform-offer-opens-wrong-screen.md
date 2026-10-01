# BUG-20260929-platform-offer-opens-wrong-screen: oferta "Buscar nas plataformas" em Vagas abre Nova trilha vazia em vez de Buscas preenchida

- **Status:** verified
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

- **Root cause:** A oferta usava `/searches/tracks/new?term=...`, desviando o termo para o formulário de nova trilha; a tela Buscas também não lia `searchParams` para preencher o campo.
- **Fix commit:** `fix/oferta-termo-em-buscas` (PR #422); correção da revisão L1 na mesma branch.
- **Regression test:** `term-search E2E-001/E2E-020` em `tests/e2e/ui/searches.mjs` cobrem o destino, o preenchimento, o salvamento end-to-end numa trilha criada pela sugestão (não mais na principal), e a persistência após refresh. `tests/searches-offer.test.ts` (grep estático no texto-fonte) foi removido na correção da revisão: passava com o comportamento quebrado e falhava em refatoração neutra — o E2E é quem prova o comportamento.

## Verification

<!-- filled when status moves to verified -->
- **Retested:** 2026-09-29, viewport 375×812, pt-BR, cenário `SRCH-save-term-from-jobs`.
- **Result:** Pass — a oferta abriu `/searches?term=Laravel`, o campo permaneceu intacto, Laravel foi salvo uma vez na trilha principal e a leitura após refresh confirmou o estado.

## Re-found pela revisão (2026-10-01)

- A revisão L1 da PR #422 achou que o caminho explícito para a sugestão de
  trilha (`/searches/tracks/new?term=...`) tinha ficado sem entrada na
  interface: o único link para ele, a própria oferta, passou a ir direto para
  Buscas. Quem quisesse a sugestão (US-002) precisava digitar a URL à mão.
- **Fix:** o botão "Nova trilha" em Buscas agora carrega `?term=` quando a
  tela chegou com um termo pendente (da oferta), restaurando o caminho pela
  interface; o E2E-001 volta a criar a trilha pela sugestão, de ponta a ponta,
  em vez de só ler o formulário por `page.goto`.
- **Retested:** `node tests/e2e/run-isolated.mjs --areas searches`, 2026-10-01,
  80/80 verificações — inclui o novo passo clicando "Nova trilha" e criando a
  trilha sugerida.
