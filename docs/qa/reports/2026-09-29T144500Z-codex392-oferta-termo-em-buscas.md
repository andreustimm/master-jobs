# Reteste QA — oferta de termo em Vagas para Buscas

- **Cenário:** `SRCH-save-term-from-jobs`
- **Data:** 2026-09-29
- **Sessão:** Codex, `pt-BR`, viewport 375×812
- **Resultado:** Pass

## Jornada

1. Em Vagas, o termo `Laravel` foi filtrado.
2. A oferta “Buscar nas plataformas” abriu `/searches?term=Laravel`.
3. Buscas exibiu `Laravel` intacto no campo e o salvou na trilha principal existente.
4. Após refresh, a leitura independente encontrou uma única ocorrência do termo na trilha principal.
5. O caminho explícito `/searches/tracks/new?term=Laravel` continua coberto pela suíte E2E com sugestão e evidência.

## Evidência

- `docs/qa/evidence/2026-09-29T144500Z-codex392-oferta-termo-em-buscas/01-oferta-buscas-375.png`
- `docs/qa/evidence/2026-09-29T144500Z-codex392-oferta-termo-em-buscas/02-termo-salvo-refresh-375-full.png`

## Validação técnica

- `pnpm exec vitest run tests/searches-offer.test.ts tests/mobile.test.ts tests/e2e-spec-map.test.ts`: 42 testes passaram.
- `pnpm typecheck`: passou.
- `pnpm test:e2e --areas searches`: 80/80 verificações passaram.
- QA manual com `pnpm test:e2e --manual` e `agent-browser`: passada em 375×812, com refresh e leitura independente.
