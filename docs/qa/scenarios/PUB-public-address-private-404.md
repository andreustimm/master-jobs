---
id: PUB-public-address-private-404
area: PUB
title: Perfil não público responde 404 em qualquer endereço
persona: Visitante do perfil público
journey: J-choose-public-address
expected: Com o perfil Privado ou Recrutadores, o endereço novo, o antigo e o identificador interno respondem 404 idêntico ao de endereço inexistente
entry_points: /p/[slug]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s3-old-address-404.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PUB-public-profile-mobile-entry
---

404 e não 403: existência é informação.

Full 1.22.0 (2026-09-22): Com Recrutadores e com Privado: novo, antigo, /p/1 e endereço inexistente dão 404 com texto idêntico.
