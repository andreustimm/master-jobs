---
id: SRCH-track-without-evidence
area: SRCH
title: Ver que uma trilha ainda não tem evidência no currículo
persona: Andreus em triagem
journey: J-manage-target-tracks
expected: O editor sinaliza as palavras-chave sem evidência e a trilha não revisada, sem inventar experiência
entry_points: /searches/tracks/<id>
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-target-track-edit-archive-baseline-sem-evidencia.png
last_report: docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
overlaps: SRCH-track-create-edit
---

Criar uma trilha de uma tecnologia ausente do currículo (por exemplo PHP).
O aviso aparece no editor; o fit da trilha continua calculado.
