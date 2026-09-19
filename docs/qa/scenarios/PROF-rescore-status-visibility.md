---
id: PROF-rescore-status-visibility
area: PROF
title: Confirmar atualização do ranking após salvar o currículo
persona: Andreus em triagem noturna
journey: J-refresh-candidate-ranking
expected: Depois de salvar um CV alterado, a área do candidato mostra a atualização enfileirada e preserva o estado após recarregar
entry_points: /candidate
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-save-cv-ranking-refresh-baseline-queued.png; docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-save-cv-ranking-refresh-baseline-version-read.png
last_report: docs/qa/reports/2026-09-18T202222983242Z-8870c32d-release-candidate-1.13.1-full.md
overlaps:
---

Cobertura funcional e experiencial do caminho principal, incluindo locale e leitura independente após refresh.

Migração PostgreSQL: percurso local confirmado em 10/09. Texto e rótulo novos
persistiram após refresh e no histórico; estado Na fila permaneceu verdadeiro.
Não é prova de processamento concluído pelo worker nem de configuração remota.
