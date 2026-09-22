---
id: ADMN-new-account-password-hint
area: ADMN
title: Seguir a orientação da tela para dar senha a uma conta nova
persona: Andreus em triagem
journey: J-create-own-profile
expected: A orientação sob Criar conta cita um comando que existe e que define a senha da conta recém-criada
entry_points: /admin/users; jho auth set-password
qa_status: untested
bug_ids: BUG-20260922-admin-password-hint-wrong-command
fix_status: fixed
retest_status: pending
fix_commits: 2371b8b
evidence: evidence/2026-09-22-rc-1.22.0/s1-admin-edit-nina.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps:
---

A tela cita `jho auth password`; o comando é `jho auth set-password <email>`.

Corrigido em `fix/bugs-qa-1.22.0` (2371b8b): a orientação, nos dois idiomas,
cita `jho auth set-password <email>`.
