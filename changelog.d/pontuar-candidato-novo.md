## Técnico

### Corrigido

- Candidato novo (e quem troca o currículo) só ganhava trilha principal e notas
  na varredura diária do GitHub Actions (#280). As ações que enfileiram em
  `score_task` — `saveCvAction`, `importPdfAction`, `restoreVersionAction`,
  `createProfileAction` — agora rodam uma fatia da fila no
  `after()` (`scoreAfterResponse`, `SCORE_SLICE_MS` = 20 s). `scoreAll` aceita
  `deadline`: lê em páginas por id, confere o prazo depois de cada lote e
  devolve `complete: false`; `runScoreQueue({ budgetMs })` devolve a tarefa a
  `pending` sem gastar tentativa e soma `scored` entre as fatias. Nova rota
  `GET /api/cron/score` (`CRON_SECRET`, mesma função de `/api/cron/recheck`,
  agora em `app/api/cron/authorize.ts`) roda uma fatia e responde
  `{ processadas, pontuadas, falhas, adiadas, interrompida, pendentes }` para o
  agendador `pg_cron` da #281. `vercel.json` segue sem `crons`. ADR 0025.
- A derivação que recusa (`sem-curriculo`, `curriculo-fraco`,
  `catalogo-vazio`) aparecia como `failed`; `scoreQueueDisplay` devolve
  `refused` com `reason` (`noCv`, `weakCv`, `emptyCatalog`), e o cartão da
  área do candidato traduz o motivo e a saída.

## pt-BR

### Corrigido

- Quem cria o perfil ou salva um currículo passa a ter a trilha principal e as notas calculadas logo depois de salvar, em vez de esperar a atualização do dia seguinte.
- Quando o currículo é curto demais para montar a trilha, a área do candidato diz isso e o que fazer — colar o currículo completo ou importar o PDF — em vez de mostrar só "Falha na atualização".

## en

### Fixed

- Creating your profile or saving a CV now builds your main track and starts scoring jobs right after you save, instead of waiting for the next day's refresh.
- When your CV is too short to build a track, the candidate area says so and what to do — paste your full CV or import the PDF — instead of just "Refresh failed".
