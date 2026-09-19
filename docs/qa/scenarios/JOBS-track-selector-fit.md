---
id: JOBS-track-selector-fit
area: JOBS
title: Escolher a trilha em Vagas e comparar o fit de cada trilha no detalhe
persona: Andreus em triagem
journey: J-manage-target-tracks
expected: Vagas abre na trilha principal, a troca reordena pela trilha escolhida, e o detalhe mostra o fit de cada trilha ativa
entry_points: /jobs; /jobs?track=<id>; /jobs/<id>
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: SRCH-track-primary-archive
---

Trilha ainda sem pontuação mostra o cartão de recálculo em vez de lista
vazia. Uma trilha inexistente na URL volta à principal com aviso. O detalhe
marca o fit calculado na hora quando a trilha ainda não foi pontuada.
