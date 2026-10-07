## Técnico

### Adicionado

- Filtros do `/pipeline` (#478): texto (`q`), busca ampliada (`semantic=1`), empresas (`company` repetido), canais (`channel` repetido) e faixa de score (`fit`/`fitMax`), combinados com `stage` e na URL. `pipelineRows` e `pipelineCounts` recebem `PipelineFilters` pelo mesmo `pipelineConditions`, então lista, total e contador por estágio contam o mesmo conjunto; `pipelineFacets` lista empresas e canais do funil. A busca reaproveita a de `/jobs`: `readSearchQuery` (extraída de `readFilters`), `queryParts` e `queryCondition`, que ganha `prefilter: false` para achar texto de vaga fechada; a busca ampliada soma os sinônimos curados (`SEARCH_SYNONYMS_ENABLED`) e `word_similarity` no título com `NEAR_THRESHOLD`. Busca pelo sentido segue dependente da #370. O seletor de fontes de `/jobs` passa a usar o `CheckboxPicker` compartilhado, sem mudança visível. Sem migração, sem mudança no scorer.

## pt-BR

### Adicionado

- O Funil ganhou filtros: busque por palavra no cargo e na descrição, escolha empresas e canais, defina a faixa de score e combine tudo com o estágio. "Ampliar busca" também acha sinônimos em português e inglês e cargos com grafia parecida. Os números de cada estágio acompanham os filtros, e o link guarda a visão filtrada.

## en

### Added

- The Pipeline now has filters: search words in the title and description, pick companies and channels, set a score range, and combine them with the stage. "Broaden search" also finds Portuguese and English synonyms and titles with similar spelling. Each stage's count follows the filters, and the link keeps the filtered view.
