---
id: PWA-offline-no-cache-degradation
area: PWA
title: Degradar honestamente sem shell persistido
persona: Candidato após falha
journey: J-recover-offline-access
expected: Sem worker ou armazenamento disponível não aparece sucesso falso nem dado anterior, e a próxima abertura online volta a funcionar
entry_points: /jobs
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/reports/2026-08-24-task-03-offline-shell.md; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/recovery-offline.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/recovery-online-restored.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps:
---

Cobertura: primeiro acesso offline, cota recusada e retorno online.

Um contexto sem worker falhou como o navegador, e outro com cota de um byte recebeu somente o 503 simples; ambos voltaram ao login online.

O Full QA automatizado repetiu esses resultados. O driver manteve a rota residente ao simular offline, divergência registrada em `recovery-offline.png`; a sessão real-user ainda precisa confirmar o retry depois da reconexão em uma instalação física.
