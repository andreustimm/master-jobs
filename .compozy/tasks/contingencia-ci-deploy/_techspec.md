# Techspec: Contingência de CI e deploy

Issue [#351](https://github.com/andreustimm/master-jobs/issues/351). Companheiro
de [_prd.md](_prd.md) e [_tests.md](_tests.md). As escolhas marcadas
"pendente" dependem do bloco "Decisões do dono" do PRD; o resto é a arquitetura
que vale **qualquer que seja** a escolha.

## Resumo executivo

Quatro mudanças independentes, sequenciadas por risco crescente:

1. **Fase 1** move o interruptor de deploy de "todo push em `dev`/`staging`"
   para "só `main`", com uma variável documentada para religar. Config pura,
   sem infraestrutura nova.
2. **Fase 2** torna o `runs-on` do CI uma variável de repositório e acrescenta
   um runner self-hosted efêmero, com a guarda de fork como invariante testada
   desde o primeiro commit.
3. **Fase 3** acrescenta um vigia de cota fora dos dois provedores monitorados,
   que vira a chave da Fase 1/2 sozinho sobre limiar.
4. **Fase 4** produz um artefato de deploy alternativo (imagem Docker) e um
   destino testado, com troca de DNS.

Nenhuma fase remove a Vercel ou o GitHub Actions como padrão; todas são
opt-in e reversíveis pelo mesmo mecanismo (variável de repositório), conforme
o princípio 1 do PRD.

## Arquitetura do sistema

### Componentes por fase

- **Fase 1** — `vercel.json` (`git.deploymentEnabled`), variável de
  repositório `DEPLOY_PREVIEW_ENVS`, script de verificação de contrato
  (`scripts/github/verify-deploy-preview-envs.ts`, proposto — mesmo padrão de
  `scripts/github/verify-protections.ts`), `docs/engineering/deploy.md` e
  `docs/engineering/promotion.md`.
- **Fase 2** — `.github/workflows/ci.yml` (nove jobs, `runs-on` por variável),
  variável `CI_RUNS_ON`, imagem do runner (`Dockerfile` ou script de setup,
  local proposto: `ops/runner/`), registro do runner na VPS/máquina escolhida
  na Decisão 2, teste estático que proíbe `runs-on` literal novo.
- **Fase 3** — `pg_cron`/`pg_net` do Supabase (se a Decisão 3 confirmar A),
  tabela de métrica nova (proposta: `quota_watch`), Vault do Supabase para os
  tokens de leitura (Vercel API, GitHub API), `RESEND_API_KEY`/`RESEND_FROM`
  já existentes para o alerta de 70%, `gh api` para abrir a issue aos 90%.
- **Fase 4** — `next.config.ts` (`output: "standalone"`, já configurado),
  `Dockerfile` novo, workflow de publicação no GHCR pós-`main`, destino
  alternativo (Decisão 4), zona Cloudflare já usada pelos três CNAMEs
  (`deploy.md`, seção DNS) para o failover.

### Porta e adapter da seleção de runner

Hoje `runs-on: ubuntu-latest` é um literal repetido em cada job — a variação
(hospedado vs. próprio) é decidida no arquivo YAML, sem porta. A mudança
proposta:

```yaml
runs-on: ${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}
```

`vars.CI_RUNS_ON` é a "porta": ausente ou vazia, `fromJSON` recebe o literal
`'"ubuntu-latest"'` (uma string JSON) e o comportamento de hoje não muda. Setar
`gh variable set CI_RUNS_ON --body '["self-hosted","master-jobs"]'` troca o
runner de todo job **sem editar workflow** — exatamente o princípio 1. Isso
não é uma porta de domínio no sentido de G04/G05 (não há lógica de negócio
aqui); é a mesma ideia aplicada à configuração de infraestrutura: variação
real (onde o job roda) entra por uma única variável, nunca por edição do
arquivo que a promoção e a proteção de branch fiscalizam.

## Design de implementação

### Fase 1

`vercel.json` atual:

```json
{
  "git": {
    "deploymentEnabled": { "**": false, "main": true, "dev": true, "staging": true }
  }
}
```

Proposto:

```json
{
  "git": {
    "deploymentEnabled": { "**": false, "main": true, "dev": false, "staging": false }
  }
}
```

<a id="variável-deploy_preview_envs"></a>
**Variável `DEPLOY_PREVIEW_ENVS`.** A Vercel não lê variáveis de ambiente
dentro de `vercel.json` — o arquivo é estático e é o mecanismo real que a
Vercel aplica. `DEPLOY_PREVIEW_ENVS` não substitui `vercel.json`; ela é o
**registro documentado e verificável** de qual dos dois ambientes de preview
está religado, para que exista "um lugar só" (princípio 1) que o runbook
manda o dono editar, em vez de "abra `vercel.json` e edite o JSON à mão" — o
mesmo raciocínio que já vale para `VARREDURA_AGENDADOR` e
`SUPABASE_CRAWL_ENABLED`.

- **Formato proposto:** lista separada por vírgula, subconjunto de
  `dev,staging` (nunca `main`, que é sempre `true` e não depende de fixture).
  Vazia ou ausente = comportamento desta entrega (só `main` deploya).
  Exemplos válidos: `""`, `"dev"`, `"dev,staging"`.
- **Contrato executável:** `scripts/github/verify-deploy-preview-envs.ts`
  (proposto, mesmo padrão de `verify-protections.ts`) lê a variável via
  `gh api repos/.../actions/variables/DEPLOY_PREVIEW_ENVS` e compara ao mapa
  `git.deploymentEnabled` de `vercel.json`; diverge, falha (`exit 1`). Roda em
  `governanca.yml` (já existente) e por invocação manual antes/depois de
  qualquer mudança na variável, para que a variável nunca minta sobre o que
  `vercel.json` realmente aplica.
- **Runbook de religar** (execução, não desta entrega): 1) confirmar a fixture
  do ambiente provisionada; 2) `gh variable set DEPLOY_PREVIEW_ENVS --body
  "dev"`; 3) editar `vercel.json` para `"dev": true`; 4) rodar o verificador;
  5) confirmar o primeiro deploy de `dev` na Vercel.

`deploy.md` ("Branches que geram deploy") e `promotion.md` ("A promoção
empurra... e gera deploy de `staging`") deixam de descrever o deploy de
`staging` como efeito automático da promoção — a promoção continua fazendo
fast-forward e criando o `chore(release)`, só não aciona mais deploy nenhum
além do que `main` já teria.

### Fase 2

Nove ocorrências de `runs-on: ubuntu-latest` em `.github/workflows/ci.yml`
(linhas 46, 114, 201, 234, 278, 315, 371, 435, 449 no SHA lido em 28/09/2026)
passam para a expressão com `fromJSON(vars.CI_RUNS_ON || ...)`. Um teste
estático (Vitest lendo o YAML como texto, no estilo de
`tests/ci-pipeline.test.ts`) reprova qualquer `runs-on:` literal novo fora
dessa expressão — o mesmo mecanismo que já reprova job novo fora de
`qualidade.needs`.

**Guarda de fork, obrigatória em qualquer job roteado ao runner próprio:**

```yaml
if: |
  vars.CI_RUNS_ON == '' ||
  github.event_name != 'pull_request' ||
  github.event.pull_request.head.repo.full_name == github.repository
```

Ou, de forma mais simples e testável: um job de guarda separado que falha o
run inteiro se `vars.CI_RUNS_ON` aponta para `self-hosted` **e** o evento é
`pull_request` de um fork — preferível porque um único ponto de checagem é
mais fácil de auditar do que repetir a condição em nove jobs. A opção exata
(condição por job vs. gate único) fica para a execução da Fase 2, mas o
critério de aceite (`_tests.md`, F2-03/F2-04) é o mesmo nos dois desenhos:
nenhum job de PR de fork roda com `runs-on` resolvendo para `self-hosted`.
A exigência de aprovação para workflow de fork ("Approve and run") continua
ligada — esta guarda é redundante de propósito, não substituta.

**Imagem do runner.** Node 24.19 (mesma versão de `engines` em
`package.json`), pnpm, PostgreSQL de serviço (o E2E e os testes já sobem
`postgres:17` via Docker — `tests/support/postgres-global.ts` — então a VPS
precisa de Docker instalado, não de um Postgres residente), Chrome/Chromium
para Playwright. Registrado como runner **efêmero**: um container por job,
destruído ao fim (`--ephemeral` do `config.sh` do runner do GitHub), para que
uma PR comprometida não deixe estado para a próxima execução.

**Labels:** `self-hosted`, `linux`, `master-jobs` (como no exemplo do runbook
da issue) — específicas o bastante para não colidir com outro projeto que
eventualmente use a mesma VPS.

### Fase 3

Vigia diário (proposta: a cada hora, mais granular que "diário", porque o
limite da Vercel é por dia corrido e detectar aos 70% de um dia que já está
acelerando precisa de mais de uma amostra por dia):

- **Métrica de deploys da Vercel:** `GET
  https://api.vercel.com/v6/deployments?projectId=...&since=<24h atrás>`,
  contagem de deployments criados na janela — o token vem do Vault, escopo
  leitura.
- **Métrica de fila/saúde do Actions:** `gh api repos/.../actions/runs?status=queued`
  e `in_progress`, com o tempo em fila calculado a partir de `created_at`; e
  `GET https://www.githubstatus.com/api/v2/status.json` para indisponibilidade
  da plataforma (fora do controle do repositório).
- **Tabela proposta** `quota_watch(id, checked_at, vercel_deploys_24h,
  actions_queue_max_wait_s, actions_status, action_taken, note)` — no mesmo
  espírito de `sweep_run`: números e texto operacional, nunca segredo.
- **Limiares:** 70% (70 deploys/24h OU fila > N minutos, N a definir na
  execução) → aviso (issue via `gh api` ou e-mail Resend, o que estiver
  disponível). 90% ou indisponibilidade confirmada (probe HTTP falhando) →
  ação automática: `gh variable set CI_RUNS_ON ...` e/ou preparar
  `DEPLOY_PREVIEW_ENVS`/plano B conforme o que estourou, e abrir issue
  descrevendo o que mudou e o comando exato para desfazer.
- **Onde roda:** Supabase `pg_cron`/`pg_net` (Decisão 3), reaproveitando o
  Vault que já guarda `jho_cron_secret` (ADR 0025) para os tokens novos —
  cada token com o nome da variável documentado, nunca o valor (regra 16).

### Fase 4

- **Imagem:** `next.config.ts` já declara `output: "standalone"`; falta o
  `Dockerfile` (`node:24-slim` como base, copiar `.next/standalone`,
  `.next/static`, `public/`) e o workflow `publicar-imagem.yml` (proposto),
  disparado depois do sucesso de `main`, publicando
  `ghcr.io/andreustimm/master-jobs:<tag>`.
- **Tensão com G36, registrada como risco de implementação (não resolvida
  aqui).** `pnpm start` roda `next start --hostname 127.0.0.1`
  (`docs/engineering/rules/security.md#g36`, regra 12) — correto para o
  laptop do dono, mas um container cujo processo escuta só em `127.0.0.1` é
  inatingível pelo proxy de borda do destino alternativo, que fica fora do
  namespace de rede do container. A execução da Fase 4 precisa de um script
  de arranque **diferente** de `start` (ex.: `start:container`, invocando
  `node .next/standalone/server.js` com `HOSTNAME=0.0.0.0` lido do ambiente do
  destino, nunca do laptop) — sem alterar o que G36 garante para `dev`/`start`
  locais. Qualquer mudança na regra 12 exige, por G62, atualizar a entrada
  (`AGENTS.md`) e `security.md` no mesmo commit; este techspec só aponta a
  tensão, a resolução é tarefa da execução da Fase 4.
- **DNS de failover:** os três CNAMEs de produção/staging/dev já apontam para
  `cname.vercel-dns.com` na Cloudflare, sem proxy (nuvem cinza) — TLS é da
  Vercel. Um failover para Fly.io/Railway/VPS precisa de nuvem cinza também
  (o mesmo motivo já documentado: nuvem laranja duplica CDN sem ganho) e de um
  TTL baixo (proposta: 300 s) para que a troca do CNAME de produção propague
  rápido. Runbook de ida e volta: trocar o CNAME, esperar a propagação
  (`dig`/`dig +trace`), confirmar TLS válido no destino alternativo, smoke
  test manual, e o caminho inverso quando a Vercel voltar.
- **Segredos replicados:** toda variável de ambiente de produção
  (`DATABASE_URL`, `RESEND_API_KEY` etc.) precisa existir no destino
  alternativo também. A regra 16 aplica-se aqui com força total: nenhum valor
  no repositório, na PR, no ADR ou no runbook — só o nome da variável e o
  comando (`fly secrets set`, `railway variables set`, ou o painel do Coolify)
  que o dono roda manualmente.

## Pontos de integração

- **Vercel REST API** — leitura de métricas de deploy (Fase 3); opcionalmente
  `vercel deploy --prebuilt` para o deploy controlado por release (Fase 4,
  opcional).
- **GitHub REST API (`gh api`)** — leitura de fila/execuções (Fase 3), escrita
  de variável de repositório e abertura de issue quando o limiar estoura
  (Fase 3), consulta de runs no runner próprio (Fase 2, verificação manual).
- **Cloudflare API** — troca de registro DNS no failover (Fase 4); pode ser
  manual (painel) na primeira execução testada, e só automatizada depois de
  o runbook manual estar provado.
- **GHCR** — publicação da imagem versionada (Fase 4).
- **Supabase (`pg_cron`/`pg_net`/Vault)** — hospeda o vigia da Fase 3, se a
  Decisão 3 confirmar a opção A.
- **Resend** — canal de aviso aos 70% (Fase 3), reaproveitando
  `RESEND_API_KEY`/`RESEND_FROM` já configurados.

## Análise de impacto

| Componente | Tipo de impacto | Descrição e risco | Ação exigida |
|---|---|---|---|
| `vercel.json` | modificado | `dev`/`staging` deixam de deployar; arquivo classificado como caminho L2 (`tests/deep-review-level.test.ts`) | revisão profunda completa (G53) na PR de execução da Fase 1 |
| `docs/engineering/deploy.md` | modificado | "Branches que geram deploy" deixa de descrever `dev`/`staging` como automáticos | atualizar tabela e texto da seção DNS/Preview |
| `docs/engineering/promotion.md` | modificado | remove a afirmação de que a promoção gera deploy de `staging` | ajustar "Entrada e prova de CI" e o texto sobre custo de deploy |
| `.github/workflows/ci.yml` | modificado (Fase 2) | nove `runs-on` passam a ler `vars.CI_RUNS_ON`; risco de digitação no JSON da variável quebrar todo o CI | teste estático que valida a expressão e um `workflow_dispatch` de ensaio antes de virar a chave em produção |
| runner self-hosted (novo) | infraestrutura nova | superfície de execução de código de terceiro se a guarda de fork falhar | teste que prova a guarda (F2-03/F2-04) antes de qualquer PR real rodar no runner |
| `docs/operations.md` | modificado (execução, fora desta entrega de planejamento) | runbooks de virar/desligar cada chave | uma linha por chave, com o comando exato |
| tabela `quota_watch` (nova) | schema novo (Fase 3, execução futura) | migração aditiva simples | veredito do detector de `migration-review.ts` deve sair aditivo; se não sair, revisão humana antes de aplicar |
| `Dockerfile` / workflow de publicação (novo) | infraestrutura nova (Fase 4) | imagem publicada em registro público (GHCR do repositório público) não deve conter segredo em nenhuma camada | `docker history`/`dive` no runbook de verificação antes do primeiro uso real |

## Abordagem de testes

Ver [_tests.md](_tests.md) para a matriz completa. Resumo por fase:

- **Fase 1:** testes unitários/estruturais (Vitest lendo `vercel.json` e o
  script de verificação da variável); nenhum E2E novo, porque não há UI
  envolvida.
- **Fase 2:** teste estático que baniria `runs-on` literal fora da expressão;
  teste que prova a guarda de fork sobre o YAML (sem executar o workflow de
  verdade, que exige o runner existir); verificação operacional manual (não
  automatizável em Vitest) de um CI verde completo no runner próprio.
- **Fase 3:** testes unitários da função pura que decide os limiares (70%/90%)
  a partir de uma amostra fake, sem rede real; verificação operacional manual
  de uma corrida do `pg_cron` contra um ambiente de teste.
- **Fase 4:** teste que a imagem builda localmente (`docker build`, gate
  opcional de CI); verificação operacional manual do runbook de DNS completo,
  uma vez, contra o destino alternativo escolhido.

## Sequenciamento de desenvolvimento

### Ordem de build

1. Fase 1 (sem dependência de infraestrutura nova) — sub-issue própria,
   S/M, entregável imediatamente.
2. Fase 2 (depende de a Decisão 2 do PRD estar tomada — precisa saber onde a
   VPS/máquina mora antes de escrever o runbook de registro).
3. Fase 3 (pode começar em paralelo à Fase 2; depende só da Decisão 3).
4. Fase 4 (depende da Decisão 4; pode começar em paralelo às Fases 2/3, mas o
   runbook de "virar a chave sozinho" da Fase 3 só cobre CI/deploy dev-staging,
   não o plano B de produção — a Fase 4 continua manual até o dono decidir
   automatizá-la).

### Dependências técnicas

- Node 24.19, pnpm, Docker (já dependências do E2E local) — reaproveitados
  pela imagem do runner (Fase 2).
- Acesso de escrita a variáveis de repositório (`gh variable set`) — já
  disponível ao agente por delegação (`gh` autorizado, ver memória do
  operador).
- Token de leitura da API da Vercel e PAT do GitHub com escopo mínimo para o
  vigia (Fase 3) — criação e cadastro no Vault são passo humano, como o
  `SENTRY_AUTH_TOKEN` em `deploy.md`.
- Conta no provedor da Decisão 2 (VPS) e da Decisão 4 (destino alternativo) —
  criação e pagamento são decisão e ação do dono, fora do que um agente pode
  fazer.

## Monitoramento e observabilidade

- `quota_watch` (Fase 3) é a fonte de verdade do estado de cota; uma consulta
  manual (`SELECT * FROM quota_watch ORDER BY checked_at DESC LIMIT 10`)
  responde "estamos perto do limite?" sem abrir painel de provedor nenhum.
- Toda ação automática do vigia (virar `CI_RUNS_ON`, preparar plano B) grava
  linha em `quota_watch.action_taken` e abre issue — nunca muda estado em
  silêncio.
- O runbook de cada fase entra em `docs/operations.md` na execução (fora
  desta entrega de planejamento), seguindo o padrão já usado para Resend e
  para a varredura agendada.

## Considerações técnicas

### Decisões-chave

- A variável de repositório é o mecanismo único de virar qualquer chave desta
  entrega — nunca edição de workflow (princípio 1, testado em cada fase).
- `DEPLOY_PREVIEW_ENVS` é um registro verificável, não o mecanismo real
  (que continua sendo `vercel.json`); a verificação cruzada evita que os dois
  divirjam.
- O runner self-hosted é efêmero por padrão — decisão que troca reuso de
  container (mais rápido) por isolamento entre execuções (mais seguro), a
  favor da segurança porque o repositório é público.
- O vigia de cota mora fora dos dois provedores monitorados por construção
  (Decisão 3), não por convenção informal.

### Riscos conhecidos

- **Fork em runner próprio.** É o risco central da Fase 2, documentado com
  fontes externas (ver "Fontes de custo/risco" abaixo): PR de fork
  comprometendo `runs-on: self-hosted` é um vetor real e conhecido em
  repositório público. A mitigação (guarda testada + "Approve and run" do
  GitHub) precisa estar em produção **antes** de qualquer PR de terceiro rodar
  no runner — não depois.
- **Provedor de VPS reajusta ou reduz oferta sem aviso.** Hetzner subiu preço
  até 3,1× em jun/2026; Oracle cortou o Always Free pela metade no mesmo mês,
  também sem aviso público. Nenhuma opção de nuvem de baixo custo é imune a
  isso — a mitigação é a reversibilidade da chave (`CI_RUNS_ON` volta ao
  hospedado), não a imutabilidade do preço.
- **Tensão G36 vs. bind do container** (Fase 4), detalhada acima — pode exigir
  mudança de regra (G62) na execução, não só código.
- **VPS única ainda é ponto único de falha** — mitigado pela reversibilidade,
  não eliminado (ver "Riscos residuais" no PRD).
- **Watchdog não cobre a indisponibilidade do próprio Supabase**, se a
  Decisão 3 confirmar a opção A.

### Fontes de custo/risco consultadas em 28/09/2026

Preços e limites mudam sem aviso; trate os números abaixo como observação
datada (G83), não como cotação vigente no momento da execução:

- Vercel Hobby, limite de 100 deploys/dia — [Vercel Limits](https://vercel.com/docs/limits),
  [comunidade Vercel sobre rate limit](https://community.vercel.com/t/being-rate-limited-on-hobby-for-deployment-limits-but-im-well-under-100/49793).
- Hetzner, reajuste de até 3,1× em jun/2026 e disponibilidade regional
  irregular da linha CX/CAX em set/2026 — [Northflank, "Hetzner cloud server price increases in 2026"](https://northflank.com/blog/hetzner-cloud-server-price-increases),
  [Hetzner Docs, ajuste de preço](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/).
- DigitalOcean, droplets a partir de US$4/mês (512 MB) e US$6/US$12 como piso
  realista — [DigitalOcean Pricing](https://www.digitalocean.com/pricing/droplets).
- Oracle Cloud Always Free, corte de 4 OCPU/24 GB para 2 OCPU/12 GB em
  jun/2026, sem anúncio público, com aviso de término de instância acima do
  novo limite a partir de 18/08/2026 — [Linuxiac](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/),
  [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/).
- Fly.io, `shared-cpu-1x` de ~US$2 a ~US$6/mês, região São Paulo (`gru`)
  confirmada, preço por região desde jul/2026 — [Fly.io Pricing](https://fly.io/pricing/),
  [Fly.io Resource Pricing](https://fly.io/docs/about/pricing/).
- Railway, Hobby US$5/mês, Pro US$20/mês, regiões documentadas em EUA/UE/Ásia,
  sem região sul-americana confirmada — [Railway Docs — Pricing Plans](https://docs.railway.com/pricing/plans).
- Coolify, PaaS open source auto-hospedado sobre VPS própria —
  [repositório coollabsio/coolify](https://github.com/coollabsio/coolify).
- Risco de runner self-hosted em repositório público — [GitHub Docs, Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use),
  [StepSecurity, "Defend Your GitHub Actions CI/CD Environment in Public Repositories"](https://www.stepsecurity.io/blog/defend-your-github-actions-ci-cd-environment-in-public-repositories),
  [discussão da comunidade GitHub #26722](https://github.com/orgs/community/discussions/26722).

## Architecture Decision Records

- [ADR 0030 — Contingência de CI e deploy](../../../docs/adr/0030-contingencia-de-ci-e-deploy.md)
- [ADR 0025 — Varredura fatiada na Vercel, agendada pelo `pg_cron` do Supabase](../../../docs/adr/0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md) (padrão reaproveitado pelo vigia da Fase 3)
- [ADR 0028 — Migração de produção automática, só quando aditiva](../../../docs/adr/0028-migracao-automatica-so-aditiva.md) (a tabela `quota_watch` segue o mesmo detector de aditividade)
