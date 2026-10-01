## Objetivo

Fazer que cockpit, lista e aviso de salário descrevam o mesmo conjunto de
vagas para uma URL idêntica. Empresa, faixa salarial, período/moeda e
agrupamento precisam participar da mesma leitura de facetas e de contagem.

## Contrato técnico

- `loadCockpit` resolve a faixa salarial com a mesma moeda, período e câmbio
  usados por `loadJobsView` e passa esses filtros à contagem, lista e facetas.
- `boardFacets` recebe empresa e `pay` (incluindo a tabela de câmbio) na chave
  do cache e aplica o predicado compartilhado antes de contar cada chip.
- `countHiddenByPayRange` conta publicações fora da faixa dentro do mesmo
  universo filtrado e agrupado que a lista exibe; `countBoard + hidden` deve
  fechar o total do universo comparável.
- O link de faceta preserva os filtros ativos que a própria faceta aplica,
  mantendo o destino do card igual ao número exibido.

## Fora de escopo

Não alterar a rubrica de Score, ingestão, schema ou dados de produção. A
correção deve permanecer compatível com as regras de filtro na URL e com os
três temas existentes.
