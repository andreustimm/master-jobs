---
id: JOBS-new-account-unscored-board
area: JOBS
title: Conta nova vê as vagas antes de ter nota
persona: Candidato convidado sem perfil
journey: J-trust-the-filtered-board
expected: Com a trilha principal ainda sem nota, /jobs e o início listam as vagas abertas com o corte padrão de Score e mostram o aviso de nota pendente; depois da repontuação o aviso some e o corte volta a valer
entry_points: /jobs; /
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-score-range; PROF-rescore-status-visibility
---

Issue #279. Vaga sem nota do candidato da sessão não é cortada pela faixa de
Score (regra 8: ausência é neutra); a ordenação por aderência a leva para o fim.

A conferir: o total de `/jobs` sem parâmetros é o de vagas abertas, não zero; o
aviso `jobs-notice-scores_pending` aparece em `/jobs` e `cockpit-scores-pending`
no início, com o texto em inglês quando a interface está em inglês; como dono
(com notas), nenhum dos dois avisos aparece e o total continua o do corte de 45.
