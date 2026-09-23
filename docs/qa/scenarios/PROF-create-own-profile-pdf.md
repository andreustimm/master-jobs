---
id: PROF-create-own-profile-pdf
area: PROF
title: Criar o perfil enviando o currículo em PDF
persona: Candidato convidado sem perfil
journey: J-create-own-profile
expected: O formulário de criação aceita o PDF do currículo; o perfil nasce com o texto extraído no editor e o aviso pede a revisão; arquivo que não é PDF, PDF digitalizado, arquivo acima de 10 MB ou PDF junto com texto colado voltam recusados com a razão, sem criar o perfil
entry_points: /candidate
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PROF-create-own-profile; PROF-create-own-profile-identity
---

Entrega da #278. Percorrer em 375 px e em inglês: o campo de arquivo cabe, a recusa mantém os campos preenchidos e o PDF escolhido, e depois de criar o editor do currículo mostra o texto do PDF com a versão nomeada pelo arquivo. Conferir no refresh que a área do candidato permanece e que o texto continua lá.
