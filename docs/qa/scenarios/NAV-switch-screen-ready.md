---
id: NAV-switch-screen-ready
area: NAV
title: Trocar para uma tela interna pronta
persona: Candidato por teclado
journey: J-switch-workspace-screen
expected: Um splash único e curto bloqueia a tela anterior e sai somente quando o destino correto está utilizável
entry_points: /jobs
qa_status: untested
bug_ids: BUG-20260823-pipeline-empty-state-mixed-locale
fix_status: fixed
retest_status: pending
fix_commits: bfd27a9
evidence: evidence/2026-09-22-rc-1.22.0/s4-after-route-change.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps:
---

Cobertura: jornada, comportamento funcional, percepção de velocidade e regressão do shell global.

O candidato percorreu a troca por teclado em inglês, confirmou o estado vazio integralmente localizado, recarregou e repetiu voltar/avançar. O replay móvel confirmou a mesma cópia sem overflow.

Revalidado na Task 04 em menu global, links contextuais, filtros GET, paginação, densidade, redirects e histórico multi-entry.

O Full QA confirmou Pipeline por menu e por teclado, seguido de reload no mesmo destino.

**Reset 2026-09-22 (#220):** filtros GET, paginação e densidade deixaram de abrir o splash — viraram transição suave na mesma tela (`NAV-same-screen-soft-transition`). Este cenário passa a cobrir só a troca entre telas; revalidar.

Full 1.22.0 (2026-09-22): Troca /jobs → /pipeline pelo menu do celular: um overlay, shell inert com 'Loading the next screen', liberado em ~450 ms com o destino utilizável.

**Reset 2026-09-23 (#217):** ao entrar em Vagas vindo de outra tela, o splash agora sai sobre o esboço pré-carregado da lista (`JOBS-loading-skeleton`), e a lista chega por streaming depois dele. Confirmar que o esboço anuncia a espera, que nada da tela anterior fica operável e que as outras áreas não mudaram.
