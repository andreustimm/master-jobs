---
id: PIPE-filter-applications
area: PIPE
title: Filtrar o funil por texto, empresa, canal e score sem perder o estágio nem os contadores
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: Os filtros combinam com o estágio, a lista e o contador de cada estágio mostram o mesmo conjunto, "ampliar busca" acha pelo sinônimo e pela grafia parecida, e o estado sobrevive a refresh e ao voltar do navegador
entry_points: /pipeline; /pipeline?q=engenheiro&semantic=1&company=<empresa>
qa_status: pass
bug_ids: BUG-20261006-pipeline-back-keeps-stale-picker-marks; BUG-20261006-pipeline-swapped-score-fields-stale; BUG-20261006-pipeline-active-stage-invisible; BUG-20261006-primary-button-contrast-dark-theme
fix_status: fixed
retest_status: pass
fix_commits: 961558d6701ebe980553f282b42c9e842194c112
evidence: docs/qa/reports/2026-10-07-qa-492-funil-seletores.md; docs/qa/evidence/2026-10-07-qa-492-funil-seletores/06-voltar-empresa-desmarcada.png; docs/qa/evidence/2026-10-07-qa-492-funil-seletores/04-faixa-invertida-campos-75-80.png
last_report: docs/qa/reports/2026-10-07-qa-492-funil-seletores.md
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
   semântica. Desligada a flag, só a grafia parecida amplia, e a dica do
   botão não menciona sinônimos.
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

**QA de jornada 06/10 (`origin/dev` 4f62a49a, ambiente isolado): `fail`.**
Passam 1, 2 (sem a vaga fechada), 3 (com a lista de sinônimos ligada), 5 e 7.
O 4 filtra certo, mas a faixa invertida igual à aplicada deixa os campos
invertidos (BUG-20261006-pipeline-swapped-score-fields-stale). O 6 reprova:
refresh, link em outra sessão e voltar acertam lista, contadores e resumo, mas
voltar ou "limpar" deixa a caixa de empresa/canal marcada e o próximo Aplicar
a devolve (BUG-20261006-pipeline-back-keeps-stale-picker-marks, issue #492).
Ficaram sem verificar: vaga fechada achável pelo texto, candidatura sem nota em
qualquer faixa e a busca ampliada com a lista de sinônimos desligada (o
ambiente isolado a liga sempre).
Relatório: `docs/qa/reports/2026-10-06-qa-478-funil-filtros.md`.

**Reteste 07/10 (`fix/funil-seletores`, PR #496, correção `961558d`; ambiente
isolado): `pass` nos passos 4 e 6, sem refresh entre os passos.** Voltar,
avançar e "limpar" deixam as caixas de empresa e canal iguais à URL, e o
Aplicar seguinte filtra só pelo que foi marcado (inclusive em
`?q=engenheiro&semantic=1&company=Vercel&stage=applied` → voltar duas vezes →
Gopher). Com `fit=75&fitMax=80` aplicado, digitar 80/75 mostra o aviso de troca
com os campos e o controle deslizante em 75/80, e o Aplicar seguinte envia
75/80 sem aviso — pela tela e por `/pipeline?fit=75&fitMax=80` aberto direto.
Os passos 1, 2, 3, 5 e 7 não foram refeitos; continuam sem verificar a vaga
fechada, a candidatura sem nota e a busca ampliada com a lista desligada.
Seguem abertos, sem bloquear o cenário, os dois atritos anteriores à #478
(estágio ativo invisível e contraste do botão primário no tema escuro).
Relatório: `docs/qa/reports/2026-10-07-qa-492-funil-seletores.md`.
