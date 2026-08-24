---
id: NAV-slow-screen-truthful
area: NAV
title: Aguardar uma tela lenta com status verdadeiro
persona: Candidato em trânsito
journey: J-switch-workspace-screen
expected: Após três segundos o status muda uma vez e a barra continua indeterminada até o destino real ficar pronto
entry_points: /jobs
qa_status: skipped
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report: docs/qa/reports/2026-08-23-task-02-loading-transicoes.md
overlaps:
---

Cobertura: espera longa, rede variável, abandono pelo navegador e contenção móvel.

Skipped no dogfooding: o produto não oferece um caminho público seguro para forçar uma resposta acima de três segundos. O contrato foi exercitado no navegador de produção por E2E-007; isso não é contado como sessão de QA real-user.
