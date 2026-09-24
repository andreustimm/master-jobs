---
id: ADMN-source-catalog-denied
area: ADMN
title: Candidato, recrutador e sessão emprestada não alcançam Plataformas nem Execuções
persona: Andreus em triagem
journey: J-operate-source-catalog
expected: Abrir /admin/plataformas, /admin/execucoes e os detalhes por link direto responde acesso recusado sem mostrar configuração de fonte; /jobs continua pesquisável para os mesmos papéis
entry_points: /admin/plataformas; /admin/execucoes
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: ADMN-borrowed-session-account-readonly
---

Novo em #223 (tarefa 03). A sessão emprestada nega mesmo quando o alvo é
outro administrador.
