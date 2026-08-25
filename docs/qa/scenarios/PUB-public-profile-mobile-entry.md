---
id: PUB-public-profile-mobile-entry
area: PUB
title: Negar um perfil ausente ou revogado sem revelar cadastro
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Um slug ausente ou não publicado responde 404 após abertura e reload em 430 px sem identidade ou confirmação de cadastro
entry_points: /p/[slug]
qa_status: pass
bug_ids: BUG-20260824-canonical-route-splash
fix_status: fixed
retest_status: pass
fix_commits: ba0cd09
evidence: tests/e2e/ui.mjs; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/public-profile-404.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/public-profile-404-goal-en.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-public-revoked-404-goal.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps:
---

Uma segunda sessão anônima em inglês recebeu HTTP 404 em `/p/full-qa-not-published` antes e depois do reload. Após a correção do splash inserido por Flight, o reteste em 430 px terminou na tela 404 localizada, sem identidade, conteúdo privado, overflow ou camada residual. A suíte E2E repete abertura e reload nessa mesma persona e exige o mesmo estado terminal.
