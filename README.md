# job-hunt-os

Sourcing, ranqueamento e gestão de candidaturas para uma busca de vaga
conduzida por IA.

Encontra vagas em APIs públicas de ATS e agregadores remotos, pontua cada uma
contra um perfil estruturado de forma **determinística e auditável**, e
gerencia o funil — do backlog à proposta.

Roda **localmente**. Sem servidor, sem conta, sem token.

---

## Começo rápido

```bash
pnpm install
pnpm jho db migrate       # cria o schema em data/jobs.db
pnpm jho jobs sync        # busca todas as fontes e pontua
pnpm jho jobs list --min-fit 60
```

Primeira execução real: **4.824 vagas** de 12 fontes, em segundos.

## O que ele faz

```bash
pnpm jho jobs show 42     # por que esta vaga pontuou 74,2
pnpm jho track 42 applied # move no funil
pnpm jho pipeline         # estado do funil
pnpm jho report           # exporta markdown pro vault Obsidian
```

Cada score se explica. `jobs show` imprime o breakdown componente a
componente, as keywords que casaram, as que faltaram, e qualquer bloqueio
detectado — exigência de autorização de trabalho, presencial, W2.

```
Fit 74.2 / 100  (cluster: ai_lead)
  title 33.3 · keywords 10.8 · seniority 7.2 · geo 15 · comp 8 · penalty -0
  · Title matches "Applied AI Engineer" (cluster ai_lead)
  · Explicitly open to LATAM/Brazil
  · Pays up to 330,000 — at or above target
```

## Fontes

Nove adapters, todos contra endpoints públicos e sem autenticação, todos
verificados contra respostas reais da API:

**ATS** — Greenhouse · Lever · Ashby · SmartRecruiters · Recruitee
**Agregadores** — Himalayas · Remotive · Arbeitnow · RemoteOK · Adzuna (opcional)

Configuração em `config/sources.yaml`. Adicionar uma empresa é uma linha.

## LinkedIn

Este projeto **não faz scraping do LinkedIn**, por decisão explícita
([ADR 0001](docs/adr/0001-nao-fazer-scraping-do-linkedin.md)).

Publicação usa a API oficial (`w_member_social`, self-serve). Comentários,
conexões e busca são **assistidos**: o agente redige e enfileira, o humano
abre e age. Dirigir o cookie `li_at` viola a seção 8.2 do User Agreement e
arrisca a conta — que é justamente o principal ativo de posicionamento.

## Stack

Node 24 (type stripping nativo, sem build step) · TypeScript 7 ·
Drizzle ORM · libSQL · Zod · Commander · Vitest.

Next.js 16 e deploy na Vercel estão preparados no caminho, mas **não são o
modo atual** — ver [roadmap](docs/roadmap.md).

## Documentação

Tudo em [`docs/`](docs/README.md). Comece por
[arquitetura](docs/architecture.md), ou vá direto ao
[modelo de dados](docs/data-model.md), [scoring](docs/scoring.md),
[fontes](docs/sources.md) ou [operação diária](docs/operations.md).

As decisões e seus porquês estão em [`docs/adr/`](docs/adr/).

Agentes de IA: leia `CLAUDE.md` (Claude Code) ou `AGENTS.md` (Codex, OpenCode).

## Desenvolvimento

```bash
pnpm check          # typecheck + testes
pnpm test
pnpm db:generate    # após editar src/core/db/schema.ts
```
