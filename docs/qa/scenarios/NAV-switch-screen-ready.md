---
id: NAV-switch-screen-ready
area: NAV
title: Trocar para uma tela interna pronta
persona: Andreus em triagem
journey: J-switch-workspace-screen
expected: Um splash único e curto bloqueia a tela anterior e sai somente quando o destino correto está utilizável
entry_points: /jobs
qa_status: pass
bug_ids: BUG-20260823-pipeline-empty-state-mixed-locale
fix_status: fixed
retest_status: pass
fix_commits: bfd27a9
evidence: tests/e2e/ui.mjs; docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-keyboard-screen-transition-pipeline-en.png; docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-keyboard-screen-transition-mobile-en.png
last_report: docs/qa/reports/2026-08-24T143638469000Z-8c1fe201-navigation-contract-retest.md
overlaps:
---

Cobertura: jornada, comportamento funcional, percepção de velocidade e regressão do shell global.

O candidato percorreu a troca por teclado em inglês, confirmou o estado vazio integralmente localizado, recarregou e repetiu voltar/avançar. O replay móvel confirmou a mesma cópia sem overflow.

Revalidado na Task 04 em menu global, links contextuais, filtros GET, paginação, densidade, redirects e histórico multi-entry.
