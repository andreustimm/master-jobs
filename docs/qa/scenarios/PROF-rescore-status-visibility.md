---
id: PROF-rescore-status-visibility
area: PROF
title: Confirmar atualização do ranking após salvar o currículo
persona: Andreus em triagem noturna
journey: J-refresh-candidate-ranking
expected: Depois de salvar um CV alterado, a área do candidato mostra a atualização enfileirada e preserva o estado após recarregar
entry_points: /candidate
qa_status: pass
bug_ids: BUG-20260929-rescore-zero-jobs-misleading-coverage
fix_status: fixed
retest_status: pass
fix_commits: 43ecd2d
evidence: docs/qa/evidence/2026-09-29T144500Z-codex387-zero-vagas/zero-incremental.png
last_report: docs/qa/reports/2026-09-29T144500Z-codex387-zero-vagas.md
overlaps:
---

Cobertura funcional e experiencial do caminho principal, incluindo locale e leitura independente após refresh.

Migração PostgreSQL: percurso local confirmado em 10/09. Texto e rótulo novos
persistiram após refresh e no histórico; estado Na fila permaneceu verdadeiro.
Não é prova de processamento concluído pelo worker nem de configuração remota.

Reteste #387: distinguir recusa weakCv de conclusão incremental com noJobsUpdated; zero vagas no recorte de lacunas não confirma cobertura. Conferir texto localizado, refresh e 375px.
