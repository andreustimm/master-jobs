---
id: PROF-create-own-profile-identity
area: PROF
title: Perfil novo não herda a identidade do dono
persona: Candidato convidado sem perfil
journey: J-create-own-profile
expected: A área do candidato recém-criada mostra só o que a pessoa digitou, sem nome, e-mail, headline, currículo ou funil do dono e sem a nota de identidade vinda de profile.yaml
entry_points: /candidate; /pipeline; /p/[slug]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s1-created-nina.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PROF-create-own-profile
---

Regressão do incidente de 22/09/2026. Conferir também que /p/<slug> do perfil novo responde 404 enquanto ele for privado.

Full 1.22.0 (2026-09-22): Área recém-criada só com o que Nina digitou; sem Alex, sem headline do dono, sem a nota de profile.yaml; /p/nina-prado 404 enquanto privado.
