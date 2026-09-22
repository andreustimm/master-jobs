---
id: JOBS-track-selector-fit
area: JOBS
title: Escolher a trilha em Vagas e comparar o fit de cada trilha no detalhe
persona: Andreus em triagem
journey: J-manage-target-tracks
expected: Vagas abre na trilha principal, a troca reordena pela trilha escolhida, e o detalhe mostra o fit de cada trilha ativa
entry_points: /jobs; /jobs?track=<id>; /jobs/<id>
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s4-detail-tracks.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: SRCH-track-primary-archive
---

Trilha ainda sem pontuação mostra o cartão de recálculo em vez de lista
vazia. Uma trilha inexistente na URL volta à principal com aviso. O detalhe
marca o fit calculado na hora quando a trilha ainda não foi pontuada.

Full 1.22.0 (2026-09-22): Vagas abre na Principal; trocar para a trilha nova muda a ordem e sobrevive ao reload; o detalhe mostra 80 na Principal e 84 na nova ('calculada agora'). Paper cut: trilha recém-criada ordena sem nota guardada e a lista não diz isso.
