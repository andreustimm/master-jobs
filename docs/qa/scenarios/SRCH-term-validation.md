---
id: SRCH-term-validation
area: SRCH
title: Receber uma mensagem clara para termo inválido ou repetido
persona: Andreus em triagem
journey: J-save-term-search
expected: Termo curto, longo, com caractere não aceito ou já salvo mostra a mensagem própria, e o repetido oferece o link para o termo existente
entry_points: /searches
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: SRCH-save-term-from-jobs
---

Tentar "a", um termo de 61 caracteres, "<script>" e uma grafia equivalente
de um termo já salvo ("Tech Lead" depois de "techlead"). Nenhum caso cria
termo. O link "ver o termo"
leva até ele. Com 20 termos ativos, o 21º é recusado com a mensagem do
limite.
