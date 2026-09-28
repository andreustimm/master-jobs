---
id: ADMN-source-catalog-operate
area: ADMN
title: Cadastrar, sondar, habilitar e buscar uma fonte pela tela
persona: Andreus em triagem
journey: J-operate-source-catalog
expected: A fonte cadastrada aparece desabilitada; duplicado e chave colada no lugar do nome são recusados com o motivo; sondar não grava vaga; habilitar sobrevive a recarga; Buscar agora leva ao detalhe da execução, que mostra na fila com o motivo ou concluída com contagens
entry_points: /admin/plataformas
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28-qa-223-catch-up/CH-admin-source-catalog-first-walk-run-queued.png; docs/qa/evidence/2026-09-28-qa-223-catch-up/CH-admin-source-catalog-first-walk-plataformas-desktop.png
last_report: docs/qa/reports/2026-09-28-qa-223-catch-up.md
overlaps: ADMN-capture-health-aggregate
---

Novo em #223 (tarefa 03). Sem `GITHUB_DISPATCH_TOKEN` a execução fica na fila
com o motivo visível e roda pela CLI (`jho jobs sync --run <id>`). Fora de
produção a sondagem responde com a recusa do ambiente.

**Percorrido em 2026-09-28** (`CH-admin-source-catalog-first-walk`, persona
Andreus em triagem): cadastrei `greenhouse:qa-catalog-223` sem habilitar — a
lista mostrou "disabled" e "Last capture: never". Recadastrar o mesmo par
kind:handle respondeu "This source is already in the catalog."; colar um
valor de chave (`sk-live-…`) no campo de variável de credencial respondeu
"Enter the name of an environment variable (e.g. ACME_TOKEN)." e não criou a
fonte. Sondar (Probe) antes de habilitar respondeu "This environment does not
probe external sources (production only, or local opt-in)." — recusa do
ambiente, sem gravar vaga. Habilitei a fonte e o estado "enabled" sobreviveu a
`reload`. "Fetch now" levou a `/admin/execucoes/1`, que mostrou "queued" e
"Waiting: no dispatch credential (GITHUB_DISPATCH_TOKEN)…", com as contagens
como "unknown" (nunca zero) — também sobrevivente a `reload`. Rodei
`jho jobs sync --run 1` com `JHO_ENV=local JHO_INGESTION_OPT_IN=true` (opt-in
de diagnóstico local documentado em `src/core/ingest/guard.ts`, escopado só a
essa fonte de teste, sem tocar as fontes reais do catálogo): a execução
concluiu como "failed" com `GET .../qa-catalog-223/jobs -> 404` visível na
tela, contagens ainda "unknown". `/admin/plataformas` e o detalhe cabem em
375 px sem estouro horizontal.
