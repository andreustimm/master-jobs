---
id: PUB-edit-public-name
area: PUB
title: Escrever o nome que o perfil público mostra
persona: Candidato convidado sem perfil
journey: J-choose-public-address
expected: Em /candidate, a pessoa sem nome é convidada a escrever um; e-mail ou telefone como nome é recusado com a razão; o nome salvo sobrevive ao reload e é o título de /p/<endereço> para o visitante anônimo
entry_points: /candidate; /p/[slug]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PUB-public-name-never-email
---

Criado com a correção do BUG-20260922-public-profile-shows-email-as-name. O
cartão "Nome no perfil" não aparece para o candidato do dono, cujo nome vem do
`profile.yaml` e é regravado pelo `jho db seed`: percorra com uma conta criada
por `jho auth add-user` ou por Criar meu perfil. Estende o passo de
J-choose-public-address em `/candidate`, antes de marcar o perfil Público.
