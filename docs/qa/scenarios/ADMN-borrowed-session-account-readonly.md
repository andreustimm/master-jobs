---
id: ADMN-borrowed-session-account-readonly
area: ADMN
title: Sessão emprestada vê Minha conta do alvo sem poder mudar nada
persona: Andreus em triagem
journey: J-manage-own-account
expected: Assumindo a identidade de alguém, Minha conta mostra o aviso de sessão emprestada e nenhum formulário de senha, e-mail ou nome
entry_points: /admin/users; /account
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: SRCH-borrowed-session-waits-sweep
---

Assumir a identidade de uma conta-alvo e abrir Minha conta. Conferir o aviso e a
ausência de campos. Encerrar a sessão emprestada e conferir que a senha do alvo
continua a mesma.
