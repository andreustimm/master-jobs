---
id: AUTH-create-profile-refused-roles
area: AUTH
title: Quem não é candidato sem perfil não recebe o formulário
persona: Recrutadora convidada
journey: J-create-own-profile
expected: Recrutador, admin sem papel candidato e sessão emprestada abrem /candidate e recebem 403, sem formulário de criação nem link na navegação
entry_points: /candidate
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PROF-create-own-profile
---

A sessão emprestada é negada de propósito: criar o perfil é decisão da pessoa, não do admin que assume a identidade.
