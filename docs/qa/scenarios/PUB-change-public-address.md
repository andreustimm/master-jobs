---
id: PUB-change-public-address
area: PUB
title: Trocar o endereço público e ver o antigo parar
persona: Andreus no celular
journey: J-choose-public-address
expected: Depois de salvar um endereço novo, /p/<novo> mostra o perfil público e /p/<antigo> responde 404, também após refresh, em 375 px
entry_points: /candidate; /p/[slug]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PUB-public-address-refusals; PUB-public-profile-mobile-entry
---

Decisão da ADR 0024: sem redirecionamento. Conferir que o aviso de troca aparece antes de salvar e que o dono continua vendo a própria área e o funil depois da troca.
