## Técnico

### Alterado

- `vercel.json` deploya só `main`; `dev` e `staging` deixam de gerar
  deployment automático a cada push, cortando a causa do incidente de
  22/09/2026 (limite de 100 deploys/dia da Vercel Hobby). Variável de
  repositório `DEPLOY_PREVIEW_ENVS` documenta e religa um ambiente de preview
  quando a fixture de banco dele existir, e `scripts/github/verify-deploy-preview-envs.ts`
  recusa qualquer divergência entre a variável e o `vercel.json` publicado na
  ponta de `main`, `dev` e `staging` (não só o checkout local — a Vercel
  aplica o commit de cada branch), inclusive contra chave fora da lista de
  permissão `{"**", "main", "dev", "staging"}`. Job novo em `governanca.yml`
  roda o verificador a cada corrida agendada de `main`, com permissão própria
  (`contents: read`) e sem `GITHUB_TOKEN` na API de variáveis — que devolve
  403 para esse token; o valor chega pronto pelo `vars.…` do próprio
  workflow, e `gh api` para a variável fica restrito ao uso manual.
  `docs/engineering/deploy.md`, `docs/engineering/service-levels.md` e
  `docs/engineering/promotion.md` deixam de descrever deploy de `staging`
  como efeito automático da promoção e documentam o runbook atual. ADR 0030
  passa de Proposta para Aceita, com as decisões do dono para as Fases 2–4
  registradas (execução delas fica para issues próprias). Fase 1 da #351.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
