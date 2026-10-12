---
id: PIPE-recruiter-suggestion-decide
area: PIPE
title: A candidata vê as sugestões do recrutador, aceita uma para o funil e recusa outra sem tocá-lo
persona: Andreus em triagem noturna
journey: J-suggest-job-to-candidate
expected: "Sugestões" aparece na navegação com a contagem das pendentes; cada item mostra vaga, empresa, nota, quem sugeriu e a nota dele como texto (marcação aparece literal); aceitar põe a vaga no funil em Backlog com "sugerida por recrutador", e uma vaga que já estava no funil continua no estágio e no canal dela; recusar não muda o funil; a sugestão de quem perdeu o acesso aparece com "acesso encerrado" e ainda pode ser decidida; o recrutador vê "Aceita em" ou "Recusada em"; sessão emprestada vê tudo sem Aceitar nem Recusar
entry_points: /suggestions, /pipeline, /recruiter/[id]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: AUTH-recruiter-workspace-scope
---

#465, task_04. Duas janelas: a candidata em `/suggestions` e um recrutador
com acesso a ela em `/recruiter/<id>`. O recrutador sugere duas vagas, uma
com nota contendo `<b>marcação</b>`. Na candidata, recarregar e conferir a
contagem da navegação e a nota como texto; aceitar uma, abrir `/pipeline` e
ver a vaga em Backlog com o marcador; recusar a outra e conferir que o funil
não mudou. No recrutador, recarregar e ver os dois estados com a data. Em
375 px, `/suggestions` cabe sem rolagem horizontal e os botões têm alvo de
toque. O e-mail de sugestões chega no máximo uma vez por hora do mesmo
recrutador; conferir no sink do local ou no provedor em produção.

O E2E `recruiter-suggestions` cobre o percurso (E2E-018 – E2E-023); este
cenário é o da leitura de uma pessoa e do e-mail real.
