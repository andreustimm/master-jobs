## Técnico

### Corrigido

- O detalhe de uma execução de verificação (`/admin/execucoes/[id]`) escolhe o texto de completude pelo escopo e pela fonte (`completenessKey(scopeKind, sourceId, completeness)`): captura segue com o texto da listagem da fonte; verificação por plataforma usa `runs.verifyComplete`/`runs.verifyPartial` (vagas abertas da fonte com link público) e a global, `runs.verifyAllComplete`/`runs.verifyAllPartial` (vagas elegíveis, fit 55 ou mais), sem falar de fechar por ausência. O valor gravado em `source_run.completeness` não muda.

## pt-BR

### Corrigido

- A execução de "Atualizar status" não diz mais "janela parcial: não fecha por ausência": mostra "conferência completa" ou "conferência cortada pelo limite ou pelo orçamento de requisições", dizendo se o universo é o da fonte ou o das vagas elegíveis (nota 55 ou mais, com link público) na verificação de todas.

## en

### Fixed

- A status-refresh run no longer reads "partial window: never closes by absence": it shows "full check" or "check cut by the limit or the request budget", saying whether the scope is the source's jobs or the eligible jobs (score 55 or higher, public link) when all sources are checked.
