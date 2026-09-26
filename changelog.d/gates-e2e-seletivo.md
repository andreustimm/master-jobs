## Técnico

### Adicionado

- `pnpm gates` roda só os gates que o diff exige: `config/validation-impact.json` classifica os arquivos alterados por impacto e mapeia cada classe para os gates e testes relacionados (#334, #320).
- Recibo de gates por fingerprint do diff: gate verde para o mesmo fingerprint não roda de novo. Gate que falha sai do recibo gravado, inclusive com `--fresh`, então a próxima execução nunca mostra "já verde" para o que falhou (#336, #320).
- E2E seletivo: o monolito `tests/e2e/ui.mjs` virou orquestrador de áreas em `tests/e2e/ui/*.mjs`, e `config/e2e-spec-map.json` liga cada área às rotas e módulos que ela cobre. `pnpm test:e2e --areas <a,b>` roda só as áreas afetadas; sem `--areas`, a suíte inteira (404 verificações, mesma contagem do monolito) (#343, Closes #320).

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
