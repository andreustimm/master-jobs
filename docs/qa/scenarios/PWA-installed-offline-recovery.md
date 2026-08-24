---
id: PWA-installed-offline-recovery
area: PWA
title: Recuperar uma tela instalada após queda de conexão
persona: Candidato após falha
journey: J-recover-offline-access
expected: A falha mostra uma única mensagem localizada, preserva o destino e a tentativa após reconectar carrega conteúdo atual da rede
entry_points: /jobs; /pipeline
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/reports/2026-08-24-task-03-offline-shell.md
last_report: docs/qa/reports/2026-08-24-task-03-offline-shell.md
overlaps: NAV-failed-screen-retry
---

Cobertura: troca suave offline, abertura completa instalada, recarga repetida e recuperação explícita sem replay automático.

Chromium percorreu queda durante a troca, retry duplo coalescido, três destinos completos offline e recuperação online no build isolado.
