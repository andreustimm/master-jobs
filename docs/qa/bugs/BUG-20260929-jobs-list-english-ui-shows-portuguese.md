# BUG-20260929-jobs-list-english-ui-shows-portuguese: lista de vagas em inglês mostra literais em português

- **Status:** verified
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Recrutadora convidada
- **Journey Step:** J-trust-the-filtered-board, ao ler a lista de vagas com a interface em inglês
- **Scenarios:** JOBS-english-keeps-posting-data
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
- **Origin:** mesma classe de `BUG-20260921-job-detail-labels-untranslated`
  (verified, corrigido na tela de detalhe da vaga) — literal de interface fora
  do dicionário, agora na tela de lista em vez da de detalhe.

## Summary

Com a interface em inglês, a lista de vagas (`/jobs`) ainda serve dois
textos de interface em português: `aria-label="Fechar"` no modal de
publicação ("posting"), e a paginação mostra "51–100 de 5.273" em vez da
forma inglesa. É a mesma classe de defeito já corrigida na tela de detalhe
da vaga (`BUG-20260921-job-detail-labels-untranslated`) — outra tela, fora
da guarda de vazamento de português por não estar no array literal de rotas
medidas.

## Reproduction

- **Charter:** CH-recruiter-english-board · **Tour:** Configuration Tour
- **Environment:** `next dev` local (127.0.0.1:3210), conta recrutadora,
  interface em inglês

1. Entrar como a recrutadora e trocar a interface para inglês.
2. Abrir `/jobs` e abrir o modal de uma publicação.
3. Ler o `aria-label` do botão de fechar e a paginação.

**Expected:** todo texto de interface em inglês.
**Actual:** `aria-label="Fechar"` e paginação "51–100 de 5.273" em português.

## Evidence

- Leitura direta do HTML servido com `jho_locale=en` nesta sessão (lane
  jobsnav); ver debrief "Lane jobsnav" no relatório desta rodada.

## Fix

- **Root cause:** `aria-label="Fechar"` estava escrito literal em
  `app/job-modal.tsx`, e a paginação em `app/grid.tsx` formatava os números
  com `toLocaleString("pt-BR")` fixo e o conector " de " também literal —
  nenhum dos dois lia o dicionário nem o idioma da sessão.
- **Fix commit:** d433dcf5 — `aria-label` passou a usar `t("common.close")`
  e `Pagination` recebeu `locale` para formatar os números e `t("grid.of")`
  para o conector.
- **Regression test:** `tests/e2e/ui/i18n.mjs` (checa `aria-label="Close"` e
  `"... of ..."` sem `" de "` em `/jobs` com a interface em inglês).

## Verification

- **Retested:** 2026-09-29 · d433dcf5 · QA dirigido da PR #408
  (`docs/qa/reports/2026-09-29T143300Z-d433dcf-vagas-idioma-395.md`), interface
  pública via `agent-browser`.
- **Result:** verified — com `jho_locale=en`, o modal mostra `Close` e a
  paginação `1–6 of 6`/`PER PAGE`, e sobrevive à recarga; trocando para
  `jho_locale=pt-BR` e recarregando, a paginação volta a `1–6 de 6`/`POR
  PÁGINA` (o relatório manual não reabriu o modal nessa troca).
  `tests/e2e/ui/i18n.mjs` confere no CI o `aria-label="Close"` e a forma
  inglesa da paginação com `jho_locale=en`.

## Reteste da issue #395

Correção d433dcf; relatório: docs/qa/reports/2026-09-29T143300Z-d433dcf-vagas-idioma-395.md.
Interface, recarga e leitura independente confirmaram a correção.
