---
id: PUB-public-facts-opt-in
area: PUB
title: Ver no perfil público só os fatos que o candidato decidiu mostrar
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Em /p/<slug>, sem sessão, cada fato com "mostrar" ligado aparece — modelo de trabalho, nível e disponibilidade na faixa do topo; área, idiomas, prazo e aceita mudar no cartão "Em resumo" —, e nenhum fato desligado aparece, nem o rótulo; sem rolagem horizontal em 375px; nenhuma pretensão salarial em lugar nenhum
entry_points: /candidate; /p/[slug]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PUB-edit-public-facts; PUB-public-profile-layout; PUB-public-cv-protected-content
---

Criado com a parte A de #327. O candidato preenche os sete fatos em
`/candidate`, liga só uma parte deles e deixa o perfil Público. Um visitante
em janela anônima abre `/p/<endereço>` no celular e no desktop: os ligados
aparecem no lugar certo, os desligados não aparecem nem como "não informado"
— sem nenhum, a faixa e o cartão somem. Voltar um fato para desligado e
recarregar o tira da página na hora. Em inglês, os rótulos e os valores
escolhidos em lista saem traduzidos; área e idiomas continuam como a pessoa
escreveu.
