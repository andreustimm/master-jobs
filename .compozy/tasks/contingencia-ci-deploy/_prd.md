# PRD: Contingência de CI e deploy

Issue [#351](https://github.com/andreustimm/master-jobs/issues/351). Tamanho
**L** — este PRD, a [techspec](_techspec.md) e o [contrato de testes](_tests.md)
antecedem qualquer execução (R24). Fase 1 nasce como sub-issue S/M executável
já; Fases 2–4 ficam para depois, cada uma com sua própria issue.

## Decisões do dono

Bloco exigido antes da execução. Custos em dólar/euro são aproximados,
levantados por busca em 28/09/2026 (fontes na [techspec](_techspec.md#fontes-de-custo-consultadas-em-28092026));
provedor de nuvem reajusta preço sem aviso — a Hetzner subiu até 3,1× em
junho/2026 e a Oracle cortou o Always Free pela metade em junho/2026, os dois
sem anúncio público. Trate todo número aqui como "verificado nesta data", não
como piso contratual (G83).

### Decisão 1 — Fatiamento da entrega

| Opção | Custo | Risco | Esforço |
|---|---|---|---|
| **A. Fase 1 agora (sub-issue S/M); Fases 2–4 depois, cada uma com sua issue** | nenhum — é sequenciamento | baixo: cada fase é revisável isolada; o intervalo entre fases deixa a Fase 1 sem "botão de religar" runner/plano B, risco que **já existe hoje** | Fase 1 ≈ poucas linhas de `vercel.json` + docs + 1 teste novo; cada fase seguinte soma-se depois |
| B. Entregar as quatro fases numa PR só | nenhum a mais | alto: mistura mudança de baixo risco (Fase 1) com superfície de ataque nova (runner próprio, credenciais do plano B) sob a mesma revisão L2 (G53); qualquer `FIX_BEFORE_SHIP` atrasa o corte do incidente de 22/09, que depende só da Fase 1 | alto, sem paralelismo de revisão |
| C. Fase 1 + Fase 2 juntas agora; Fases 3–4 depois | nenhum | médio: acopla config reversível (Fase 1) à superfície do runner próprio (Fase 2) na mesma revisão | médio-alto |

**Recomendação:** A — é o que a issue já pede, e não faz o corte do incidente
de cota esperar a decisão mais lenta (onde mora o runner).

**Escolha do dono:** _______________________________________________

### Decisão 2 — Onde mora o runner self-hosted (Fase 2)

| Opção | Custo | Risco | Esforço |
|---|---|---|---|
| A. Máquina do dono, container Docker efêmero por job | ~US$0 de infraestrutura nova | alto: a máquina também roda outras coisas do dono, e um bug de isolamento do container ainda compete por CPU/rede com o resto do laptop; disponibilidade do CI passa a depender de o laptop estar ligado e conectado — troca uma indisponibilidade de provedor por uma de operador, o oposto do que a issue pede; token de runner fica num processo local exposto a qualquer outro software da máquina | baixo: Docker já é dependência do E2E local; falta só o script de registro e a imagem |
| **B. VPS dedicada (Hetzner, DigitalOcean; Oracle Free Tier descartado)** | Hetzner CPX22 (2 vCPU/4 GB/80 GB) ≈ €19,99/mês (~US$23); a linha CX/CAX mais barata mostrou indisponibilidade regional e reajuste de até 3,1× em jun/2026 — orçar com folga. DigitalOcean droplet de 4 GB ≈ US$24/mês (o de 512 MB/US$4 não roda Chrome + Postgres + `pnpm install` ao mesmo tempo). Oracle Cloud Always Free (Ampere A1, hoje 2 OCPU/12 GB total, cortado pela metade sem aviso em jun/2026) tem custo US$0, mas a Oracle já reduziu a oferta uma vez e é conhecida por suspender instância "ociosa" sem aviso — **não é fundação para uma contingência de disponibilidade**, então fica fora desta opção | baixo-médio: máquina dedicada, sem concorrência com o uso pessoal do dono; ainda é um único ponto de falha se só uma VPS existir — um nível abaixo do "provedor sem plano B" que abriu esta issue; exige patch de segurança e rotação de chave recorrentes, tarefa que hoje ninguém faz | médio: provisionar, firewall, `systemd` do runner, imagem com Node 24.19/pnpm/Postgres/Chrome |
| C. Nenhum runner self-hosted; aceitar fila/indisponibilidade do Actions hospedado | US$0 | o CI (e a promoção que depende dele) fica sem contingência para fila, limite de API ou mudança para privado — o próprio problema da issue | US$0, mas não entrega a Fase 2 |

**Recomendação:** B, com Hetzner CPX22 ou DigitalOcean 4 GB como candidatos.
Uma VPS separa a disponibilidade do runner da de o dono estar com o laptop
ligado, sem herdar o problema de "um provedor só": a variável `CI_RUNS_ON`
volta para o hospedado em segundos se a VPS cair, então o self-hosted não
precisa de disponibilidade perfeita — só precisa ser opt-in e reversível
(princípio 2 da issue).

**Escolha do dono:** _______________________________________________
(se B, qual provedor e tamanho)

### Decisão 3 — Onde mora o watchdog de cota (Fase 3)

| Opção | Custo | Risco | Esforço |
|---|---|---|---|
| **A. Supabase (`pg_cron` + `pg_net`), no mesmo padrão da [ADR 0025](../../../docs/adr/0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md)** | US$0 adicional — mesmo projeto do banco | baixo-médio: genuinamente fora dos dois provedores monitorados (Vercel, GitHub), cumprindo o princípio 4 da issue; se o próprio Supabase cair, o vigia cai com ele — não cobre esse terceiro risco; precisa de PAT do GitHub e token da Vercel no Vault, ampliando a superfície de segredo | baixo: reaproveita Vault, tabela de métrica no estilo `sweep_run`, e o hábito operacional já existente |
| B. Cron de terceiro (ex.: serviço externo de agendamento, ou um Action agendado fora do runner monitorado) | US$0 a baixo | mais um provedor para confiar e gerenciar segredo; nenhum reaproveito de padrão existente | médio: integração nova, sem tabela nem Vault |
| C. Crontab na própria VPS do runner (Decisão 2) | US$0, se a VPS já existir | a mesma VPS que hospeda o runner vira o vigia — se ela cair, o vigia cai com ela, contrariando "fora do provedor monitorado" quando o que se monitora inclui a própria disponibilidade da VPS | baixo, se a VPS já existir |

**Recomendação:** A — reaproveita um padrão já testado em produção
(`pg_cron`/`pg_net`/Vault), fica realmente fora de Vercel e GitHub, e o custo
marginal é zero.

**Escolha do dono:** _______________________________________________

### Decisão 4 — Plano B da Vercel (Fase 4)

| Opção | Custo | Risco | Esforço |
|---|---|---|---|
| **A. Fly.io** | `shared-cpu-1x` de ~US$2/mês (256 MB) a ~US$6/mês (1 GB); RAM extra ~US$5/GB/mês; tem região São Paulo (`gru`) — a mesma do banco (`sa-east-1`) e da função Vercel hoje (`gru1`), preservando a razão de round-trip que já decidiu `gru1`. O preço passou a variar por região em jul/2026: confirmar o valor exato de `gru` antes de contratar | baixo-médio: plataforma nativa em Docker (`flyctl deploy` de uma imagem), o mesmo formato já decidido para a Fase 4 (Next `standalone` no GHCR); marca menor que Vercel/Railway, menos automação de terceiro | médio: `Dockerfile` (já há `output: "standalone"` em `next.config.ts`), `fly.toml`, segredo replicado (regra 16 — só o nome, nunca o valor, em qualquer doc) |
| B. Railway | Hobby US$5/mês (inclui US$5 de crédito, consumo cobrado à parte); Pro US$20/mês | médio-alto: nenhuma região confirmada na América do Sul (documentadas: EUA/UE/Ásia) — toda chamada ao Supabase em `sa-east-1` cruzaria continente, reabrindo o problema de latência que motivou rodar a função em `gru1` | médio: deploy por Git, parecido com Fly.io |
| C. VPS + Coolify | custo da VPS (mesma faixa da Decisão 2, ~US$5–25/mês) + US$0 de licença (Coolify é open source) | alto: TLS, proxy, backup e patch do host passam a ser responsabilidade do dono; um "plano B" que depende da mesma disciplina operacional que faltou para gerar o plano B da Vercel é um risco circular; pode reaproveitar a VPS da Decisão 2 (uso duplo) e cai em São Paulo se a VPS for DigitalOcean (tem região BR) — a Hetzner não tem | alto: implantação e manutenção contínuas do próprio PaaS |

**Recomendação:** A — região São Paulo confirmada e modelo Docker-nativo, que
já é o formato decidido para a Fase 4. Railway sai por falta de região BR
confirmada; VPS+Coolify fica como opção "sem terceiro pago", mas cobra
disciplina operacional contínua — exatamente o que falta hoje, e o motivo de
esta ADR existir.

**Escolha do dono:** _______________________________________________

---

## Visão geral

O produto depende de dois provedores sem plano B — Vercel (deploy) e GitHub
Actions (CI e promoção) — e o incidente de 22/09/2026 mostrou o custo: o
limite de 100 deploys/dia da Vercel Hobby travou produção por mais de 24 h,
incluindo a correção de segurança da 1.22.1. Hoje cada merge em `dev` e cada
promoção geram deploy de `dev` e `staging`, dois ambientes sem banco próprio
([deploy.md](../../../docs/engineering/deploy.md), "Os três ambientes"), então
esses deploys não validam nada que dependa de dado — só consomem cota.

Este PRD **não corrige o incidente escrevendo código durante o próximo**; ele
transforma a resposta num conjunto de chaves documentadas e testadas, viráveis
em minutos, e num plano B testado uma vez para quando a Vercel falhar de
verdade. O gargalo do produto continua sendo a decisão de candidatura, não a
disponibilidade de infraestrutura ([vision.md](../../../docs/product/vision.md));
esta entrega existe para que uma falta de cota não vire, de novo, 24 h sem
poder publicar uma correção de segurança.

## Objetivos

- Cortar a causa do incidente de 22/09: só `main` gera deploy enquanto `dev` e
  `staging` não tiverem banco próprio (Fase 1).
- Dar ao CI um "runner selecionável" por variável de repositório, sem editar
  workflow no meio de um incidente (Fase 2).
- Detectar risco de cota **antes** de ele virar indisponibilidade, com um
  vigia que não mora nos provedores monitorados (Fase 3).
- Ter, testado uma vez, um destino alternativo de deploy de produção e um
  caminho de DNS para apontar para ele (Fase 4).
- Cada chave vira por uma única variável de repositório, documentada, opt-in e
  reversível pelo mesmo comando — nunca por edição de workflow durante o
  incidente.

## Princípios (herdados da issue, não renegociáveis nesta entrega)

1. **Um lugar só para a chave.** Variável de repositório (`gh variable set`);
   nunca editar workflow no meio do incidente.
2. **Padrão continua o hospedado e barato.** A contingência é opt-in e
   reversível pelo mesmo comando.
3. **Deploy é decisão, não efeito colateral de merge.** Só `main` publica
   enquanto `dev` e `staging` não tiverem banco próprio.
4. **Segurança antes da conveniência.** Repositório público com runner próprio
   é vetor conhecido de execução de código de terceiro (PR de fork); o runner
   nunca roda PR de fork.

## Fatiamento em fases

### Fase 1 — Deploy só em `main`

Corta a causa do incidente de 22/09. `vercel.json` passa a ter
`git.deploymentEnabled` com `dev` e `staging` em `false` (só `main: true`); a
promoção `dev → staging` continua existindo como etapa de Git e CI (SHA
validado, versionamento, PR de produção), só sem gerar deploy de `staging`. A
chave para religar quando as fixtures de `dev`/`staging` existirem é a
variável de repositório `DEPLOY_PREVIEW_ENVS` (formato e mecanismo na
[techspec](_techspec.md#variável-deploy_preview_envs)), com um teste que
recusa divergência entre ela e `vercel.json`. `deploy.md` e `promotion.md`
deixam de descrever deploy de `staging` como efeito da promoção.

### Fase 2 — CI com runner selecionável

Todo `runs-on` do `.github/workflows/ci.yml` (nove ocorrências hoje, listadas
na techspec) passa a ler `vars.CI_RUNS_ON`, com um teste que proíbe `runs-on`
literal novo. Um runner self-hosted **efêmero** (a Decisão 2 escolhe onde),
com labels próprias, roda só `push`/`pull_request` de branch do próprio
repositório — PR de fork nunca é roteada para ele — e leva Node 24.19, pnpm,
PostgreSQL de serviço e Chrome do E2E numa imagem versionada. Runbook de
virar e desligar a chave, com checklist de verificação (um CI verde completo
no runner próprio).

### Fase 3 — Fallback automático e observabilidade de cota

Verificação diária, fora dos dois provedores monitorados (Decisão 3), do uso
de deploys da Vercel nas últimas 24 h e da fila/saúde do Actions. Limiares:
70% avisa (issue ou e-mail via Resend); 90% ou indisponibilidade vira a chave
sozinho e abre issue dizendo o que virou e como voltar.

### Fase 4 — Deploy de produção com alternativa

Imagem Docker do Next `standalone` (já configurado em `next.config.ts`),
publicada no GHCR a cada release. Destino alternativo testado uma vez
(Decisão 4), na região de São Paulo. Troca de tráfego por DNS (Cloudflare)
com TTL baixo, runbook de ida e volta, segredos replicados pela regra 16
(nome, nunca valor). Opcional: produção passa a sair de
`vercel deploy --prebuilt` no workflow pós-`main`, um deploy por release sob
controle do fluxo — o mesmo artefato serve à alternativa.

## Regras de negócio e invariantes

- Nenhuma chave de contingência é ativada por edição de workflow durante um
  incidente: sempre `gh variable set` (princípio 1).
- O padrão, sem nenhuma variável setada, é sempre o caminho hospedado e barato
  de hoje (princípio 2).
- Enquanto `dev` e `staging` não tiverem banco próprio, nenhuma automação gera
  deploy para eles, mesmo que a variável de religamento seja setada por
  engano — o teste que liga `vercel.json` a `DEPLOY_PREVIEW_ENVS` falha fechado.
- Runner self-hosted nunca executa `pull_request` de um fork (regra
  transversal desta entrega, provada por teste desde a Fase 2).
- Nenhum segredo de produção é copiado como valor para o destino alternativo
  em documentação, log ou comentário — só o nome da variável (regra 16).
- O vigia da Fase 3 nunca escreve em `application` nem decide por conta
  própria fora dos limiares definidos; a ação automática (virar a chave, abrir
  issue) é sempre reversível pelo mesmo mecanismo declarado no princípio 1.

## Fora do escopo

- Provisionar os bancos de `dev` e `staging` — decisão separada (segundo
  projeto Supabase gratuito × Branching × schemas no projeto de produção),
  citada no roadmap.
- Trocar de provedor principal (Vercel/GitHub deixam de ser o padrão).
- Resolver a tensão entre G36 (scripts locais só fazem bind em `127.0.0.1`) e
  um `CMD` de container que precisa escutar em todas as interfaces para o
  proxy do destino alternativo alcançá-lo — fica registrada como risco
  conhecido na techspec e decisão de implementação da Fase 4, não desta
  entrega de planejamento.
- Implementar qualquer código de produto: esta entrega é só PRD + techspec +
  `_tests.md` + ADR (R24, tamanho L).

## Riscos residuais, mesmo depois das quatro fases

- Uma única VPS de runner (Decisão 2) ainda é um ponto de falha — um nível
  abaixo do problema original. A mitigação é a reversibilidade (`CI_RUNS_ON`
  volta ao hospedado em segundos), não a eliminação do risco.
- O vigia da Fase 3 não cobre a indisponibilidade do próprio Supabase, que
  hospeda o banco de produção e o watchdog.
- O plano B da Fase 4 é testado uma vez, não continuamente: pode haver deriva
  de configuração entre o exercício de teste e o incidente real.

## Architecture Decision Records

- [ADR 0029 — Contingência de CI e deploy](../../../docs/adr/0029-contingencia-de-ci-e-deploy.md)

## Questões abertas (fora do bloco de decisões do dono)

- Nome exato da tabela de métrica do watchdog (padrão sugerido: `quota_watch`,
  no estilo de `sweep_run`) e por quanto tempo reter as linhas.
- TTL exato do DNS de failover na Cloudflare (proposta inicial: 300 s, a
  confirmar com o dono na execução da Fase 4).
- Se o watchdog abre issue via `gh api` (token de escopo mínimo em Vault) ou
  via e-mail Resend quando o próprio GitHub estiver indisponível — provável
  resposta: os dois, e-mail como via que não depende do provedor que pode
  estar caído.
