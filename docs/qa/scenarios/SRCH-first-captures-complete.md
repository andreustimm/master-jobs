---
id: SRCH-first-captures-complete
area: SRCH
title: Acompanhar as primeiras capturas de dois termos da mesma plataforma
persona: Andreus em triagem
journey: J-save-term-search
expected: Duas buscas salvas em abas diferentes mostram capturas concluídas numa plataforma que respondeu, com o mesmo resultado após recarga e na saúde agregada
entry_points: /searches; /admin/captures; jho terms status
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22T103914934977Z-a59f3329-capturas-concorrentes/CH-first-captures-two-tabs-baseline-complete.png; evidence/2026-09-22T103914934977Z-a59f3329-capturas-concorrentes/terms-status.txt
last_report: docs/qa/reports/2026-09-22T103914934977Z-a59f3329-capturas-concorrentes.md
overlaps:
---

Ambiente local isolado, com ingestão real explicitamente habilitada antes da
sessão. A jornada confirma o resultado público; a disputa exata no índice do
PostgreSQL pertence ao teste de integração IT-065, não aos cliques do navegador.
Falhas reais de plataformas externas são registradas separadamente da corrida.
