---
id: ADMN-recruiter-access-admin-revoke
area: ADMN
title: O admin revoga acesso e cancela convite sem nunca conceder; a sessão emprestada só lê
persona: Andreus em triagem
journey: J-share-search-with-recruiter
expected: Em /admin/users, a conta de cada candidato mostra as concessões ativas e os convites pendentes com datas; revogar e cancelar pedem confirmação; o histórico do candidato diz "revogado por um administrador (nome)" e o recrutador recebe o aviso de que a administração encerrou; não há botão nem campo de conceder ou convidar; assumindo o candidato, a seção de acesso de Minha conta mostra lista e histórico sem formulário nem botão
entry_points: /admin/users, /account
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: AUTH-recruiter-access-grant-revoke, ADMN-borrowed-session-account-readonly
---

#465, task_02. Com um candidato que já concedeu acesso: como admin, abrir
`/admin/users`, achar a conta dele, revogar a concessão com confirmação e
conferir o aviso. Entrar como o candidato e ler a primeira linha do
histórico. Voltar ao admin, assumir a identidade do candidato e abrir
`/account`: a seção mostra a nota de sessão emprestada, a lista e o histórico,
e nenhum controle.
