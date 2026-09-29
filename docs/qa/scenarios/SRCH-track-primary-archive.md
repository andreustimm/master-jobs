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
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-target-track-edit-archive-baseline-seletor-dois-principal.png; docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-target-track-edit-archive/03-principal-sem-evidencia-com-cv.png; docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-target-track-edit-archive/04-seletor-dois-principal.png
last_report: docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
overlaps: JOBS-track-selector-fit
---

A trilha principal não pode ser arquivada: a mensagem pede para promover
outra antes. Arquivar pausa os termos da trilha; restaurar os retoma e
recalcula o fit. Vagas abre na trilha principal nova depois da troca.

Re-found em 29/09 (QA full do release candidate 1.29): o seletor de Vagas
ainda mostra dois botões "PRINCIPAL" depois da troca (sem fix desde 21/09).
Achado novo na mesma sessão: ao tornar a trilha principal, o painel de
evidência mostra "perfil padrão" em vez do CV real da candidata logada —
contradiz `/candidate`. Ver `BUG-20260929-track-evidence-ignores-candidate-cv`.
