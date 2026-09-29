## Técnico

### Adicionado

- Vigia de cota (ADR 0030, Fase 3, #368): `src/contexts/operations/domain/quota-watch.ts` decide, sem rede nem relógio, se uma amostra de `{ vercelDeploys24h, actionsQueueMaxWaitS, actionsStatus }` é `ok`, `aviso` (70 %/minor), `acao-automatica` (90 %/major/critical) ou `amostra-indisponivel` (métrica que falhou nunca vira "ok" por omissão). `src/contexts/operations/app/quota-watch.ts` orquestra coleta → decisão → alerta → gravação, com portas em `ports.ts` (`QuotaMetricsPort`, `QuotaAlertPort`, `QuotaWatchStore`).
- Migração `0030_vengeful_shotgun` (aditiva, veredito `[]`): tabela `production.quota_watch` (`checked_at`, as duas métricas, `decision`, `action_taken`, `reversal_command`, `note`), no mesmo estilo de `sweep_run`.
- Adapters de infraestrutura: `quota-watch-metrics.ts` (lê `api.vercel.com`, `api.github.com` e `githubstatus.com` diretamente, cada chamada isolada por `try/catch`), `quota-watch-issue.ts` (abre issue com rótulo `vigia-de-cota`, reaproveitando o PAT de leitura), `drizzle-quota-watch.ts` (persistência e `recentQuotaWatch`).
- `GET /api/cron/watchdog` — checagem manual/de teste, mesma borda de segredo das outras rotas de `/api/cron/` (`cronDenied`, `CRON_SECRET`); registrada em `PUBLIC_ROUTES` de `tests/architecture.test.ts`. **Não é o agendador de produção.**
- `supabase/cron/watchdog.sql`: `pg_cron`/`pg_net` do Supabase consultando a Vercel e o GitHub Actions **diretamente** (nunca `jobs.mastertimm.com.br`), de propósito, para que uma indisponibilidade real de qualquer um dos dois não leve o vigia junto (ADR 0030 decisão 6) — provado por teste estático (`tests/quota-watch-sql.test.ts`, F3-04) que nenhuma chamada do arquivo aponta para o próprio app. Dois passos assíncronos (`vigia_disparar`/`vigia_coletar`, tabela auxiliar `jho_cron.vigia_pendente`) porque `pg_net` é fire-and-forget. Alerta (issue) é automático; aplicar o `gh variable set` recomendado (`DEPLOY_PREVIEW_ENVS` ou `CI_RUNS_ON`) fica só como recomendação nesta entrega — nunca executado sozinho, porque `CI_RUNS_ON` sem o runner da Fase 2 registrado enfileiraria todo job, e `pg_net` não tem `PATCH`.
- `docs/operations.md`, seção "Vigia de cota: ativar" — passo do dono (PAT do GitHub, token da Vercel, quatro segredos no Vault, aplicar o SQL). `docs/README.md` e `docs/engineering/context-map.md` atualizados (ADR 0030 no índice; `quota_watch` no contexto `operations`, contagem 44).
- Testes: `quota-watch-domain` (F3-01/02/03/05), `quota-watch-composition`, `quota-watch-route`, `quota-watch-metrics`, `quota-watch-issue`, `quota-watch-store-db` (Postgres real), `quota-watch-sql` (F3-04) — 100 % de cobertura de linha e branch nos cinco arquivos novos.

## pt-BR

### Adicionado

- Um vigia passa a rodar de hora em hora, fora da Vercel e do GitHub, checando se algum dos dois está perto do limite de uso. Perto do limite, ele abre um aviso; muito perto (ou com um dos dois fora do ar), ele recomenda a mudança e já indica o comando exato para desfazer — mas quem aplica a mudança continua sendo o dono. O objetivo é nunca mais passar 24 h sem poder publicar uma correção, como aconteceu em 22/09.

## en

### Added

- A watchdog now runs hourly, outside both Vercel and GitHub, checking whether either is close to its usage limit. Near the limit, it opens a warning; very close (or with either provider down), it recommends the fix and already spells out the exact command to undo it — but applying the change is still up to the owner. The goal is to never again go 24 hours unable to ship a fix, as happened on 2026-09-22.
