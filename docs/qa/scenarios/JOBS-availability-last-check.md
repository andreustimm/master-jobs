---
id: JOBS-availability-last-check
area: JOBS
title: Ver na vaga se ela continua disponível e quando foi conferida
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: A página da vaga mostra disponível com a data da última checagem quando a verificação respondeu; disponibilidade desconhecida quando nunca foi conferida; vencida quando a checagem tem mais de 14 dias; encerrada na origem depois de um 404/410, com o histórico da candidatura ainda visível; o estado sobrevive a recarga e cabe em 375 px
entry_points: /jobs/<id>
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-detail-owner-view-english
---

Novo em #223 (tarefa 04). A disponibilidade vem dos eventos de verificação
(`job_check_event`); vaga verificada antes dos eventos existirem aparece como
desconhecida até a próxima checagem, com a data da checagem antiga. Vaga
fechada pelo sync aparece encerrada, igual ao selo. Um 403 ou 5xx não muda o
que o último veredito conclusivo provou.
