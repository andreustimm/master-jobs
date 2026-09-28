---
id: PUB-public-photo-cover-opt-in
area: PUB
title: Ver no perfil público a foto e a capa só quando o candidato decidiu mostrar
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Em /p/<slug>, sem sessão, a capa aparece acima do nome e a foto ao lado dele só quando o "mostrar" de cada uma está ligado; desligada, a imagem não aparece nem como espaço vazio ou iniciais; sem rolagem horizontal em 375px e o nome continua legível ao lado da foto; a imagem vem do próprio endereço do app, nunca de um domínio de armazenamento
entry_points: /candidate; /p/[slug]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PUB-edit-public-photo-cover; PUB-public-profile-layout; PUB-public-facts-opt-in
---

Criado com a parte B de #327. O candidato envia foto e capa, liga só a foto
e deixa o perfil Público. Um visitante em janela anônima abre
`/p/<endereço>` no celular e no desktop: vê a foto ao lado do nome e nenhuma
capa. Ligar a capa e recarregar a faz aparecer acima do nome, mais alta no
celular (3:1) do que no desktop (4:1). No inspetor de rede, as imagens vêm de
`/p/<endereço>/image/photo` e `/image/cover`, com `Cache-Control: no-store`.
