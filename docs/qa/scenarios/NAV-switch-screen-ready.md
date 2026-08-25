---
id: NAV-switch-screen-ready
area: NAV
title: Trocar para uma tela interna pronta
persona: Candidato por teclado
journey: J-switch-workspace-screen
expected: Um splash único e curto bloqueia a tela anterior e sai somente quando o destino correto está utilizável
entry_points: /jobs
qa_status: pass
bug_ids: BUG-20260823-pipeline-empty-state-mixed-locale
fix_status: fixed
retest_status: pass
fix_commits: bfd27a9
evidence: tests/e2e/ui.mjs; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/triagem-pipeline.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/keyboard-pipeline-goal.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps:
---

Cobertura: jornada, comportamento funcional, percepção de velocidade e regressão do shell global.

O candidato percorreu a troca por teclado em inglês, confirmou o estado vazio integralmente localizado, recarregou e repetiu voltar/avançar. O replay móvel confirmou a mesma cópia sem overflow.

Revalidado na Task 04 em menu global, links contextuais, filtros GET, paginação, densidade, redirects e histórico multi-entry.

O Full QA confirmou Pipeline por menu e por teclado, seguido de reload no mesmo destino.
