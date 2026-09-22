---
id: PUB-change-public-address
area: PUB
title: Trocar o endereço público e ver o antigo parar
persona: Andreus no celular
journey: J-choose-public-address
expected: Depois de salvar um endereço novo, /p/<novo> mostra o perfil público e /p/<antigo> responde 404, também após refresh, em 375 px
entry_points: /candidate; /p/[slug]
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s3-old-address-404.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PUB-public-address-refusals; PUB-public-profile-mobile-entry
---

Decisão da ADR 0024: sem redirecionamento. Conferir que o aviso de troca aparece antes de salvar e que o dono continua vendo a própria área e o funil depois da troca.

Full 1.22.0 (2026-09-22): alex-ribeiro → alex-r: o novo responde 200 e o antigo 404, também após reload, visitante em 414 px; o dono segue vendo /pipeline.
