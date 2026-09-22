---
id: SRCH-recruiter-refused
area: SRCH
title: Recusar trilhas e termos a uma recrutadora vinculada
persona: Recrutadora convidada
journey: J-save-term-search
expected: A recrutadora não vê Buscas no menu, e abrir /searches ou uma trilha pela URL é recusado sem revelar dados do candidato
entry_points: /searches; /searches/tracks/<id>
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-recruiter-searches-refused-baseline-searches.png; evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-recruiter-searches-refused-baseline-track-1.png
last_report: docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
overlaps: AUTH-canonical-transition-boundaries
---

A recrutadora continua lendo o currículo do candidato vinculado. Nenhuma
tela dela mostra nome de trilha, termo ou faixa de pagamento. O perfil
público do candidato também não mostra nada disso.
