---
id: SRCH-track-primary-archive
area: SRCH
title: Trocar a trilha principal, arquivar e restaurar
persona: Andreus em triagem
journey: J-manage-target-tracks
expected: Só uma trilha é principal; a arquivada some do seletor de Vagas e volta ao restaurar, com seus termos
entry_points: /searches; /searches/tracks/<id>; /jobs
qa_status: blocked-decision
bug_ids: BUG-20260921-track-selector-two-principal; BUG-20260929-track-evidence-ignores-candidate-cv
fix_status: pending
retest_status:
fix_commits:
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-target-track-edit-archive-baseline-seletor-dois-principal.png
last_report: docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
overlaps: JOBS-track-selector-fit
---

A trilha principal não pode ser arquivada: a mensagem pede para promover
outra antes. Arquivar pausa os termos da trilha; restaurar os retoma e
recalcula o fit. Vagas abre na trilha principal nova depois da troca.

O caso do CV corrente foi separado em `BUG-20260929-track-evidence-ignores-candidate-cv`:
o reteste desta correção será registrado no relatório da branch. O cenário
continua bloqueado pela decisão pendente do seletor com dois rótulos
`PRINCIPAL` (`BUG-20260921-track-selector-two-principal`).
