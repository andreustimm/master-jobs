---
id: AUTH-canonical-transition-boundaries
area: AUTH
title: Resolver transições de autenticação e autorização sem conteúdo residual
persona: Candidato após falha
journey: J-switch-workspace-screen
expected: Login, recovery, callback, papéis, sessão expirada e recursos revogados terminam no resultado canônico sem revelar conteúdo anterior
entry_points: /login; /login/forgot; /login/reset; /login/callback; /p/[slug]
qa_status: pass
bug_ids: BUG-20260824-canonical-route-splash
fix_status: fixed
retest_status: pass
fix_commits: 7ba2890
evidence: tests/e2e/ui.mjs; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-repeated-reset-terminal.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-impersonated-target-terminal.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-impersonation-ended-terminal.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-candidate-forbidden-admin-goal.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/recruiter-forbidden-candidate-goal.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps:
---

Cobertura: candidato, recrutador, administrador, impersonação, sessão expirada, token inválido/repetido, 404 e revogação durante navegação.

O Full QA confirmou token consumido, impersonação e as respostas canônicas. O primeiro percurso revelou que o layout inserido por Flight deixava o splash inerte sobre 403/404 após reload. A correção passou a remover somente esse splash sem timer ativo; candidato e recrutador foram retestados em build de produção local, com HTTP 403 preservado, tela localizada visível e nenhuma camada residual.
