---
id: PROF-rescore-new-profile-minutes
area: PROF
title: Candidato novo tem trilha principal e notas minutos depois de salvar o currículo
persona: Candidato convidado sem perfil
journey: J-refresh-candidate-ranking
expected: Depois de criar o perfil com currículo (ou salvar/importar um), a área do candidato sai de Na fila/Pontuando para Atualizado em poucos minutos, a tela Vagas mostra notas para a trilha principal e o estado sobrevive ao refresh
entry_points: /candidate; /jobs
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PROF-create-own-profile; PROF-rescore-status-visibility
---

Comportamento novo da #280: a fatia de repontuação roda no `after()` da ação que
salvou o currículo, sem esperar a varredura diária. Conferir com currículo real
(com skills do catálogo) e acervo de produção: a primeira fatia cria a trilha
principal; o que não couber em 20 s continua em `/api/cron/score` (agendador da
#281) — sem ele, anotar quanto tempo levou até Atualizado.
