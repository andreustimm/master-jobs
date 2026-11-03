# Contrato de testes

## Vitest (puro)

- `UT-478-01`: `readPipelineFilters` lê `q`, `semantic`, `company` e `channel`
  repetidos, `fit`/`fitMax` e `stage`; ida e volta por `toPipelineParams`
  devolve a mesma URL (`tests/pipeline-filter-state.test.ts`).
- `UT-478-02`: consulta inválida vira o aviso de `/jobs` e não filtra; faixa
  invertida é trocada com `range_swapped`; estágio desconhecido não filtra.
- `UT-478-03`: sem `semantic=1` a consulta não expande sinônimos nem liga
  `proximity`; com ele, expande pelo dicionário recebido e liga `proximity`.
- `UT-478-04`: `pipelineHref` troca um parâmetro, apaga a página e mantém o
  resto; `company`/`channel` repetidos sobrevivem.
- `UT-478-05`: `readFilters` de `/jobs` continua igual depois da extração de
  `readSearchQuery` (suíte existente `tests/filter-state.test.ts`).

## Vitest (PostgreSQL real)

- `IT-478-01`: texto casa título e descrição, inclusive de vaga fechada; frase
  entre aspas é literal (`tests/pipeline-filters.test.ts`).
- `IT-478-02`: com sinônimos e `proximity`, "engenheiro" acha "Engineer" e
  "kubernets" acha "Kubernetes"; sem `proximity`, o erro de grafia não acha.
- `IT-478-03`: empresas e canais múltiplos são `in`; faixa de score mantém a
  candidatura sem nota.
- `IT-478-04`: `pipelineCounts` com filtros soma o mesmo que `pipelineRows`
  devolve, por estágio; sem filtros, o resultado é o de antes.
- `IT-478-05`: `pipelineFacets` lista só empresas e canais do próprio
  candidato, em ordem, sem a candidatura fora do funil.

## E2E (`tests/e2e/ui/pipeline-filters.mjs`)

- `E2E-478-01`: em `/pipeline`, empresa + texto deixam só a candidatura
  esperada; o contador do estágio dela mostra 1 e o total bate com a lista.
- `E2E-478-02`: canal e faixa de score combinam com estágio; refresh e voltar
  mantêm filtros e resultado (estado na URL).
- `E2E-478-03`: "ampliar busca" acha pelo sinônimo (runner com
  `SEARCH_SYNONYMS_ENABLED=1`) e a busca literal não acha.
- `E2E-478-04`: 375 px sem rolagem horizontal com os filtros abertos; em
  inglês, nenhum rótulo em português.

## QA vivo

- `PIPE-filter-applications` (`untested`): os passos acima com leitura
  independente e refresh, na jornada `J-preserve-application-decision`.
