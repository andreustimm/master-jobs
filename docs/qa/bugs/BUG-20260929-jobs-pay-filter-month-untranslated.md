# BUG-20260929-jobs-pay-filter-month-untranslated: "/month" fica fixo em inglês com a interface em pt-BR

- **Status:** fixed
- **Impact (user-side):** Cosmetic
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, no filtro de faixa salarial
- **Scenarios:** JOBS-pay-filter
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

No filtro de faixa salarial, com a interface em pt-BR, o sufixo "/month"
permanece fixo em inglês em vez de "/mês". Direção oposta do defeito de
vazamento de português na interface em inglês, mesma causa provável
(literal fora do dicionário).

## Reproduction

- **Charter:** CH-filtered-board-numbers-agree · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210), pt-BR

1. Com a interface em pt-BR, abrir `/jobs`.
2. Abrir o filtro de faixa salarial.
3. Ler o sufixo ao lado do valor.

**Expected:** "/mês".
**Actual:** "/month".

## Evidence

- Leitura direta da tela nesta sessão (lane jobsnav); ver debrief "Lane
  jobsnav" no relatório desta rodada.

## Fix

- **Root cause:** `formatMoney` (`src/core/money.ts`) só sabia escrever o
  sufixo de período em inglês; com a interface em pt-BR o valor normalizado
  da faixa salarial (`cur`/`per` da URL, mostrado junto de cada vaga) saía
  como "/month" em vez de "/mês".
- **Fix commit:** d433dcf5 — `formatMoney` passou a localizar o sufixo pelo
  `locale` recebido. Revisão posterior (achado da `deep-review` de #408)
  moveu as palavras para o dicionário (`jobs.moneyPeriod*` em `pt-BR.ts` e
  `en.ts`) e fez `app/joblist.tsx` passá-las como rótulos, para o módulo
  `src/core/money.ts` continuar sem texto de interface embutido (regra 9).
- **Regression test:** `tests/money.test.ts` ("localizes the period suffix
  used on the jobs board") e `tests/e2e/ui/i18n.mjs` (confere "/mês" em
  `/jobs?...&cur=BRL&per=month` com a interface em pt-BR).

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**

## Reteste da issue #395

Correção d433dcf; relatório: docs/qa/reports/2026-09-29T143300Z-d433dcf-vagas-idioma-395.md.
Unitários e E2E passaram no recorte; a fixture manual não possui salário.
