---
id: AUTH-recruiter-access-grant-revoke
area: AUTH
title: O candidato concede, convida, põe prazo e revoga o acesso de recrutador pela própria conta
persona: Andreus em triagem noturna
journey: J-share-search-with-recruiter
expected: Em Minha conta, a seção de acesso mostra o escopo antes do formulário; conceder a um recrutador com conta lista "Ativo" e ele vê o candidato em /recruiter; e-mail sem conta vira convite de 7 dias; e-mail inválido, o próprio e data de hoje recusam no campo mantendo o texto; data de fim aparece no fuso e pode ser tirada; revogar pede confirmação, tira da lista, dá 404 ao recrutador e manda o aviso; o histórico lista tudo do mais novo ao mais antigo
entry_points: /account, /recruiter, /recruiter/[id]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: ADMN-recruiter-access-admin-revoke
---

#465, task_02. Duas janelas: o candidato em `/account` e um recrutador com
conta de e-mail confirmado em `/recruiter`. Conceder, recarregar e conferir a
linha; no recrutador, recarregar `/recruiter` e ver o candidato sem sair. Dar
acesso a um e-mail sem conta e conferir "Link válido até" e o e-mail do
convite (Resend em produção; o sink no local). Pôr uma data de fim, conferir
"Até … (fuso)", tirá-la. Revogar: "Voltar" no diálogo não muda nada;
confirmar tira a linha, e o recrutador recebe 404 ao abrir a página do
candidato. Conferir o histórico depois de recarregar e, em 375 px, que a seção
cabe sem rolagem horizontal.

O E2E `recruiter-access` cobre o percurso com o sink de e-mail do
`run-isolated`; este cenário é o do e-mail real e da leitura de uma pessoa.
