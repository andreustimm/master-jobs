# #401 — Comparação manual sem falso erro

- **Tamanho:** M
- **Issue:** [#401](https://github.com/andreustimm/master-jobs/issues/401)
- **Worktree:** `.claude/worktrees/comparacao-cadastro-consistente`
- **Branch:** `fix/comparacao-cadastro-consistente`
- **Base:** `origin/dev`

## Problema

`createManualComparison` persiste a vaga antes de tentar gravar o score. Para
uma conta sem perfil próprio, `scoreOne` retorna `null`; o caso de uso trata
essa ausência de score como erro inesperado e a Server Action devolve uma
mensagem de falha embora a vaga já exista. A ação do formulário então deixa o
usuário tentado a repetir o cadastro.

## Contrato

1. Validação, extração e persistência continuam sendo falhas reais: a ação
   devolve o erro traduzível antes de redirecionar e não cria uma vaga parcial.
2. Depois que `addManualDescriptionJob` devolve um `jobId`, a comparação foi
   cadastrada. A ausência de score, inclusive `scoreOne` retornar `null` por
   falta de perfil próprio, não converte o resultado em falso erro; a ação
   redireciona para a ficha e a tela mostra o estado existente sem score.
3. Falha do score derivado também não desfaz nem repete a ingestão: score é
   recalculável. A persistência continua idempotente pelo fingerprint isolado
   de comparação, então uma nova tentativa para a mesma vaga reaproveita o
   mesmo `jobId`.
4. O scorer e o `profile.yaml` permanecem inalterados. A UI continua usando o
   dicionário, os `data-testid` existentes e o layout responsivo já coberto.

## Fora do escopo

Não há mudança de rubrica, perfil, schema, envio de candidatura ou banco de
produção. A cobertura nova fica no fluxo de comparação manual e no cenário QA
dedicado.
