---
id: PWA-installed-offline-recovery
area: PWA
title: Recuperar uma tela instalada após queda de conexão
persona: Candidato após falha
journey: J-recover-offline-access
expected: A falha mostra uma única mensagem localizada, preserva o destino e a tentativa após reconectar carrega conteúdo atual da rede
entry_points: /jobs; /pipeline
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/reports/2026-08-24-task-03-offline-shell.md; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/recovery-offline.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/recovery-online-restored.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps: NAV-failed-screen-retry
---

Cobertura: troca suave offline, abertura completa instalada, recarga repetida e recuperação explícita sem replay automático.

Chromium percorreu queda durante a troca, retry duplo coalescido, três destinos completos offline e recuperação online no build isolado.

O Full QA confirmou o worker, os caches permitidos e a recuperação online, mas o driver manteve a rota residente quando ficou offline. Verificação pendente: instalar em iPhone físico, desligar a rede, abrir outro destino, restaurar a rede e usar retry.
