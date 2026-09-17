---
id: PIPE-save-resume-decision
area: PIPE
title: Salvar e retomar uma decisão de candidatura
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: A mesma candidatura preserva status e nota após refresh, novo login e leitura pela CLI pública
entry_points: /jobs; /pipeline; pnpm jho jobs show
qa_status: blocked-decision
bug_ids: BUG-20260910-application-edit-not-retained; BUG-20260917-transition-note-never-readable
fix_status: fixed
retest_status: verified
fix_commits: f16c2b4; 916c531; fa1269d
evidence: docs/qa/evidence/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition/CH-save-resume-application-step3-reachable-stages.png
last_report: docs/qa/reports/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition.md
overlaps:
---

Full do release candidate 1.7.1 (`676d5e0`, o que está em `staging`): este
cenário FALHA ali. O status deste arquivo descreve a branch de correção; o RC
ainda descarta o rascunho numa transição recusada. Relatório:
docs/qa/reports/2026-09-17T232350685065Z-1cb4e9bd-release-candidate-1.7.1-full.md

Reteste de 17/09: a metade do STATUS está confirmada ponta a ponta — gravado no
detalhe, relido após refresh, presente no funil, mantido depois de sair e
entrar de novo, e igual na CLI pública da mesma identidade. A metade da NOTA
não passa: ela é aceita e não volta em superfície pública nenhuma. Como a
correção disso é escolha de produto — gravar em `application.notes`, exibir o
histórico de eventos ou retirar o campo —, o cenário fica `blocked-decision` em
vez de `fail`. Ver BUG-20260917-transition-note-never-readable.

Planejado para a migração PostgreSQL. Usar somente conta e vaga sintéticas em
ambiente isolado; nenhuma candidatura real é enviada. O feedback imediato não
basta: confirmar persistência no funil e na leitura pública da mesma identidade.
Abandonar uma edição antes de salvar deve preservar a última decisão confirmada.
