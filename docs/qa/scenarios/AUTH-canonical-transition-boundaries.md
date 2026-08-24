---
id: AUTH-canonical-transition-boundaries
area: AUTH
title: Resolver transições de autenticação e autorização sem conteúdo residual
persona: Candidato após falha
journey: J-switch-workspace-screen
expected: Login, recovery, callback, papéis, sessão expirada e recursos revogados terminam no resultado canônico sem revelar conteúdo anterior
entry_points: /login; /login/forgot; /login/reset; /login/callback; /p/[slug]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui.mjs; docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-first-party-recruiter-jobs.png
last_report: docs/qa/reports/2026-08-24T143638469000Z-8c1fe201-navigation-contract-retest.md
overlaps:
---

Cobertura: candidato, recrutador, administrador, impersonação, sessão expirada, token inválido/repetido, 404 e revogação durante navegação.

Os resultados canônicos passaram na suíte automatizada em todos os papéis e falhas, sem conteúdo protegido na transição nem restauração de sucesso/token por cache. A jornada pública ainda precisa ser percorrida pela persona primária antes de voltar a estado terminal.

O replay público adjacente do recrutador confirmou Vagas como superfície autorizada e 403 canônico, sem conteúdo candidato, ao abrir `/candidate`; ele não substitui a sessão pendente de Candidato após falha.
