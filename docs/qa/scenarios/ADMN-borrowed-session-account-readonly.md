---
id: ADMN-borrowed-session-account-readonly
area: ADMN
title: Sessão emprestada vê Minha conta do alvo sem poder mudar nada
persona: Andreus em triagem
journey: J-manage-own-account
expected: Assumindo a identidade de alguém, Minha conta mostra o aviso de sessão emprestada e nenhum formulário de senha nem de nome; o e-mail aparece só para leitura
entry_points: /admin/users; /account
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s1-borrowed-nina-candidate.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: AUTH-account-change-password
---

Assumir a identidade de uma conta-alvo e abrir Minha conta. Conferir o aviso e a
ausência de campos. Encerrar a sessão emprestada e conferir que a senha do alvo
continua a mesma.

Full 1.22.0 (2026-09-22): Assumindo Nina, Minha conta mostra a nota de sessão emprestada, o e-mail só para leitura e nenhum formulário; Nina entrou depois com a própria senha.
