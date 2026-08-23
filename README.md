# master-jobs

Sourcing, ranqueamento e gestão de candidaturas para uma busca de vaga
conduzida por IA.

Encontra vagas em APIs públicas de ATS e agregadores, pontua cada uma contra um
perfil estruturado de forma **determinística e auditável**, e gerencia o funil —
do backlog à proposta.

Roda **localmente**: CLI + dashboard. Sem servidor, sem conta, sem token.

---

## Começo rápido

```bash
pnpm install
pnpm jho db migrate       # cria o schema em data/jobs.db
pnpm jho db seed          # plano de posicionamento + baseline
pnpm jho fx refresh       # cotações do BCE, para comparar salário entre moedas
pnpm jho jobs sync        # busca todas as fontes e pontua
pnpm dev                  # dashboard em localhost:3000
```

Nenhuma variável de ambiente é obrigatória.

## O que ele faz

### Encontra

Dez adapters contra endpoints públicos e sem autenticação, todos verificados
contra respostas reais da API — não contra documentação, que estava errada em
vários casos.

**ATS** — Greenhouse · Lever · Ashby · SmartRecruiters · Recruitee
**Agregadores** — Himalayas · Remotive · Arbeitnow · RemoteOK · Adzuna (opcional)
**Marketplace** — Braintrust, o único com elegibilidade por país estruturada

Acervo atual: **6.239 vagas abertas**, 1.031 empresas, 13 fontes ativas.

### Ranqueia, e explica o ranking

O scorer é determinístico, não um LLM. Decisão de produto, não limitação: roda
sobre milhares de vagas em segundos, é reproduzível o bastante para ter teste de
regressão, e — o que importa — **é possível discordar dele**.

```
$ pnpm jho jobs show 6439

Lead AI & Data Platform Engineer  #6439
Stealth Company · North America / Asia / Brazil / Europe / ...

Fit 83.8 / 100  (cluster: ai_lead)
  title 24.9 · keywords 26.9 · seniority 12 · geo 15 · comp 5
  · Explicitly open to LATAM/Brazil
  · Asks for 7+ years — matches seniority
  · $70/hour — entre o piso e o alvo
```

Remuneração é comparada **com moeda**: faixas independentes por moeda, projeto
de preço fechado, e conversão via cotações do Banco Central Europeu quando não
há faixa declarada. Bloqueios estruturais — autorização de trabalho nos EUA,
presencial, W2-only — limitam a nota em vez de zerá-la.

Hoje: 1.207 vagas acima de 45, 175 acima de 60, 23 acima de 70.

### Compara uma vaga avulsa

O menu **Comparar vaga** aceita uma descrição colada ou um arquivo PDF, TXT ou
Markdown. O conteúdo vira uma vaga manual de primeira classe — entra no mesmo
acervo, passa pelo mesmo scorer do cockpit e pode seguir para o funil — sem
criar uma candidatura automaticamente.

Além da nota canônica, a tela compara a linguagem da vaga com o currículo atual
salvo em `/candidate`: separa termos já cobertos, experiência escrita sob outro
sinônimo e requisitos ainda não evidenciados no documento. O arquivo original
não é armazenado; só o texto extraído e a proveniência da extração.

### Filtra o que não vale seu tempo

```bash
pnpm jho jobs verify      # checa se as vagas do topo ainda existem
```

Na última verificação: **25% dos links do Jobgether estavam mortos** (404) e
zero em todas as outras fontes. 314 vagas fechadas.

O dashboard filtra por corte, cluster, fonte, busca textual, e três critérios
que importam neste caso: **sem bloqueio**, **empresa identificada** (agregadores
que ocultam o empregador impedem pesquisa e uso de rede) e **recentes**
(publicadas há menos de 3 dias respondem muito mais).

### Gerencia o funil

```bash
pnpm jho track 42 applied --channel referral
pnpm jho pipeline
pnpm jho report            # markdown pro vault Obsidian
```

O histórico de candidaturas é a única coisa que o sistema **não consegue
recriar**. Por isso nenhuma ingestão escreve nele, e vagas que somem da fonte
são marcadas como fechadas em vez de deletadas.

### Lê a sua caixa de entrada

```bash
pnpm jho mail import ~/mail
pnpm jho mail suggestions
```

Job alerts do LinkedIn viram vagas; e-mails de ATS viram **sugestões** de
mudança de funil, que você aceita ou descarta. Isso fecha a lacuna da ADR 0001
sem tocar a plataforma — ver [ADR 0008](docs/adr/0008-ingestao-de-email-como-fonte-de-sourcing.md).

### Sabe quem você conhece

```bash
pnpm jho contacts seed     # empresas onde você já trabalhou
pnpm jho referrals
```

Referrals são ~7% dos candidatos e ~40% das contratações. Nenhuma outra alavanca
do sistema chega perto.

## LinkedIn

Este projeto **não faz scraping do LinkedIn**
([ADR 0001](docs/adr/0001-nao-fazer-scraping-do-linkedin.md)).

O caso hiQ terminou com o LinkedIn ganhando por quebra de contrato — US$ 500 mil
e injunção permanente. A CFAA saiu do caminho para dado público; o contrato não.

Publicação usaria a API oficial (`w_member_social`). Comentários e conexões são
assistidos. E **job alerts por e-mail são a via legítima**, porque o e-mail é
sua correspondência e nada toca a plataforma.

## Stack

Node 24 com type stripping nativo — **sem build step**, só sintaxe TypeScript
apagável ([ADR 0006](docs/adr/0006-typescript-apagavel-sem-build-step.md)).
TypeScript 7 · Drizzle ORM · libSQL · Zod · Commander · Vitest.
Dashboard em Next.js 16 com shadcn/ui e Tailwind v4, em Server Components por
padrão; JavaScript de cliente fica restrito aos controles realmente interativos.

libSQL roda como arquivo local hoje e aponta para Turso amanhã sem trocar uma
linha de SQL ([ADR 0002](docs/adr/0002-libsql-em-vez-de-better-sqlite3.md)).

## Documentação

| Trilha | O que responde |
|---|---|
| [Referência](docs/README.md) | Como o sistema funciona |
| [ADRs](docs/adr/) | Por que cada decisão foi tomada |
| [Produto](docs/product/) | Visão e backlog priorizado |
| [Benchmark](docs/benchmark/) | Concorrentes, mercado e riscos |
| [QA vivo](docs/qa/README.md) | Personas, jornadas, cenários, charters, bugs e relatórios |
| [Skills de desenvolvimento](docs/engineering/skills-evaluation.md) | Catálogo instalado, origem e integração no fluxo |
| [MIGRATION.md](MIGRATION.md) | **Antes de criar arquivo novo em `src/`** |

Agentes de IA leem `AGENTS.md`; `CLAUDE.md` é um symlink para essa fonte única.

## Desenvolvimento

```bash
rtk pnpm check                   # typecheck + Vitest/cobertura + contratos das skills de QA
rtk pnpm test:e2e                # browser isolado + axe WCAG 2.2 AA
rtk pnpm qa:browser:install      # instala uma vez o Chrome do QA de jornada
rtk pnpm db:generate             # após editar src/core/db/schema.ts
rtk pnpm db:studio               # inspeção visual do banco
```

Antes de considerar qualquer coisa pronta: `rtk pnpm check` verde e o E2E
aplicável executado conforme `AGENTS.md`.
Mexeu no scorer ou no `profile.yaml`? Suba o `SCORER_VERSION` e rode
`rtk pnpm jho jobs score --all`.
