## Técnico

### Adicionado

- Eventos de verificação da vaga (#223, tarefa 04): tabela `job_check_event`
  (`job_id` em cascata, `run_id` → `source_run` com `set null`), com veredito,
  código HTTP, motivo (`closed` só com 404/410; o resto `unknown`) e evidência
  limitada a 280 caracteres e redigida.
- `applyVerdict()` (`src/core/ingest/verdict.ts`) é o caminho único do
  veredito: evento e estado da vaga na mesma transação, com a linha da vaga
  travada. Evento mais antigo que o último gravado entra no histórico e não
  reabre nem fecha. Domínio puro em `src/core/ingest/availability.ts`
  (`currentAvailability`, `reasonFor`, `decidesState`).

### Alterado

- `jho jobs verify` (o lote) e a fila de reconferência passam por
  `applyVerdict()`: o lote deixa de fechar vaga sem registrar o veredito e
  passa a gravar `check_status`; concluir a `verify_task` continua só na fila.
  A verificação de uma execução de `source_run` liga o evento a ela.
- Vaga já fechada que recebe outro 404 mantém a data do primeiro fechamento.

## pt-BR

### Novidades

- A página da vaga mostra se ela ainda está disponível na origem e quando foi
  conferida pela última vez. Sem conferência, aparece "disponibilidade
  desconhecida"; conferência de mais de 14 dias aparece como "vencida".

## en

### New

- The job page shows whether the posting is still available at the source and
  when it was last checked. Without a check it reads "availability unknown";
  a check older than 14 days reads "stale".
