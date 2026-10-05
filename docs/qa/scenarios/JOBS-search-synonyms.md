---
id: JOBS-search-synonyms
area: JOBS
title: Buscar em português e achar a vaga publicada só em inglês, com a lista de sinônimos ligada
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Com a lista de sinônimos ligada, "engenheiro" traz também a vaga "Software Engineer", a linha dela diz "também buscou: engineer", o total conta as duas e, entre aspas, a busca volta a ser literal
entry_points: /jobs?q=engenheiro&sort=relevance
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-search-relevance
---

Novo em #370 (Fase 0). Só é visível com `SEARCH_SYNONYMS_ENABLED=1` no
ambiente (desligada por padrão; ligar em preview ou produção é decisão do
dono). Sem a flag, este cenário não tem o que observar: a busca é a de antes e
nenhuma linha leva a nota.

A conferir, com a flag ligada: `engenheiro` traz a vaga em inglês com
"Engineer" no cargo, e a linha diz "também buscou: engineer"; a vaga que casa
pelo termo digitado não leva a nota; o total do cabeçalho conta as duas e não
muda ao alternar `sort=fit` e `sort=relevance`; `"engenheiro"` entre aspas não
expande; recarregar a página mantém o resultado; em 375 px nada estoura para o
lado; nenhum texto fala em semântica. Com a flag desligada, a mesma URL traz só
a vaga em português.

Prova automática (não substitui a leitura independente da jornada full): a
área `search-synonyms` do E2E (E2E-007), com fixtures `907000000` e
`907000001`. A jornada full no ambiente com a flag ligada fica pendente.
