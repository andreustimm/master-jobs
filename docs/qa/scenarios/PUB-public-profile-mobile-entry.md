---
id: PUB-public-profile-mobile-entry
area: PUB
title: Negar um perfil ausente ou revogado sem revelar cadastro
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Um slug ausente ou não publicado responde 404 após abertura e reload em 430 px sem identidade ou confirmação de cadastro
entry_points: /p/[slug]
qa_status: pass
bug_ids: BUG-20260824-canonical-route-splash; BUG-20260928-public-profile-404-script-tag-warning
fix_status: fixed
retest_status: pass
fix_commits: 7ba2890; fe5cdbf
evidence: tests/e2e/ui.mjs; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/public-profile-404.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/public-profile-404-goal-en.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-public-revoked-404-goal.png; evidence/2026-09-28T164126181554Z-de433ca6-perfil-publico-layout-targeted/pub-404-375.png
last_report: docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
overlaps:
---

Uma segunda sessão anônima em inglês recebeu HTTP 404 em `/p/full-qa-not-published` antes e depois do reload. Após a correção do splash inserido por Flight, o reteste em 430 px terminou na tela 404 localizada, sem identidade, conteúdo privado, overflow ou camada residual. A suíte E2E repete abertura e reload nessa mesma persona e exige o mesmo estado terminal.

**Reconfirmado na Full 1.29 (2026-09-29, HEAD `494aa37`, 375px):**
`/p/qa-full-pub-v1` (endereço trocado) e `/p/never-existed-address-xyz`
(nunca existiu) deram 404 com corpo idêntico via `curl` sem cookie, e o
`eval` de `scrollWidth` em 375px não mostrou estouro horizontal em nenhuma
tela do perfil público desta rodada. O aviso de hidratação do `app-splash`
(BUG-20260928-public-profile-404-script-tag-warning, aberto, Cosmetic/P3)
reproduziu de novo, agora observado também fora do 404 (em `/candidate`) —
mesmo padrão já registrado, sem efeito observável.
