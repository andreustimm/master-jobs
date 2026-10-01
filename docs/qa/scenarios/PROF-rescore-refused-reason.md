---
id: PROF-rescore-refused-reason
area: PROF
title: Currículo curto demais mostra o motivo da recusa e o que fazer
persona: Candidato convidado sem perfil
journey: J-refresh-candidate-ranking
expected: Com um currículo sem skill reconhecida, o cartão Atualização do ranking mostra Trilha não montada com o motivo (currículo curto ou sem competência reconhecida) e a saída (colar o currículo completo ou importar o PDF), localizado em português e inglês, e sobrevive ao refresh
entry_points: /candidate
qa_status: pass
bug_ids: BUG-20260929-rescore-zero-jobs-misleading-coverage
fix_status: fixed
retest_status: pass
fix_commits: 43ecd2d
evidence: docs/qa/evidence/2026-09-29T144500Z-codex387-zero-vagas/zero-incremental.png
last_report: docs/qa/reports/2026-09-29T144500Z-codex387-zero-vagas.md
overlaps: PROF-rescore-status-no-cv; PROF-rescore-status-visibility
---

Comportamento novo da #280: antes a recusa aparecia como Falha na atualização,
sem motivo. Colar um texto com mais de 100 caracteres e nenhuma skill do
catálogo; esperar a fatia; conferir o estado `refused` (`data-reason="weakCv"`)
em 375 px e em inglês. Depois salvar um currículo completo e ver o cartão sair
da recusa.

Reteste #387: distinguir recusa weakCv de conclusão incremental com noJobsUpdated; zero vagas no recorte de lacunas não confirma cobertura. Conferir texto localizado, refresh e 375px.
