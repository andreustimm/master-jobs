# O contrato de URL da tela Funil

Como em [Vagas](jobs-url-contract.md), todo filtro de `/pipeline` vive na URL:
o link filtrado é compartilhável, o voltar do navegador devolve o estado
anterior e a página continua Server Component. A fonte da verdade é
[`app/pipeline/filter-state.ts`](../../app/pipeline/filter-state.ts)
([#478](https://github.com/andreustimm/master-jobs/issues/478)).

Parâmetro inválido **nunca derruba a página**: vira aviso e o filtro é
ignorado. Estágio desconhecido mostra o funil inteiro, com aviso.

## Os parâmetros

| Parâmetro | Valor | Ausente significa |
|---|---|---|
| `stage` | estágio do funil (`backlog` … `archived`) | todos os estágios |
| `q` | termos de palavra inteira e frases entre aspas, sobre cargo, empresa, localização e descrição (a capturada inclusive) | sem busca |
| `semantic` | `1` | busca literal |
| `company` | **repetido**, nome exato da empresa de uma candidatura | todas as empresas |
| `channel` | **repetido**, canal gravado na candidatura | todos os canais |
| `fit` | 0 a 100 | sem piso de score |
| `fitMax` | 0 a 100 | sem teto de score |
| `page` | página | a primeira |

## As decisões que um leitor precisa saber

**A busca é a de Vagas.** `q` passa por `readSearchQuery`, a mesma leitura
de `/jobs`, e vira o mesmo SQL (`queryParts` + `queryCondition` em
`src/core/db/repo.ts`). A única diferença: o funil dispensa o pré-filtro
trigrama da descrição, que só enxerga vaga aberta — candidatura de vaga
fechada continua achável pelo texto.

**`semantic=1` amplia, não entende.** Com ele, cada termo solto também casa os
sinônimos pt/en da lista curada (`config/search-synonyms.yaml`, só com
`SEARCH_SYNONYMS_ENABLED` ligada) e o cargo de grafia parecida
(`word_similarity` ≥ `NEAR_THRESHOLD`, o mesmo limiar do grupo "termos
parecidos" de Vagas). Busca pelo sentido da frase depende da
[#370](https://github.com/andreustimm/master-jobs/issues/370); a tela diz
"ampliar busca" e não promete semântica. A dica do botão só cita sinônimos
quando a lista está em uso (`broadenHintKey`); desligada, fala só de grafia
parecida. Fica na URL mesmo sem consulta.

**Empresa e canal repetem, como `source` em Vagas.** As opções vêm das
candidaturas da pessoa no funil (`pipelineFacets`), sem filtro, para a opção
marcada não sumir quando outro filtro a zera. Valores repetidos são
alternativas; filtros diferentes valem todos juntos.

**Score sem nota passa.** A faixa lê o score da trilha principal; candidatura
sem nota aparece com qualquer faixa, como em Vagas (#279). Faixa invertida é
trocada, com o aviso `range_swapped`.

**Contador conta o que a lista mostraria.** Lista, total e contador de cada
estágio passam pelos mesmos filtros (`pipelineConditions`). O estágio
escolhido continua visível mesmo com zero, e filtros sem resultado oferecem
"limpar filtros", que mantém o estágio.

**Mudar filtro volta à primeira página.** Só a paginação carrega `page`.
