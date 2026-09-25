## Técnico

### Alterado

- Facetas, quadro e cockpit leem 10 a 20 vezes menos blocos do banco num acervo com a forma do de produção (#222): a publicação canônica do grupo sai de `min(id) ... group by` em vez de `row_number() ... rn = 1`, cuja estimativa de 0,5% levava a laços aninhados; a trilha principal de quem já tem escopo de candidato é uma subconsulta escalar (`candidatePrimaryScoreFilter`); `corpusStats` conta as notas numa passada só; `listBoard` passa pela mesma janela de ids de `listBoardPage`. Resultados idênticos, conferidos consulta a consulta.
- Migração `0025_facet_read_indexes` (aditiva): índice parcial `job_described_open_idx`, que a faceta "com descrição" usa em vez de abrir o TOAST de cada vaga, e `job_score_board_cover_idx` com `INCLUDE (fit, cluster, blockers)`, escrito à mão porque o Drizzle não declara colunas incluídas.
- `pnpm perf:facetas`: benchmark com acervo de forma de produção (15 mil vagas, 6 mil abertas, 4 candidatos com 3 trilhas, descrições no TOAST) que imprime tempo e blocos tocados por consulta.

## pt-BR

### Melhorado

- A tela Vagas e o painel inicial fazem bem menos leitura no banco para montar a lista e contar os filtros.

## en

### Improved

- The Jobs screen and the home dashboard read far less from the database to build the list and count the filters.
