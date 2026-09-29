# ADR 0030 — Contingência de CI e deploy

**Status:** Proposta · 2026-09-28 · issue [#351](https://github.com/andreustimm/master-jobs/issues/351)

## Contexto

O fluxo de entrega depende de dois provedores com cota, e nenhum tem plano B.
Em 22/09/2026 a Vercel Hobby (limite de 100 deploys/dia) recusou novo deploy
com "Deployment rate limited — retry in 24 hours", e produção ficou mais de
24 h sem poder publicar — inclusive a correção de segurança da 1.22.1. A causa
imediata: cada merge em `dev` e cada promoção geram deploy de `dev` **e**
`staging`, dois ambientes sem banco próprio
([deploy.md](../engineering/deploy.md), "Os três ambientes"), então esses
deploys não validam nada que dependa de dado — só consomem cota que a
produção precisava.

O GitHub Actions tem outro risco, hoje sem contingência: fila e limite de
jobs simultâneos, indisponibilidade do serviço, limite de API (`gh`,
`GITHUB_TOKEN`), e uma eventual mudança do repositório para privado, quando os
minutos de runner hospedado passam a ser cobrados.

A resposta ao incidente foi improviso. Esta ADR fixa o que **não** pode
depender de improviso na próxima vez: o mecanismo de virar cada chave, e as
invariantes de segurança que valem independente de qual provedor alternativo
o dono escolher (registrado em
[.compozy/tasks/contingencia-ci-deploy/_prd.md](../../.compozy/tasks/contingencia-ci-deploy/_prd.md#decisões-do-dono)).

## Decisão

1. **Uma variável de repositório é o único mecanismo de virar uma chave.**
   Nunca edição de workflow durante o incidente. Toda chave desta entrega
   (`DEPLOY_PREVIEW_ENVS`, `CI_RUNS_ON`, e a que a Fase 3 vier a usar para o
   plano B) é lida em tempo de execução por uma expressão fixa no YAML; mudar
   o comportamento é `gh variable set`, nunca um commit no arquivo de
   workflow.
2. **O padrão, sem nenhuma variável setada, é sempre o caminho hospedado e
   barato de hoje.** Nenhuma chave desta entrega é ativada por omissão; todas
   são opt-in.
3. **Deploy é decisão, não efeito colateral de merge, enquanto `dev` e
   `staging` não tiverem banco próprio.** `vercel.json` passa a deployar só
   `main`; a promoção `dev → staging` continua existindo como etapa de Git e
   CI (SHA validado, versionamento, PR de produção), sem gerar deploy. Religar
   um ambiente de preview exige a fixture de banco dele já provisionada — a
   variável documentada (`DEPLOY_PREVIEW_ENVS`) não contorna essa
   pré-condição, só registra o estado.
4. **Repositório público com runner self-hosted nunca roda PR de fork.** É um
   vetor conhecido de execução de código de terceiro contra infraestrutura
   própria (runner comprometido por um `runs-on: self-hosted` injetado numa PR
   maliciosa). A guarda — `github.event.pull_request.head.repo.full_name ==
   github.repository` ou um gate equivalente — é parte do primeiro commit que
   liga o runner, testada antes de qualquer PR de terceiro real chegar a
   rodar nele, e nunca é uma camada opcional. A exigência de aprovação humana
   para workflow de fork ("Approve and run", já ativa no repositório)
   continua ligada como segunda barreira, não substituída pela guarda.
5. **O runner self-hosted, quando existir, é efêmero.** Um container por job,
   destruído ao fim. Um job comprometido não deixa estado para o próximo.
6. **O vigia de cota mora fora dos provedores que ele monitora.** Um watchdog
   hospedado no mesmo provedor que caiu não consegue reagir — por isso ele
   roda em Supabase (`pg_cron`/`pg_net`, reaproveitando o padrão da
   [ADR 0025](0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md)) ou
   em outro serviço fora de Vercel e GitHub, nunca numa VPS que também
   hospeda o próprio runner monitorado por essa mesma issue.
7. **Toda ação automática do vigia é reversível pelo mesmo mecanismo da
   decisão 1, e é registrada.** Virar uma chave sozinho ao estourar 90% (ou
   detectar indisponibilidade) sempre grava o que mudou e o comando exato de
   reversão, e sempre abre issue — nunca muda estado em silêncio.
8. **Segredo de produção nunca vira valor em texto versionado por causa desta
   entrega.** O plano B de deploy (Fase 4) replica variável por variável no
   destino alternativo; documentação, PR, ADR e runbook citam só o nome da
   variável (regra 16), nunca o valor, mesmo ao descrever o processo de
   cadastro manual.

As escolhas de **onde** (runner próprio: máquina do dono vs. VPS; vigia:
Supabase vs. outro; destino alternativo: Fly.io vs. Railway vs. VPS+Coolify)
são registradas como pendentes no PRD e não fazem parte desta decisão — elas
podem mudar sem reabrir esta ADR, desde que continuem satisfazendo as oito
invariantes acima.

## Consequências

- **Boas.** Um incidente de cota da Vercel ou de fila do Actions deixa de
  exigir decisão improvisada: a resposta é um comando documentado, testado
  antes de o incidente acontecer. O corte do deploy de `dev`/`staging`
  (decisão 3) já elimina a causa concreta do incidente de 22/09, antes de
  qualquer infraestrutura nova existir.
- **Custo operacional novo.** Um runner self-hosted e um watchdog são
  superfícies que passam a existir e a precisar de manutenção (patch,
  rotação de credencial, monitoramento do próprio monitor) — trabalho que
  antes não existia porque tudo era hospedado e gerenciado por terceiro.
- **Risco residual aceito.** Uma única VPS de runner (ou de plano B) continua
  sendo um ponto de falha, um nível abaixo do problema original; a mitigação
  é a reversibilidade da chave, não a eliminação do risco. Ver "Riscos
  residuais" no PRD.
- **Tensão G36 resolvida na execução da Fase 4.** A regra 12/G36 (scripts
  locais só fazem bind em `127.0.0.1`) continua intacta para `pnpm
  dev`/`pnpm start`; a exceção do contêiner do plano B (`ENV
  HOSTNAME=0.0.0.0`) mora só dentro da imagem (`Dockerfile`), nunca num
  script de `package.json`. `AGENTS.md` e `security.md` foram atualizados no
  mesmo commit (G62). Detalhe em
  [deploy.md](../engineering/deploy.md#plano-b-flyio-como-destino-alternativo-fase-4-da-contingência).
- **Declaração de ambiente exigida fora da Vercel.** `isLocalProcess()`
  (`src/contexts/auth/domain/open-mode.ts`) só reconhece "produção" quando o
  processo se declara — `VERCEL`/`VERCEL_ENV` na Vercel, `JHO_ENV` em
  qualquer outro destino. Sem essa declaração, o plano B seria tratado como a
  máquina do dono: modo aberto liberado, link de recuperação de senha
  impresso no log (G18), varredura recusada. `fly.toml` **e** `Dockerfile`
  fixam `JHO_ENV=production` por isso (defesa em profundidade). Achado na
  revisão da execução (PR #373), não previsto neste ADR original.
- **O `Host` da requisição nunca monta o link de recuperação de senha, em
  nenhum deployment.** Achado também na revisão da PR #373: o link
  (`app/login/forgot/actions.ts`) usava o cabeçalho `Host` do cliente para
  montar a URL — atrás de qualquer proxy, isso é host poisoning (G17/G18). A
  correção (`src/contexts/auth/domain/public-origin.ts`) resolve, em ordem,
  `JHO_PUBLIC_URL` (se cadastrada), depois — **só na Vercel, sem cadastro
  nenhum** — `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL` (variáveis de
  sistema da própria plataforma), depois o `Host` só na máquina do dono. O
  plano B no Fly não tem equivalente às variáveis da Vercel, por isso
  `JHO_PUBLIC_URL` já vem fixada em `fly.toml`; sem alguma das três, falha
  fechado. Nenhum passo manual na Vercel é necessário — ver
  [deploy.md](../engineering/deploy.md#variáveis).

## Alternativas rejeitadas

- **Aumentar o plano da Vercel em vez de cortar deploys de preview.**
  Resolveria a cota, não o desperdício: `dev` e `staging` continuariam
  deployando sem banco próprio, então o gasto sem validação real persistiria,
  só com um teto maior. Fica descartado enquanto esses dois ambientes não
  tiverem fixture de banco.
- **Migrar de provedor principal agora.** Fora do escopo declarado pela issue
  — troca de fundação é decisão maior que uma contingência, e feita sob
  pressão de incidente tende a ser pior decisão do que feita com tempo.
- **Hospedar o vigia de cota na própria Vercel (função agendada) ou no
  próprio GitHub Actions.** Contradiz o motivo de o vigia existir: um watchdog
  que cai junto com o que ele monitora não avisa nada.
- **Runner hospedado maior (GitHub-hosted runners de mais CPU) em vez de
  self-hosted.** Resolve performance, não o problema desta issue — continua
  sendo o mesmo provedor único, sem contingência para fila, API ou mudança de
  visibilidade do repositório.
- **Deixar o runner self-hosted não efêmero, para reduzir o tempo de setup por
  job.** Rejeitado porque o repositório é público: um job comprometido
  deixaria estado (credencial em cache, processo em segundo plano) disponível
  para o próximo job legítimo.
