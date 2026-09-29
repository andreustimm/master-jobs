---
id: SRCH-track-primary-archive
area: SRCH
title: Trocar a trilha principal, arquivar e restaurar
persona: Andreus em triagem
journey: J-manage-target-tracks
expected: Só uma trilha é principal; a arquivada some do seletor de Vagas e volta ao restaurar, com seus termos
entry_points: /searches; /searches/tracks/<id>; /jobs
qa_status: pass
bug_ids: BUG-20260921-track-selector-two-principal
fix_status: fixed
retest_status: pass
fix_commits: a57fc6a
evidence: evidence/2026-09-29T141137897408Z-1d3a7255-trilha-principal-391/seletor-apos-promover.png; evidence/2026-09-29T141137897408Z-1d3a7255-trilha-principal-391/seletor-apos-arquivar.png; evidence/2026-09-29T141137897408Z-1d3a7255-trilha-principal-391/seletor-restaurado.png
last_report: docs/qa/reports/2026-09-29T141137897408Z-1d3a7255-trilha-principal-391.md
overlaps: JOBS-track-selector-fit
---

A trilha principal não pode ser arquivada: a mensagem pede para promover
outra antes. Arquivar pausa os termos da trilha; restaurar os retoma e
recalcula o fit. Vagas abre na trilha principal nova depois da troca.
