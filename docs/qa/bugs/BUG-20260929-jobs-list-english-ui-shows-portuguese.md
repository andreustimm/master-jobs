# BUG-20260929-jobs-list-english-ui-shows-portuguese: lista de vagas em inglês mostra literais em português

- **Status:** open
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

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
