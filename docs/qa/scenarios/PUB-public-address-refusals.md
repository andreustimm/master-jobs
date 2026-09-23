---
id: PUB-public-address-refusals
area: PUB
title: Recusar endereço inválido, reservado ou em uso
persona: Andreus no celular
journey: J-choose-public-address
expected: Endereço com espaço ou acento, curto demais, reservado (admin, login) ou já escolhido por outra pessoa é recusado com a razão, e o endereço atual não muda
entry_points: /candidate
qa_status: untested
bug_ids: BUG-20260922-short-address-wrong-reason; BUG-20260922-long-address-cut-silently
fix_status: fixed
retest_status: pending
fix_commits: 2371b8b
evidence: evidence/2026-09-22-rc-1.22.0/s3-refusals-375.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PUB-change-public-address
---

Os campos ficam preenchidos depois da recusa. Colisão simultânea é provada por tests/public-slug.test.ts.

Full 1.22.0 (2026-09-22): Espaço, acento, hífen inicial, admin, login, api e endereço de outra conta são recusados com a razão e o atual não muda. Falhas: 'ab' recebe a razão de formato (BUG-20260922-short-address-wrong-reason) e 41 caracteres são cortados e salvos sem aviso (BUG-20260922-long-address-cut-silently).

Corrigido em `fix/bugs-qa-1.22.0` (2371b8b): o campo não tem mais
`maxlength`/`minlength`; `ab` e 41 caracteres chegam ao servidor e voltam com a
recusa de tamanho. Reteste com colagem real no celular.
