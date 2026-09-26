---
id: PUB-public-cv-formatted
area: PUB
title: Ler o currículo importado de PDF com seções e listas no perfil público
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Com perfil público e currículo publicado, o CV importado de PDF aparece em /p/<slug> com os títulos em caixa alta como seções e os itens com ● como lista, sem parágrafo corrido do texto inteiro, sem contato nem pretensão salarial, antes e depois do reload, em 375 px e no desktop
entry_points: /candidate; /p/[slug]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PUB-public-cv-protected-content; PUB-public-profile-mobile-entry
---

O candidato importa em `/candidate` um PDF de currículo cujo texto tem títulos
em caixa alta (`SUMMARY`, `CORE EXPERTISE`, `PROFESSIONAL EXPERIENCE`,
`EDUCATION`) e itens marcados com `●`, às vezes dois na mesma linha. Marca o
perfil como público e publica o currículo. Numa sessão anônima, `/p/<slug>`
mostra cada título como seção e cada item como linha de lista; uma quebra de
linha do PDF continua sendo quebra, e nenhum parágrafo concentra o currículo
inteiro. E-mail, telefone e pretensão salarial escritos no PDF continuam fora.

A forma nasce na leitura: a versão gravada em `/candidate` → "Ver versão" é o
mesmo texto importado, agora exibido com a mesma estrutura, e nada foi
regravado. Uma sigla sozinha na linha ("AWS") ou um cargo com ano não viram
seção — é o limite declarado da heurística (`src/core/cv-markdown.ts`).
