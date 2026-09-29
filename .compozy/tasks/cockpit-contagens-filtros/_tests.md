# Contrato de testes

## Vitest

- `IT-396-01`: com `company`, lista, total e chips de faceta aplicam o mesmo
  empregador.
- `IT-396-02`: com `pay`, cockpit e `/jobs` usam a mesma faixa normalizada,
  moeda, período e câmbio.
- `IT-396-03`: facetas cacheadas separam empresa, faixa e câmbio na chave
  (`tests/board-facets-cache.test.ts`, junto da cobertura existente de cache).
- `IT-396-04`: com agrupamento, o total visível mais o aviso de itens fora da
  faixa não conta uma publicação do mesmo grupo duas vezes (`tests/jobs-board.test.ts`,
  IT-396-02).
- `IT-396-05`: filtros de empresa e salário permanecem no destino do chip e
  não permitem divergência entre card e lista (`tests/filter-state.test.ts` e
  `tests/e2e/cockpit-cards.mjs`).

## E2E / QA vivo

- `E2E-396-01`: em `/` e `/jobs` com a mesma URL salarial, `data-total` é
  igual após refresh.
- `E2E-396-02`: `company=Turing` atualiza a lista e o chip “sem bloqueio”
  para o mesmo universo.
- `E2E-396-03`: com faixa e agrupamento, a soma do total e do aviso fica
  consistente em 375px e no viewport de desktop.
