---
id: SRCH-new-jobs-count
area: SRCH
title: Ver quantas vagas novas cada termo trouxe desde a última visita
persona: Andreus em triagem
journey: J-save-term-search
expected: O contador de novas leva a Vagas filtrada pelo termo, as novas aparecem marcadas, e a contagem cai depois da visita
entry_points: /searches; /jobs?by=<id-do-termo>
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report: docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
overlaps: JOBS-term-filter-descriptions
---

Uma vaga trazida por dois termos conta nos dois e aparece uma vez na
lista. Pré-carregar o link (passar o mouse) não conta como visita; só abrir
a lista conta. A contagem zerada sobrevive à recarga.
