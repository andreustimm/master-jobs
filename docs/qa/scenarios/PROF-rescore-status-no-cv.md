---
id: PROF-rescore-status-no-cv
area: PROF
title: Orientar candidato sem currículo salvo
persona: Andreus em triagem noturna
journey: J-refresh-candidate-ranking
expected: A área do candidato explica que falta um currículo e não apresenta o estado como idle, pendente ou atualizado
entry_points: /candidate
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-no-cv-ranking-state-baseline-mobile.png; docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-no-cv-ranking-state-baseline-landscape.png; docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-no-cv-ranking-state-baseline-return.png
last_report: docs/qa/reports/2026-09-18T202222983242Z-8870c32d-release-candidate-1.13.1-full.md
overlaps: PROF-rescore-status-visibility; PROF-rescore-status-privacy
---

Ramo de primeira utilização da jornada de atualização do ranking. A orientação
precisa permanecer localizada e sem chave de tradução exposta em retrato,
paisagem, tablet e desktop.

Migração PostgreSQL: percurso local confirmado em 10/09 com conta fictícia sem CV,
login real, refresh e retorno pelo histórico do navegador. Sem verificação remota.
