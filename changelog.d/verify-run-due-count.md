## Técnico

### Adicionado

- `source_run.due_total` (migração 0033, aditiva e anulável): a execução de verificação grava quantas vagas estavam vencidas antes do `limit` (`VerifyResult.due`, repassado por `countsOfVerify` em `RunCounts.dueTotal`). O detalhe de `/admin/execucoes/[id]` usa `completenessCopy` para mostrar "N de M" (`runs.verify{,All}{Complete,Partial}Count`); execução antiga, com o total nulo, mantém a frase sem número. Captura grava nulo.

### Alterado

- O piso de fit da verificação global vira a constante `DEFAULT_VERIFY_MIN_FIT` (`src/core/ingest/availability.ts`), usada por `verifyJobs` e interpolada como `{minFit}` no texto da completude, em vez do 55 literal repetido no dicionário.

## pt-BR

### Adicionado

- O detalhe de uma execução de "Atualizar status" diz quantas vagas foram checadas de quantas havia para checar, por exemplo "3 de 9 vagas abertas da fonte com link público foram checadas". Execuções anteriores continuam com a frase sem número.

## en

### Added

- A status-refresh run now says how many jobs were checked out of how many were due, for example "3 of 9 open jobs of the source with a public link were checked". Earlier runs keep the sentence without numbers.
