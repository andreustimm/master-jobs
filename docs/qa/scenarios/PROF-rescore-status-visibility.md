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
evidence: docs/qa/evidence/2026-08-25T214402000000Z-fb9a9b34-rescore-status-targeted/save-cv-pending.png; tests/e2e/ui.mjs
last_report: docs/qa/reports/2026-08-25T214402000000Z-fb9a9b34-rescore-status-targeted.md
overlaps:
---

Cobertura funcional e experiencial do caminho principal, incluindo locale e leitura independente após refresh.
