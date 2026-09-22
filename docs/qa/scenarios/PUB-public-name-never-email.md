---
id: PUB-public-name-never-email
area: PUB
title: Perfil público nunca exibe e-mail, nem como nome
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Qualquer que seja a forma de criação da conta (admin, CLI ou autoatendimento), /p/<slug> de um perfil público não mostra endereço de e-mail em nenhum campo, inclusive no nome
entry_points: jho auth add-user; /admin/users; /candidate; /p/[slug]
qa_status: fail
bug_ids: BUG-20260922-public-profile-shows-email-as-name
fix_status: pending
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s3-pia-public-name-is-email.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PUB-public-cv-protected-content
---

Criado no Full da 1.22.0. Conta de `jho auth add-user` tem o e-mail como nome
do candidato e o publica em `/p/<slug>`. Contas de `/admin/users` (nome
digitado) e do autoatendimento (nome do formulário) não têm o problema.
