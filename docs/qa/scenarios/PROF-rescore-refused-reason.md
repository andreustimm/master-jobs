---
id: PROF-rescore-refused-reason
area: PROF
title: Currículo curto demais mostra o motivo da recusa e o que fazer
persona: Candidato convidado sem perfil
journey: J-refresh-candidate-ranking
expected: Com um currículo sem skill reconhecida, o cartão Atualização do ranking mostra Trilha não montada com o motivo (currículo curto ou sem competência reconhecida) e a saída (colar o currículo completo ou importar o PDF), localizado em português e inglês, e sobrevive ao refresh
entry_points: /candidate
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PROF-rescore-status-no-cv; PROF-rescore-status-visibility
---

Comportamento novo da #280: antes a recusa aparecia como Falha na atualização,
sem motivo. Colar um texto com mais de 100 caracteres e nenhuma skill do
catálogo; esperar a fatia; conferir o estado `refused` (`data-reason="weakCv"`)
em 375 px e em inglês. Depois salvar um currículo completo e ver o cartão sair
da recusa.
