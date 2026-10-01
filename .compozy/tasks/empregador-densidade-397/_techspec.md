# #397 — empregador e densidade

Complexidade M, revisão L1. Posse bootstrap confirmada via tasks show.

Fontes careers são diretas: o adapter usa config.label como empresa real.
A igualdade empresa/rótulo não significa anonimato nesse contrato; outras
fontes conservam a heurística. Alinhar domínio da lista e predicado SQL de
agrupamento, filtro named e facetas. Não inferir identidade de agregadores.

Densidade passa pelo FilterState e serialização compartilhada: links,
formulários GET, paginação e presets preservam dense=1. Continua preferência
de apresentação, sem efeito na seleção de vagas.

Sem schema, scorer, ingestão ou escrita em produção. Pode conflitar com396
em repo.ts/filter-state.ts; preservar ambos os deltas na integração.
