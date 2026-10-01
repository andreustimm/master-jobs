---
id: SRCH-term-validation
area: SRCH
title: Receber uma mensagem clara para termo inválido ou repetido
persona: Andreus em triagem
journey: J-save-term-search
expected: Termo curto, longo, com caractere não aceito ou já salvo mostra a mensagem própria, e o repetido oferece o link para o termo existente
entry_points: /searches
qa_status: blocked-decision
bug_ids: BUG-20260921-long-term-cut-silently
fix_status: pending
retest_status:
fix_commits:
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-term-input-mistreated-baseline-duplicado-toast.png; evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-term-input-mistreated-baseline-limite-21.png; docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-term-input-mistreated/01-61-chars-cortado-salvo.png
last_report: docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
overlaps: SRCH-save-term-from-jobs
---

Tentar "a", um termo de 61 caracteres, "<script>" e uma grafia equivalente
de um termo já salvo ("Tech Lead" depois de "techlead"). Nenhum caso cria
termo. O link "ver o termo"
leva até ele. Com 20 termos ativos, o 21º é recusado com a mensagem do
limite.

Re-found em 29/09 (QA full do release candidate 1.29): mesmo sintoma —
termo colado com 61 caracteres continua cortado para 60 e salvo sem a
mensagem de termo longo. `maxlength=60` no campo ainda impede o envio do
texto inteiro. Sem fix aplicado desde 21/09.
