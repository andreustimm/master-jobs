---
id: JOBS-work-mode-continuity
area: JOBS
title: Retomar a busca de vagas pela modalidade escolhida
persona: Andreus em triagem
journey: J-find-jobs-by-work-mode
expected: Remoto, Híbrido e Presencial filtram a lista e permanecem após busca, ver todas, paginação, Voltar e recarga
entry_points: /; /jobs
qa_status: pass
bug_ids: BUG-20260915-clear-search-text
fix_status: fixed
retest_status: pending
fix_commits: cf20630
evidence: evidence/2026-09-22-rc-1.22.0/s4-workmode-remote-375.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: NAV-first-party-navigation-contract
---

Conferir uma vaga identificável no detalhe e na lista recarregada. Todas inclui
modalidade não informada. Exercitar busca vazia, busca sem resultado, alternância
de modalidades, histórico e URL reaberta. Classificação independe de elegibilidade:
uma vaga remota ainda pode restringir país ou autorização de trabalho.
Menções a hybrid cloud ou remote sensing no corpo, mesmo recuperadas pelo
extrator, não determinam modalidade. Sem declaração ou localização explícita,
essas vagas aparecem em Todas.

Full 1.22.0 (2026-09-22): Remote permanece após busca por termo, troca de tamanho de página, Voltar e recarga, com a opção marcada.
