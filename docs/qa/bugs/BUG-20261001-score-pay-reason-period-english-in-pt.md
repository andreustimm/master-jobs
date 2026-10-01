# BUG-20261001-score-pay-reason-period-english-in-pt: motivo de remuneração do score mostra o período em inglês com a interface em pt-BR

- **Status:** verified
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao ler a explicação do score no detalhe da vaga com a interface em pt-BR
- **Scenarios:** JOBS-english-keeps-posting-data
- **Found:** 2026-09-29 · **Report:** revisão L1 da PR #408 (issue #395), aberta como issue #426
- **Origin:** espelho de `BUG-20260929-jobs-list-english-ui-shows-portuguese`
  (verified): lá o literal era português com a interface em inglês; aqui o
  sufixo de período fica em inglês com a interface em português.

## Summary

O scorer grava o rótulo de remuneração já formatado e sem idioma
(`$4,000/month`, `$30,000 total (2 meses)`) nos parâmetros de `comp.*`. Em
`/jobs/<id>`, a explicação do score mostrava esse texto como veio: "/month"
com a interface em pt-BR, e "total (2 meses)" com a interface em inglês.

## Reproduction

- **Environment:** build de produção local (`run-isolated.mjs`), PostgreSQL
  descartável, vaga de fixture com motivo `comp.below` gravado como
  `$4,000/month`.

1. Abrir `/jobs/904000004` com `jho_locale=pt-BR`.
2. Ler o bloco `score-reasons`.

**Expected:** `$4,000/mês`.
**Actual (antes):** `$4,000/month`.

## Evidence

- `tests/e2e/ui/i18n.mjs`: casos "motivo de remuneração do score em pt-BR
  localiza o período" e "... em inglês mantém o período em inglês".
- `tests/score-message-money.test.ts`: dez casos a partir da saída real do
  scorer, atravessando o portão de leitura (`scoreMessages`).

## Fix

- **Root cause:** `renderScoreMessage` interpolava `params.label` sem tocar
  nele; o sufixo de período nasce no scorer, que é domínio puro e não conhece
  o idioma de quem lê.
- **Fix commit:** e7000607 — `renderScoreMessage` troca o sufixo pelas chaves
  `jobs.moneyPeriod*` e `jobs.moneyProject*` na borda de exibição. O scorer
  não mudou: a saída gravada é a mesma, sem aumento de `SCORER_VERSION`.
- **Regression test:** `tests/score-message-money.test.ts` (6 casos
  reprovam no código anterior) e `tests/e2e/ui/i18n.mjs`.

## Verification

- **Retested:** 2026-10-01 · QA targeted da PR #430
  (`docs/qa/reports/2026-10-01T165500Z-pr430-motivo-remuneracao-idioma-426.md`).
- **Result:** verified — com `jho_locale=pt-BR` o bloco mostra `$4,000/mês` e
  nenhum "/month"; com `jho_locale=en` mostra `$4,000/month` e nenhum "/mês".
  Cada leitura é uma navegação nova a `/jobs/<id>` com o cookie de idioma, na
  automação da área `i18n`; não houve sessão manual de browser nesta rodada.
