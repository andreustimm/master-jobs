---
id: PIPE-save-resume-decision
area: PIPE
title: Salvar e retomar uma decisão de candidatura
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: A mesma candidatura preserva status e nota após refresh, novo login e leitura pela CLI pública
entry_points: /jobs; /pipeline; pnpm jho jobs show
qa_status: untested
bug_ids: BUG-20260910-application-edit-not-retained
fix_status: fixed
retest_status: pending
fix_commits: f16c2b4
evidence: docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-save-resume-application-baseline-before-save.png; docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-save-resume-application-baseline-after-save.png
last_report: docs/qa/reports/2026-09-10T011143000000Z-8bd417c2-supabase-production.md
overlaps:
---

Planejado para a migração PostgreSQL. Usar somente conta e vaga sintéticas em
ambiente isolado; nenhuma candidatura real é enviada. O feedback imediato não
basta: confirmar persistência no funil e na leitura pública da mesma identidade.
Abandonar uma edição antes de salvar deve preservar a última decisão confirmada.
