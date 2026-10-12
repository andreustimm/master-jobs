---
id: AUTH-recruiter-workspace-scope
area: AUTH
title: O recrutador com acesso lê o funil e o currículo atual, sugere vagas e perde tudo na revogação
persona: Recrutadora convidada
journey: J-suggest-job-to-candidate
expected: /recruiter lista os candidatos com "Acesso desde", o fim e as sugestões pendentes, 25 por página por nome; a página do candidato tem o nome no título, o funil sem controle de escrita, "Ver currículo" com a versão atual e o download <nome>-cv.md; sugerir pelo acervo ou por /jobs/new?suggestFor= deixa a sugestão Pendente; id de quem não deu acesso, malformado ou depois da revogação dá o mesmo 404 na página, no currículo, no download e em sugerir; sem sessão, o link do e-mail leva ao login e depois à página do candidato
entry_points: /recruiter, /recruiter/[id], /recruiter/[id]/cv, /recruiter/[id]/suggest, /jobs/new
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PIPE-recruiter-suggestion-decide, AUTH-recruiter-access-grant-revoke
---

#465, task_04. Conta de recrutador com acesso concedido por duas candidatas,
uma delas sem nome escolhido (o rótulo deve ser "Candidato · <headline>",
nunca o e-mail). Abrir a lista, a página de cada uma, o currículo e o
download; conferir que a aba traz o nome. Trocar o id na URL por um sem
acesso, por `abc` e por `-1`: 404 igual ao de quem não existe. Sugerir uma
vaga do acervo e cadastrar outra com `suggestFor`. A candidata revoga em
Minha conta: a próxima navegação do recrutador na página, no currículo e em
sugerir dá 404. Em 375 px, a lista, o currículo e sugerir cabem sem rolagem
horizontal.

O E2E `recruiter-suggestions` cobre E2E-016, E2E-017 e E2E-021 com o sink do
`run-isolated`; este cenário é o do e-mail real e da conta de produção.
