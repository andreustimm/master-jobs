## Técnico

### Corrigido

- O detalhe de uma execução de verificação (`/admin/execucoes/[id]`) escolhe o texto de completude pelo escopo (`completenessKey`): captura segue com o texto da listagem da fonte; verificação usa `runs.verifyComplete` e `runs.verifyPartial`, sem falar de fechar por ausência. O valor gravado em `source_run.completeness` não muda.

## pt-BR

### Corrigido

- A execução de "Atualizar status" não diz mais "janela parcial: não fecha por ausência": mostra "conferência completa" ou "conferência cortada pelo limite", que descrevem o que a verificação fez.

## en

### Fixed

- A status-refresh run no longer reads "partial window: never closes by absence": it shows "full check" or "check cut by the limit", which describe what the verification did.
