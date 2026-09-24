## Técnico

### Adicionado

- Histórico de execução de captura e verificação (#223, tarefa 02): tabela
  `source_run` com escopo (`source`, `all`, `verify`), ator, retrato da
  configuração no momento do pedido (sem segredo), contagens anuláveis
  (desconhecido nunca vira zero), completude declarada e erro limitado a 500
  caracteres e redigido (URL sem query string, sem e-mail, sem telefone).
  Índice único parcial na chave de idempotência dos estados ativos: dois
  pedidos equivalentes geram uma execução. Linha terminal é imutável; nova
  tentativa é outra linha ligada por `retry_of`.
- Domínio puro em `src/contexts/operations/domain/runs.ts`: `refuseRun`,
  `runKey`, `catalogRevision`, `nextRunStatus`, `composeParentStatus`,
  `sumCounts`, `redactDetail` e o limitador com reserva síncrona (G13), ao lado
  do `isStale` que a análise de vaga já usava.
- `jho jobs sync --source <kind:handle> [--run <id>]` e
  `jho jobs verify --source <kind:handle> [--run <id>]`. Execução "todas" cria
  uma filha por fonte do retrato do pedido, com concorrência limitada; filha
  que falha deixa o pai `partial`. `running` sem batimento por 15 minutos vira
  `interrupted` e libera novo pedido.
- A `WorkflowDispatchPort` aceita rotina, fonte e execução. O `varredura.yml`
  ganha a rotina `execucao` (insumos `acao`, `execucao`, `fonte`, lidos por
  variável de ambiente), que roda só aquela execução. Sem credencial, a
  execução fica `queued` com o motivo `no_token`.

- Execução `queued` sem executor (sem credencial, despacho que falhou na rede
  ou pendente há mais de 30 min, que o grupo de concorrência do workflow pode
  ter cancelado) é despachada de novo pelo próximo pedido equivalente, em vez
  de segurar a chave para sempre. A execução bate o coração a cada 5 min
  enquanto trabalha; a que foi dada por morta no meio não grava por cima.
- Verificação cortada pelo `--limit` registra `completeness = partial`; o
  workflow verifica até 1000 vagas por fonte.

### Alterado

- `jho jobs sync` e `jho jobs sweep` sem flags registram uma execução `all`
  com as filhas, e a saída mostra o id da execução; a fatia `sync` da
  varredura da Vercel registra uma execução por fonte.
- Todo pedido marca antes como `interrupted` a execução sem batimento, e filha
  que esperava vaga de um pai já encerrado é cancelada (`parent_ended`).
- `jho jobs verify --source` usa fit mínimo 0, salvo `--min-fit` explícito.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
