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
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui.mjs
last_report: docs/qa/reports/2026-08-24-task-04-first-party-navigation.md
overlaps:
---

Cobertura: jornada, comportamento funcional, percepção de velocidade e regressão do shell global.

O destino ficou utilizável e persistiu após recarga. O bug ligado é um paper cut do conteúdo do destino, não uma falha do lifecycle de transição.

Revalidado na Task 04 em menu global, links contextuais, filtros GET, paginação, densidade, redirects e histórico multi-entry.
