# job-hunt-os

Sourcing, ranqueamento e gestão de candidaturas para uma busca de vaga
conduzida por IA.

Encontra vagas em APIs públicas de ATS e agregadores, pontua cada uma contra um
perfil estruturado de forma **determinística e auditável**, e gerencia o funil —
do backlog à proposta.

Roda **localmente**. Sem servidor, sem conta, sem token.

---

## Começo rápido

```bash
pnpm install
pnpm jho db migrate       # cria o schema em data/jobs.db
pnpm jho db seed          # carrega o plano de posicionamento e a baseline
pnpm jho jobs sync        # busca todas as fontes e pontua
pnpm jho jobs list --min-fit 60
```

Nenhuma variável de ambiente é obrigatória.

## O que ele faz

### Encontra

Nove adapters contra endpoints públicos e sem autenticação, todos verificados
contra respostas reais da API — não contra documentação, que estava errada em
vários casos.

**ATS** — Greenhouse · Lever · Ashby · SmartRecruiters · Recruitee
**Agregadores** — Himalayas · Remotive · Arbeitnow · RemoteOK · Adzuna (opcional)

Estado atual do acervo: **5.021 vagas** de 12 fontes configuradas, todas `ok`.

### Ranqueia, e explica o ranking

O scorer é determinístico, não um LLM. Isso é uma decisão de produto, não uma
limitação: roda sobre milhares de vagas em segundos, é reproduzível o bastante
para ter teste de regressão, e — o que importa de verdade — **é possível
discordar dele**.

```
$ pnpm jho jobs show 42

Applied AI Engineer  #42
Paires · Canada / South Africa / Portugal / Brazil / ...

Fit 74.2 / 100  (cluster: ai_lead)
  title 33.3 · keywords 10.8 · seniority 7.2 · geo 15 · comp 8 · penalty -0
  · Title matches "Applied AI Engineer" (cluster ai_lead)
  · Explicitly open to LATAM/Brazil
  · Pays up to 330,000 — at or above target

  Matched: llm, rag, evals, guardrails, python, aws
```

Bloqueios estruturais — exigência de autorização de trabalho nos EUA,
presencial, W2-only — são detectados e **limitam** a nota em vez de zerá-la:
uma vaga ótima que diz "US preferred" ainda merece ser vista, só não no topo.

Hoje: 346 vagas acima do corte de 45, 41 acima de 55, 17 acima de 60.

### Gerencia o funil

```bash
pnpm jho track 42 applied -n "enviado via Ashby"
pnpm jho pipeline
pnpm jho report            # exporta markdown pro vault Obsidian
```

O histórico de candidaturas é a única coisa que o sistema **não consegue
recriar**. Por isso a ingestão nunca escreve nele, e vagas que somem da fonte
são marcadas como fechadas em vez de deletadas.

### Executa o plano de posicionamento

O plano de ação da auditoria de julho/2026 vive como 31 tarefas consultáveis,
com prioridade, esforço e a referência exata da seção que as originou.

```bash
pnpm jho tasks list --horizon 24h
pnpm jho tasks show PT-0001
pnpm jho tasks done PT-0001
```

## LinkedIn

Este projeto **não faz scraping do LinkedIn**, por decisão explícita
([ADR 0001](docs/adr/0001-nao-fazer-scraping-do-linkedin.md)).

Publicação usaria a API oficial (`w_member_social`, self-serve, sem fila de
aprovação). Comentários, conexões e busca são **assistidos**: o agente redige e
enfileira, o humano abre e age. Dirigir o cookie `li_at` viola a seção 8.2 do
User Agreement e arrisca a conta — que é justamente o principal ativo de
posicionamento.

A busca de vagas não sofreu com isso. Ficou melhor: os ATS entregam JSON
estruturado com faixa salarial e descrição completa.

## Stack

Node 24 com type stripping nativo — **sem build step** e só sintaxe TypeScript
apagável ([ADR 0006](docs/adr/0006-typescript-apagavel-sem-build-step.md)).
TypeScript 7 · Drizzle ORM · libSQL · Zod · Commander · Vitest.

libSQL roda como arquivo local hoje e aponta para Turso amanhã sem trocar uma
linha de SQL ([ADR 0002](docs/adr/0002-libsql-em-vez-de-better-sqlite3.md)).

Next.js 16 e deploy na Vercel estão preparados no caminho, mas **não foram
construídos** — não existe `app/`, UI nem cron. Ver [roadmap](docs/roadmap.md).

## Documentação

| Trilha | O que responde |
|---|---|
| [Referência](docs/README.md) | Como o sistema funciona |
| [Engenharia](docs/engineering/README.md) | Como trabalhar nele |
| [Produto](docs/product/README.md) | Por que ele existe |
| [ADRs](docs/adr/) | Por que cada decisão foi tomada |

Agentes de IA: `CLAUDE.md` (Claude Code) ou `AGENTS.md` (Codex, OpenCode).
Skills, commands e subagentes ficam em `.claude/`, espelhados em `.opencode/`.

## Desenvolvimento

```bash
pnpm check          # typecheck + testes
pnpm test
pnpm db:generate    # após editar src/core/db/schema.ts
pnpm db:studio      # inspeção visual do banco
```

Antes de considerar qualquer coisa pronta: `pnpm check` verde.
Mexeu no scorer ou no `profile.yaml`? Suba o `SCORER_VERSION` e rode
`pnpm jho jobs score --all`.
