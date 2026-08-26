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
evidence: tests/e2e/ui.mjs; tests/scoring-queue.test.ts; tests/candidate-queue-status-ui.test.ts
last_report: docs/qa/reports/2026-08-26T004639000000Z-pwa-header-safe-area-targeted.md
overlaps: PROF-rescore-status-visibility; PROF-rescore-status-privacy
---

Ramo de primeira utilização da jornada de atualização do ranking. A orientação
precisa permanecer localizada e sem chave de tradução exposta em retrato,
paisagem, tablet e desktop.
