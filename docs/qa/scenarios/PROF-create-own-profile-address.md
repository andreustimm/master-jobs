---
id: PROF-create-own-profile-address
area: PROF
title: Escolher o endereço público ao criar o perfil
persona: Candidato convidado sem perfil
journey: J-create-own-profile
expected: O formulário de criação sugere um endereço a partir do nome; em branco o perfil ganha um derivado do nome, e um endereço em uso volta recusado sem criar o perfil
entry_points: /candidate
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s1-create-refused-bruno.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PROF-create-own-profile; PUB-public-address-refusals
---

A sugestão aparece como placeholder quando a conta tem nome cadastrado.

Full 1.22.0 (2026-09-22): Placeholder nina-prado/ada-admin sugerido do nome; bruno recusado (em uso) sem criar; admin recusado (reservado); em branco virou ada-admin.
