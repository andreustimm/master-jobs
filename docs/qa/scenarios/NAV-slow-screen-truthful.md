---
id: NAV-slow-screen-truthful
area: NAV
title: Aguardar uma tela lenta com status verdadeiro
persona: Candidato em trânsito
journey: J-switch-workspace-screen
expected: Após três segundos o status muda uma vez e a barra continua indeterminada até o destino real ficar pronto
entry_points: /jobs
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/mobile-slow-transition.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/mobile-slow-goal.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps:
---

Cobertura: espera longa, rede variável, abandono pelo navegador e contenção móvel.

No build de produção, a rede do navegador atrasou `/jobs` por seis segundos. O splash mudou para a mensagem localizada de espera longa sem liberar conteúdo obsoleto e terminou em `/jobs` utilizável em 375 px.
