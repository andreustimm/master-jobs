---
id: PROF-rescore-recent-first
area: PROF
title: As vagas mais recentes ganham nota primeiro depois de salvar o currículo
persona: Candidato convidado sem perfil
journey: J-refresh-candidate-ranking
expected: Logo depois de salvar o currículo, enquanto a área do candidato ainda mostra Na fila/Pontuando, as vagas mais recentes da tela Vagas já aparecem com nota e as mais antigas ainda sem nota (neutras); em poucas agendas de 10 min todas têm nota, e o estado sobrevive ao refresh
entry_points: /candidate; /jobs
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PROF-rescore-new-profile-minutes; PROF-rescore-status-visibility
---

Comportamento novo da #288: toda pontuação anda em lotes de 100 vagas, da mais
recente para a mais antiga, com cursor. Conferir em produção, com acervo real e
o SQL do agendador reaplicado: ordenar Vagas por data logo depois de salvar e
ver as primeiras com nota; as antigas sem nota continuam neutras (#279). Fora
de produção a agenda não existe e a rota de cron responde 503 — só o `after()`
pontua ali.
