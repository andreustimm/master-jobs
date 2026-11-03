---
id: AUTH-referrals-own-network-only
area: AUTH
title: Indicações mostram só a rede de contatos da própria conta
persona: Candidato após falha
journey: J-refresh-candidate-ranking
expected: Conta candidata nova, sem contatos, abre /referrals e vê a rede vazia (copy.referralsNoNetwork), sem contagem de empresas e sem nome de contato de outra conta, também depois de recarregar; o dono vê a própria rede inteira, inclusive os contatos gravados antes da migration 0031, que a 0034 atribuiu a ele (#405)
entry_points: /referrals
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits: 3d0ea6c
evidence: tests/e2e/ui/roles.mjs
last_report: docs/qa/reports/2026-09-29-pr-386-referrals-rede-propria.md
overlaps: AUTH-shared-candidate-denied
---

Achado no QA full do RC 1.29 (#379): uma conta recém-criada via "14 companies
in your network" em `/referrals`, a rede do dono, com os nomes dos contatos ao
lado de cada vaga. Percorrer com duas contas reais: o dono (que tem contatos)
e uma candidata nova. Na candidata, conferir o texto da tela inteira e
recarregar. No dono, conferir que a rede antiga (as empresas `former` do
`jho contacts seed`) voltou depois da migration 0034 (#405), e que um contato
novo (`jho contacts add`) aparece para ele e não para a candidata.

O E2E cobre a candidata pura contra a fixture do dono
(`tests/e2e/ui/roles.mjs`, "#379 candidato não vê a rede de contatos de outra
conta em /referrals"): login real com senha, leitura da tela, recarregamento e
segunda leitura. O dono com contato próprio é coberto pelos fluxos canônicos de
`/referrals` (`canonical-flows.mjs`).

2026-09-29, evidência de navegador pelo E2E hermético do CI da PR #386
(commit `3d0ea6c`, job `e2e-navegador`): "✓ #379 candidato não vê a rede de
contatos de outra conta em /referrals", 431/431 verificações. Não foi feito
percurso manual com as contas reais de produção; a volta da rede antiga do dono
fica para o percurso da #405, depois que a 0034 for aplicada no ambiente
percorrido. Por isso o cenário voltou a `untested`: o `expected` passou a
incluir a rede antiga do dono, que ninguém viu na tela. O teste de upgrade populado
(`tests/postgres-upgrade-contatos.test.ts`) prova a atribuição no banco, não a
tela.
