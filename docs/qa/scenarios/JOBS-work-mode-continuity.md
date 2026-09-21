---
id: JOBS-work-mode-continuity
area: JOBS
title: Retomar a busca de vagas pela modalidade escolhida
persona: Andreus em triagem
journey: J-find-jobs-by-work-mode
expected: Remoto, Híbrido e Presencial filtram a lista e permanecem após busca, ver todas, paginação, Voltar e recarga
entry_points: /; /jobs
qa_status: untested
bug_ids: BUG-20260915-clear-search-text
fix_status: fixed
retest_status: pending
fix_commits: cf20630
evidence: evidence/2026-09-15T154024495800Z-d256aed5-job-work-mode-filter/CH-work-mode-continuity-post-review-all.png; evidence/2026-09-15T154024495800Z-d256aed5-job-work-mode-filter/orion-remote.csv; evidence/2026-09-15T154024495800Z-d256aed5-job-work-mode-filter/CH-work-mode-continuity-post-review-clear.png
last_report: docs/qa/reports/2026-09-18T202222983242Z-8870c32d-release-candidate-1.13.1-full.md
overlaps: NAV-first-party-navigation-contract
---

Conferir uma vaga identificável no detalhe e na lista recarregada. Todas inclui
modalidade não informada. Exercitar busca vazia, busca sem resultado, alternância
de modalidades, histórico e URL reaberta. Classificação independe de elegibilidade:
uma vaga remota ainda pode restringir país ou autorização de trabalho.
Menções a hybrid cloud ou remote sensing no corpo, mesmo recuperadas pelo
extrator, não determinam modalidade. Sem declaração ou localização explícita,
essas vagas aparecem em Todas.
