---
id: PWA-offline-no-cache-degradation
area: PWA
title: Degradar honestamente sem shell persistido
persona: Candidato após falha
journey: J-recover-offline-access
expected: Sem worker ou armazenamento disponível não aparece sucesso falso nem dado anterior, e a próxima abertura online volta a funcionar
entry_points: /jobs
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/reports/2026-08-24-task-03-offline-shell.md
last_report: docs/qa/reports/2026-08-24-task-03-offline-shell.md
overlaps:
---

Cobertura: primeiro acesso offline, cota recusada e retorno online.

Um contexto sem worker falhou como o navegador, e outro com cota de um byte recebeu somente o 503 simples; ambos voltaram ao login online.
