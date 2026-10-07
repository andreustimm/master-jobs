---
id: PIPE-filter-applications
area: PIPE
title: Filtrar o funil por texto, empresa, canal e score sem perder o estágio nem os contadores
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: Os filtros combinam com o estágio, a lista e o contador de cada estágio mostram o mesmo conjunto, "ampliar busca" acha pelo sinônimo e pela grafia parecida, e o estado sobrevive a refresh e ao voltar do navegador
entry_points: /pipeline; /pipeline?q=engenheiro&semantic=1&company=<empresa>
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PIPE-undo-and-move-back; JOBS-search-synonyms
---

Novo em #478. Contrato em `docs/product/pipeline-url-contract.md`.

A conferir, com refresh e leitura independente (o detalhe de cada vaga):

1. Escolher duas empresas no seletor: só as candidaturas delas aparecem, e o
   número de cada estágio é o de linhas que ele mostra ao ser aberto.
2. Digitar um termo: casa cargo, empresa, localização e descrição, inclusive
   de vaga já fechada; entre aspas, a frase exata.
3. "Ampliar busca" com `SEARCH_SYNONYMS_ENABLED` ligada: "engenheiro" também
   traz "Engineer"; um cargo com uma letra trocada aparece; a tela não fala em
   semântica. Desligada a flag, só a grafia parecida amplia.
4. Canal e faixa de score combinam com o estágio; candidatura sem nota passa
   por qualquer faixa.
5. Filtros sem resultado dizem isso e oferecem "limpar filtros", que mantém o
   estágio.
6. Recarregar e voltar mantêm filtros, campo e lista; o link copiado abre a
   mesma visão em outra sessão.
7. 375 px com o seletor aberto, sem rolagem horizontal; em inglês, nenhum
   rótulo em português (nomes de empresa e canal são dado da pessoa).

Prova automática (não substitui a jornada): área `pipeline-filters` do E2E,
com a conta `e2e-funil-filtros@local.test` e as vagas `908000000`–`908000002`.
