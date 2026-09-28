---
id: ADMN-source-catalog-denied
area: ADMN
title: Candidato, recrutador e sessão emprestada não alcançam Plataformas nem Execuções
persona: Andreus em triagem
journey: J-operate-source-catalog
expected: Abrir /admin/plataformas, /admin/execucoes e os detalhes por link direto responde acesso recusado sem mostrar configuração de fonte; /jobs continua pesquisável para os mesmos papéis
entry_points: /admin/plataformas; /admin/execucoes
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28-qa-223-catch-up/CH-admin-source-catalog-first-walk-denied-candidate.png
last_report: docs/qa/reports/2026-09-28-qa-223-catch-up.md
overlaps: ADMN-borrowed-session-account-readonly
---

Novo em #223 (tarefa 03). A sessão emprestada nega mesmo quando o alvo é
outro administrador.

**Percorrido em 2026-09-28** (`CH-admin-source-catalog-first-walk`, persona
Andreus em triagem). Três papéis testados contra as quatro rotas
(`/admin/plataformas`, `/admin/execucoes`, o detalhe de uma fonte e o detalhe
de uma execução): candidata (`e2e-candidato@local.test`), recrutadora
(`e2e-recrutador@local.test`) e sessão emprestada (admin usando "Act as this
user" sobre a candidata, em `/admin/users`). As quatro rotas devolveram
`403 Forbidden` com a tela "Access denied · You don't have permission to open
this screen." nos três papéis, sem nenhuma configuração de fonte visível na
resposta. `/jobs` continuou pesquisável (5.545 vagas) para os três. A sessão
emprestada mostrou o aviso "Borrowed session: administration actions are off
and this access was recorded." e perdeu os links de admin (Users, Operations)
no cabeçalho.

**Nota:** não testei sessão emprestada com outro ADMINISTRADOR como alvo — a
tela `/admin/users` só oferece "Act as this user" nas contas com papel
candidato/recrutador (`e2e@local.test`, admin-only, não tem esse botão); não
encontrei uma via de produto para impersonar outro admin. A frase acima ("nega
mesmo quando o alvo é outro administrador") pode descrever uma intenção do PRD
sem controle de UI correspondente — vale confirmar com o dono se existe outro
caminho (ex.: CLI) antes de fechar essa lacuna como não aplicável.
