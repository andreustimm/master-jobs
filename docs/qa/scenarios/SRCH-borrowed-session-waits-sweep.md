---
id: SRCH-borrowed-session-waits-sweep
area: SRCH
title: Salvar um termo numa sessão emprestada sem disparar busca
persona: Andreus em triagem
journey: J-save-term-search
expected: Na sessão emprestada o termo é salvo e a tela diz que ele espera a varredura diária; nenhuma plataforma entra em busca
entry_points: /admin/users; /searches
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-borrowed-session-term-waits-baseline-salvo.png
last_report: docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
overlaps: ADMN-capture-health-aggregate
---

Assumir a identidade de um candidato, salvar e rodar de novo. As duas
ações respondem "aguardando a varredura diária". Encerrar a sessão emprestada
e conferir o registro de impersonação.
