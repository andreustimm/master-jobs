---
id: PWA-offline-private-absence
area: PWA
title: Abrir offline sem revelar conteúdo persistido de sessão
persona: Candidato após falha
journey: J-recover-offline-access
expected: O resultado offline contém apenas marca e instrução pública, sem login, perfil, currículo, vaga, candidatura ou remuneração anterior
entry_points: /jobs; /p/slug; /pipeline
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/reports/2026-08-24-task-03-offline-shell.md
last_report: docs/qa/reports/2026-08-24-task-03-offline-shell.md
overlaps:
---

Cobertura: aparelho compartilhado, perfil revogado, histórico, Cache Storage e recarga sem depender de logout.

A leitura real de todas as chaves e corpos do Cache Storage não encontrou nenhum marcador exclusivo das contas autenticadas.
