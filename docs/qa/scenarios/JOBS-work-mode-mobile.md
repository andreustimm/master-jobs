---
id: JOBS-work-mode-mobile
area: JOBS
title: Escolher modalidade e retomar a lista no celular
persona: Andreus no celular
journey: J-find-jobs-by-work-mode
expected: As quatro opções ficam legíveis e operáveis em 375px e o recorte sobrevive à recarga
entry_points: /; /jobs
qa_status: pass
bug_ids: BUG-20260919-mobile-searches-overflow
fix_status: fixed
retest_status: pending
fix_commits: 4ef5e79; 3ff3f1f; 5e6d6aa
evidence: evidence/2026-09-22-rc-1.22.0/s4-workmode-remote-375.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: JOBS-work-mode-continuity
---

Percorrer modalidades com toque, alternar orientação e confirmar ausência de
rolagem horizontal. Reabrir uma vaga identificável depois de voltar à lista.

Full 1.22.0 (2026-09-22): Quatro opções operáveis em 375 px, sem estouro; o recorte sobrevive à recarga.
