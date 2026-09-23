## Técnico

### Adicionado

- Cadência das notas em duas filas (#288, ADR 0027): fatias `sem-nota`
  (candidato cuja trilha principal nunca completou uma passada, agenda
  `5-55/10`) e `manutencao` (os demais, de hora em hora) em
  `/api/cron/varredura`, com reserva comum `pontuacao:<candidato>` em
  `sweep_lease`, intervalo mínimo por candidato de cadência − 1 min e o prazo
  da chamada (20 s) passado à unidade. A fatia `pontuar` sai: a rota responde
  400, e reaplicar `supabase/cron/varredura.sql` remove
  `jho-varredura-pontuar`.
- Tabela `score_cursor` (migração aditiva `0019_score_cursor`) e índice
  parcial `job_recency_open_idx`: `scoreAll` percorre as vagas abertas por
  `coalesce(posted_at, first_seen_at)` decrescente em lotes de 100
  (`SCORE_BATCH`), grava a posição depois de cada lote e retoma dela;
  `profile_hash`/`scorer_version` diferentes recomeçam do topo. Regras puras em
  `src/core/scoring/batch.ts`. O `after()` do salvar-CV, a `repontuar` e a CLI
  seguem o mesmo lote e ordem.

### Alterado

- Com prazo, `scoreAll` só começa um lote que caberia pelo mais lento até ali
  (antes conferia o prazo depois do lote e podia passar dele); a leitura vazia
  de uma trilha em dia não gasta o primeiro lote da chamada.
- `/api/cron/varredura` responde 503 (`varredura só roda em produção`) em toda
  fatia quando `JHO_ENV`/`VERCEL_ENV` não declaram `production` — todas as
  declarações presentes precisam concordar. O SQL do agendador recusa aplicar
  fora do projeto de produção. O `after()` do salvar-CV continua valendo em
  qualquer ambiente.

## pt-BR

### Alterado

- Depois de salvar o currículo, as vagas mais recentes ganham nota primeiro; as demais chegam em seguida, em lotes, sem deixar a tela lenta.
- As notas de quem já tem perfil passam a ser atualizadas de hora em hora, e as de quem acabou de chegar a cada dez minutos até ficarem completas.

## en

### Changed

- After you save your CV, the most recent jobs get scored first; the rest follow in batches without slowing the page down.
- Scores for existing profiles are now refreshed every hour, and new profiles are scored every ten minutes until they are complete.
