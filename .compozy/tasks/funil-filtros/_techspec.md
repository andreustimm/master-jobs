## Objetivo

Dar ao `/pipeline` os filtros que a #478 pede — texto, busca ampliada por
sinônimos e grafia parecida, empresa (várias), faixa de score e canal (vários)
—, combinados entre si e com o estágio que já existe, sem uma segunda
implementação da busca de `/jobs`.

## Contrato de URL

| Parâmetro | Valor | Ausente significa |
|---|---|---|
| `stage` | estágio do funil | todos os estágios (já existia) |
| `q` | termos de palavra inteira e frases entre aspas, a mesma gramática de `/jobs` | sem busca |
| `semantic` | `1` | busca literal: sem sinônimos nem grafia parecida |
| `company` | **repetido**, nome exato da empresa de uma candidatura | todas as empresas |
| `channel` | **repetido**, canal gravado na candidatura | todos os canais |
| `fit` / `fitMax` | 0 a 100 | sem piso / sem teto |
| `page` | página (já existia) | primeira |

Parâmetro inválido não derruba a página: consulta inválida vira o mesmo aviso
de `/jobs` (`filterNotices.*`) e o filtro é ignorado; faixa invertida é
trocada com `range_swapped`. Todo link da tela (chip de estágio, paginação,
formulários) leva o estado inteiro; mudar filtro volta à página 1.

## Peças

- **Leitura da consulta, uma só.** `readSearchQuery(raw, dictionary)` sai de
  `readFilters` (`app/filter-state.ts`) e as duas telas a chamam: `parseQuery`
  e `validateTerm` (`src/core/search.ts`, `term.ts`) decidem termos e frases;
  `expandTerms` + `synonymMapOf` dão os sinônimos. `boundedFit` passa a ser
  exportada pelo mesmo motivo.
- **Estado do funil, puro.** `app/pipeline/filter-state.ts` lê e escreve a URL
  (`readPipelineFilters`, `toPipelineParams`, `pipelineHref`,
  `toPipelineFilters`), sem banco, rede nem relógio (regra 4). Com
  `semantic=1` o dicionário é o da composição (`searchSynonyms()`, que respeita
  `SEARCH_SYNONYMS_ENABLED`); sem ele, `EMPTY_SYNONYMS`.
- **Repositório.** `PipelineFilters` (`query`, `synonyms`, `proximity`,
  `companies`, `channels`, `minFit`, `maxFit`) entra em `pipelineRows` e em
  `pipelineCounts` pelo mesmo `pipelineConditions`, então lista, total e
  contador por estágio respondem ao mesmo conjunto. O texto reusa
  `queryParts` + `queryCondition` de `/jobs` (cargo, empresa, localização e
  descrição, inclusive a capturada). `queryCondition` ganha a opção
  `prefilter: false`: o pré-filtro trigrama só olha vaga aberta, e o funil
  guarda candidatura de vaga fechada. Grafia parecida reusa `NEAR_THRESHOLD`
  e `nearNeedle`: `word_similarity(agulha, título) >= 0,6` entra como `or` da
  consulta. `pipelineFacets` lista empresas e canais das candidaturas no funil,
  sem filtro, para a opção marcada não sumir da lista.
- **Score.** Lido da trilha principal (`scoreJoin`), como a coluna mostrada.
  Candidatura sem nota passa pela faixa, como em `/jobs` (#279): ausência de
  nota não é nota baixa (regra 8).
- **Tela.** `app/pipeline/pipeline-filters.tsx` (Server Component) usa as
  peças de `/jobs`: `TransitionGetForm`, `AutoApplyInput`, `RangeSlider`,
  `Toggle` e o seletor de múltipla escolha (`CheckboxPicker`, extraído do
  seletor de fontes de `/jobs`, que passa a usá-lo). Contador por estágio mostra
  o número filtrado; o estágio escolhido fica visível mesmo com zero.

## Limites

- **Semântica de verdade não existe ainda.** "Ampliar busca" é sinônimo
  curado pt/en (#459, atrás de `SEARCH_SYNONYMS_ENABLED`) mais grafia parecida
  no título (trigrama). Entender o sentido da frase depende da #370; a tela não
  usa a palavra "semântica", como `/jobs` (`explainMatch`).
- A linha do funil não explica por que casou (o "também buscou" de `/jobs`).
- Sem filtro "sem canal": canal é texto livre e um valor sentinela colidiria
  com um canal real.

## Fora de escopo

Scorer, schema, ingestão e a busca de `/jobs` (só a extração das funções
compartilhadas, sem mudar comportamento).
