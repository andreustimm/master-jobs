---
id: AUTH-canonical-transition-boundaries
area: AUTH
title: Resolver transições de autenticação e autorização sem conteúdo residual
persona: Candidato após falha
journey: J-switch-workspace-screen
expected: Login, recovery, callback, papéis, sessão expirada e recursos revogados terminam no resultado canônico sem revelar conteúdo anterior
entry_points: /login; /login/forgot; /login/reset; /login/callback; /p/[slug]
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui.mjs
last_report: docs/qa/reports/2026-08-24-task-04-first-party-navigation.md
overlaps:
---

Cobertura: candidato, recrutador, administrador, impersonação, sessão expirada, token inválido/repetido, 404 e revogação durante navegação.

Os resultados canônicos venceram em todos os papéis e falhas, sem conteúdo protegido na transição nem restauração de sucesso/token por cache.
