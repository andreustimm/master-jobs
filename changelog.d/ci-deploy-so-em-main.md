## Técnico

### Alterado

- `vercel.json` deploya só `main`; `dev` e `staging` deixam de gerar
  deployment automático a cada push, cortando a causa do incidente de
  22/09/2026 (limite de 100 deploys/dia da Vercel Hobby). Variável de
  repositório `DEPLOY_PREVIEW_ENVS` documenta e religa um ambiente de preview
  quando a fixture de banco dele existir, e `scripts/github/verify-deploy-preview-envs.ts`
  recusa qualquer divergência entre a variável e o `vercel.json` publicado na
  ponta de `main`, `dev` e `staging` (não só o checkout local — a Vercel
  aplica o commit de cada branch). Em cada branch, confere só a chave que
  decide o deploy dela mais `**` e a lista de permissão de chaves
  `{"**", "main", "dev", "staging"}` — nunca o mapa inteiro, para não acusar
  falso positivo durante o próprio runbook de religar (`dev` já em `true` e
  `main` ainda não mesclado não afeta o deploy de `main`). Workflow dedicado
  `verificar-deploy-preview-envs.yml` (dispara no push que toca `vercel.json`
  em `main`/`dev`/`staging`, mais um agendamento diário como rede de
  segurança; fora de "Governança em produção" — para não misturar essa
  divergência com o sinal de disponibilidade da sonda `medir`) injeta a
  variável pelo `vars.…` do env, porque `GITHUB_TOKEN` não lê a API de
  variáveis (403); `gh api` para a variável fica restrito ao uso manual.
  `docs/engineering/deploy.md` e `docs/engineering/promotion.md` deixam de
  descrever deploy de `staging` como efeito automático da promoção e
  documentam o runbook atual, de religar e de desligar de novo (os dois por
  PR para `dev`, nunca commit direto — regra 18/G43). ADR 0030 passa de
  Proposta para Aceita, com as decisões do dono para as Fases 2–4 registradas
  (execução delas fica para issues próprias). Fase 1 da #351.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
