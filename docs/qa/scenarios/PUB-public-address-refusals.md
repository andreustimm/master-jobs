---
id: PUB-public-address-refusals
area: PUB
title: Recusar endereço inválido, reservado ou em uso
persona: Andreus no celular
journey: J-choose-public-address
expected: Endereço com espaço ou acento, curto demais, reservado (admin, login) ou já escolhido por outra pessoa é recusado com a razão, e o endereço atual não muda
entry_points: /candidate
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PUB-change-public-address
---

Os campos ficam preenchidos depois da recusa. Colisão simultânea é provada por tests/public-slug.test.ts.
