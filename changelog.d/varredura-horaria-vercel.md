## Técnico

### Adicionado

- Varredura fatiada na Vercel (ADR 0025, #281): `GET /api/cron/varredura?fatia=sync|termos|captura|reconferencia|pontuar` faz, por chamada, o que cabe em 20 s. Sync por fonte em round-robin (tentativa mais antiga primeiro, no máximo a cada 45 min), pontuação por candidato a cada 10 min, reserva por unidade com prazo em `sweep_lease` e métrica por chamada e por unidade em `sweep_run` (migração `0016_sweep_lease_and_runs`, aditiva). Alarme de fonte há mais de 2 h sem sync no log e no Sentry, no máximo uma vez por hora.
- Agendamento por `pg_cron` + `pg_net` no Supabase, versionado em `supabase/cron/varredura.sql` e lido do Vault; ativação é passo humano (runbook em `docs/operations.md`).
- `authorizeCronRequest` (contexto de autenticação) e `app/api/cron/authorize.ts`: a borda única do cron por segredo, em tempo constante e sem vazar tamanho. `tests/architecture.test.ts` exige que toda rota de `/api/cron/` recuse pelo segredo antes do primeiro `await`.

### Alterado

- `varredura.yml` vira rede de segurança: com `VARREDURA_AGENDADOR=supabase`, o disparo agendado não roda; o manual continua. O teste de agendador único passa a conferir o SQL do `pg_cron` e a condição do Actions.
- `runVerifyQueue` aceita `budgetMs`, `runFetchStage` aceita `timeoutMs` por página, `syncSource` sincroniza uma fonte só e `scoreCandidate` pontua um candidato sem lançar — as unidades das fatias, sem segunda implementação.
- `/api/cron/recheck` usa a borda comum e o mesmo teto de tempo.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
