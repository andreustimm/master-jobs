---
id: AUTH-create-profile-refused-roles
area: AUTH
title: Quem não é candidato sem perfil não recebe o formulário
persona: Recrutadora convidada
journey: J-create-own-profile
expected: Recrutador, admin sem papel candidato e sessão emprestada (admin assumindo uma conta de candidato sem perfil) abrem /candidate e recebem 403, sem formulário de criação nem link na navegação
entry_points: /candidate
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s1-nav-renata-lap-1280-_candidate.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PROF-create-own-profile
---

A sessão emprestada é negada de propósito: criar o perfil é decisão da pessoa, não do admin que assume a identidade.

Full 1.22.0 (2026-09-22): Recrutadora, admin sem papel candidato e admin assumindo Nina: 403 em /candidate, sem formulário e sem link na navegação, também após reload.
