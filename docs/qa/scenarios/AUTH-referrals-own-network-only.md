---
id: AUTH-referrals-own-network-only
area: AUTH
title: Indicações mostram só a rede de contatos da própria conta
persona: Candidato após falha
journey: J-refresh-candidate-ranking
expected: Conta candidata nova, sem contatos, abre /referrals e vê a rede vazia ("Nenhum contato registrado"), sem contagem de empresas e sem nome de contato de outra conta, também depois de recarregar; o dono continua vendo as próprias indicações com "via <contatos>"
entry_points: /referrals
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: AUTH-shared-candidate-denied
---

Achado no QA full do RC 1.29 (#379): uma conta recém-criada via "14 companies
in your network" em `/referrals`, a rede do dono, com os nomes dos contatos ao
lado de cada vaga. Percorrer com duas contas reais: o dono (que tem contatos)
e uma candidata nova. Na candidata, conferir o texto da tela inteira e
recarregar; no dono, conferir que as indicações continuam lá.

O E2E cobre a candidata pura contra a fixture do dono
(`tests/e2e/ui/roles.mjs`, "#379 candidato não vê a rede de contatos de outra
conta em /referrals").
