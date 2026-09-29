---
id: PUB-edit-public-name
area: PUB
title: Escrever o nome que o perfil público mostra
persona: Candidato convidado sem perfil
journey: J-choose-public-address
expected: Em /candidate, a pessoa sem nome é convidada a escrever um; e-mail ou telefone como nome é recusado com a razão; o nome salvo sobrevive ao reload e é o título de /p/<endereço> para o visitante anônimo
entry_points: /candidate; /p/[slug]
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-public-facts-and-name-desktop/public-profile-375-facts-name.png
last_report: docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
overlaps: PUB-public-name-never-email
---

Criado com a correção do BUG-20260922-public-profile-shows-email-as-name. O
cartão "Nome no perfil" não aparece para o candidato do dono, cujo nome vem do
`profile.yaml` e é regravado pelo `jho db seed`: percorra com uma conta criada
por `jho auth add-user` ou por Criar meu perfil. Estende o passo de
J-choose-public-address em `/candidate`, antes de marcar o perfil Público.

**Percorrido na Full 1.29 (2026-09-29, HEAD `494aa37`, conta
`qa-full-candidate-e`, criada por `jho auth add-user` sem nome):** `/candidate`
mostrou "Your profile has no name yet. Write how you want to be called before
making it public." Tentativa de salvar o próprio e-mail
(`qa-full-e@local.test`) como nome foi recusada (campo Nome não persistiu; o
título do perfil público continuou "Perfil sem nome" depois da tentativa).
Salvo "QA Full Candidate E", o nome passou a ser o `<h1>` de
`/p/qa-full-pub-v2` e também o `<title>` da aba ("QA Full Candidate E —
profile"), confirmado por `curl` sem cookie e por leitura de acessibilidade do
navegador.
