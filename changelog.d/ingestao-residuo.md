## Técnico

### Adicionado

- Identidade estável da vaga por `(source_id, external_id)` na sincronização
  (#291). `observeRawJobs()` lê em lote as linhas da fonte pelos ids externos
  e decide com a função pura `resolveObservedIdentity()`
  (`src/core/ingest/identity.ts`): título editado atualiza a mesma linha em vez
  de criar outra e fechar a antiga. Fingerprint novo já de outra linha fica de
  fora (a linha mantém o antigo; nada é unido nem apagado). Id vazio ou
  ambíguo na listagem vale o fingerprint. O fechamento por ausência compara
  `job.id`, não fingerprint. Índice não único `job_source_external_idx`.
- Orçamento diário de requisições por rotina, compartilhado entre CLI, Vercel e
  botão: tabela `request_budget (routine, day, used, refused)`, reserva por
  upsert condicional. Tetos em `DAILY_REQUEST_BUDGET`: `reconferencia` 3.000,
  `captura` 1.000, `sync` só conta. `runVerifyQueue`, `verifyJobs` e
  `runFetchStage` param antes do claim com o dia esgotado e devolvem
  `budgetExhausted`.
- `jho ops telemetry [--days N] [--json]`: requisições por rotina e chamadas
  por fatia (`sweep_run`) por dia — o comando do baseline de custo em produção.
- Migração aditiva `0019_ingest_identity_and_request_budget` (tabela nova e
  índice).

### Alterado

- A reconferência periódica também enfileira vagas abaixo da nota 55 que a
  fonte deixou de listar há 3 dias ou mais (`last_seen_at`), depois das acima
  do corte. Vaga de fonte parcial que saiu da janela deixa de ficar aberta
  para sempre; só 404/410 fecham.

## pt-BR

### Melhorias

- Vaga cujo título foi editado pela empresa continua sendo a mesma vaga, com a candidatura que você já registrou nela, em vez de aparecer duplicada.
- Vagas de nota baixa que já saíram do quadro de origem passam a ser conferidas e fechadas quando o link não existe mais.

## en

### Improvements

- A job whose title the company edited stays the same job, with the application you already recorded on it, instead of showing up twice.
- Low-scoring jobs that already left their source board are now checked and closed when the link no longer exists.
