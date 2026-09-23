## Técnico

### Adicionado

- Busca da tela Vagas com frase entre aspas, localização, ordem por relevância,
  explicação do casamento e grupo de termos parecidos (#223, tarefa 05).
  `parseQuery`, `compareByRelevance` e `explainMatch` são puros
  (`src/core/search.ts`); `phraseRegexSql` entra no núcleo de termo. O filtro
  de palavra inteira continua decidindo o conjunto: `sort=relevance` (só com
  `q`) ordena por campo casado (cargo > empresa > localização/descrição), fit,
  recência e id, e devolve o mesmo conjunto e a mesma contagem de `sort=fit`.
- Grupo de proximidade (`nearMatches`): até 20 vagas que passam nos outros
  filtros e não casaram a consulta, por `termo <% title` com limiar fixado na
  transação. Migration aditiva `0017_job_title_trgm` cria `job_title_trgm_idx`
  (GIN, parcial em `closed_at is null`). Sem `pg_trgm`, o grupo some e o
  resultado principal segue.

### Alterado

- O filtro de termo passou a olhar também `location_raw` (adenda A4). Termo que
  não aparece em nenhuma localização devolve o mesmo conjunto de antes.

## pt-BR

### Adicionado

- Na tela Vagas, texto entre aspas busca a frase exata, e a busca passou a olhar também a localização da vaga.
- Com uma busca ativa, dá para ordenar por relevância: primeiro quem tem o termo no cargo, depois na empresa, depois no resto. Cada vaga diz onde a busca casou.
- Abaixo da lista aparecem, à parte, vagas com título parecido que a busca não encontrou. Elas não entram na contagem.

## en

### Added

- On the Jobs screen, text in quotes searches for the exact phrase, and the search now also looks at the job location.
- With a search active, you can sort by relevance: jobs with the term in the title first, then in the company, then elsewhere. Each job says where the search matched.
- Below the list, jobs with a similar title that the search did not find appear separately. They are not counted.
