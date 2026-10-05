[Índice](README.md)

---

# Implantar na Vercel com PostgreSQL/Supabase

O runtime atual exige PostgreSQL explícito: `src/core/db/client.ts` lê
`DATABASE_URL`, e `src/core/db/migrate.ts` usa `DATABASE_MIGRATION_URL` para
migrations. Não há fallback para SQLite/Turso. O snapshot SQLite legado só pode
ser lido pelo harness de seleção/importação revisado em
`scripts/migration/`; ele não é uma base de runtime.

O procedimento Turso que existia antes do corte está preservado apenas como
contexto histórico no [incidente de cota](../operations/turso-quota-incident-2026-09-03.md).

## O que muda ao sair do laptop

Este sistema foi escrito para rodar em `127.0.0.1`, com um banco em arquivo e
um operador só. Nada disso é acidental — está nas ADRs 0002 e 0009 — e três
coisas deixam de valer num ambiente serverless.

### 1. O limite de requisição vira por instância

`createRateLimiter` guarda os contadores na memória do processo. Na Vercel cada
invocação pode cair numa instância diferente, então o limite de 30 requisições
em 5 minutos passa a valer **por instância**, não por visitante.

Não é ruína: continua encarecendo a varredura, porque um varredor sequencial
tende a reusar a mesma instância quente. Mas deixa de ser garantia. Se o
portfólio público virar alvo real, o limite precisa sair para um armazenamento
compartilhado — e aí a ADR 0009 se inverte, porque o motivo dela (processo
único, banco local) deixou de existir.

### 2. O robô de captura e a reconferência não têm onde rodar

`jho scrape run` e `jho jobs recheck run` são comandos de terminal que rodam por
minutos. Uma função serverless tem teto de duração, e o de 30 segundos declarado
no `vercel.json` não é generoso — é o máximo do plano gratuito.

A escolha feita ([ADR 0025](../adr/0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md)):
**o trabalho é fatiado.** `/api/cron/varredura?fatia=…` faz, por chamada, o que
cabe em 20 s — algumas fontes do sync, uma onda de capturas, um lote de
reconferência, as capturas por termo, a nota dos candidatos devidos — e o
`pg_cron` do Supabase a chama a cada poucos minutos. Reserva por fonte e por
candidato (`sweep_lease`) impede que duas chamadas sobrepostas façam o mesmo
trabalho. O GitHub Actions (`varredura.yml`) continua como rede de segurança;
localmente, os comandos `jho` de sempre rodam contra a instância Docker.

A Vercel continua sem cron próprio em `vercel.json` (1×/dia no Hobby não serve).
`/api/cron/recheck` segue para chamada manual. Há sempre **um** agendador da
reconferência ativo: o `pg_cron`, ou o Actions até a troca —
`tests/workflow-environment-isolation.test.ts` confere as duas pontas.

### 3. `profile.yaml` e `sources.yaml` são lidos do disco em runtime

`loadProfile()` e `loadSourcesConfig()` fazem `readFile` sobre `process.cwd()`.
Os dois arquivos estão versionados e entram no pacote, mas o Turbopack avisa que
o acesso dinâmico ao sistema de arquivos "causa o rastreamento do projeto
inteiro" — é como eles acabam incluídos, e é frágil.

`JHO_PROFILE_PATH` e `JHO_SOURCES_PATH` existem e permitem apontar para outro
lugar. Enquanto os dois arquivos forem versionados, o padrão funciona. A rota
da varredura fatiada não depende da sorte: `next.config.ts` inclui
`config/sources.yaml` explicitamente no pacote de `/api/cron/varredura`.

## Variáveis

| Variável | Onde | Para quê |
|---|---|---|
| `DATABASE_URL` | aplicação | URL PostgreSQL de runtime, de **role restrita** ([como criar](#dar-login-à-role-de-runtime)); vence as demais |
| `POSTGRES_URL` | Vercel (integração) | usada no runtime quando não há `DATABASE_URL` — conecta como **superusuário**, então é rede de segurança e não destino |
| `DATABASE_MIGRATION_URL` | migration/CI | URL PostgreSQL com privilégio de DDL |
| `POSTGRES_URL_NON_POOLING` | Vercel (integração) | usada na migration quando não há a de cima |
| `DATABASE_CA_CERT` | CI/Vercel | o PEM da CA **ou** o caminho de um arquivo |
| `SUPABASE_CRAWL_ENABLED` | Actions produção | `true` somente após os gates de quota/retensão |
| `RESEND_API_KEY` | Vercel | e-mail transacional; sem ela ou sem `RESEND_FROM`, nada é enviado e o log só alerta |
| `RESEND_FROM` | Vercel | remetente de domínio verificado |
| `CRON_SECRET` | Vercel **e** Supabase Vault (`jho_cron_secret`) | protege toda rota de `/api/cron/` (`authorization: Bearer <segredo>`); o `pg_cron` o lê do Vault para chamar `/api/cron/varredura`. Os dois valores precisam ser iguais |
| `JHO_SOURCE_ALLOWLIST` | Vercel produção **e** Actions | declaração exigida pela política de ingestão (ADR 0021); sem ela as fatias de rede respondem 503 |
| `VARREDURA_AGENDADOR` | variável de repositório (Actions) | `supabase` depois da troca de agendador: o disparo agendado de `varredura.yml` deixa de rodar ([ADR 0025](../adr/0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md)) |
| `SENTRY_DSN` | Vercel | relato de erro do servidor; **sem ela nada é enviado** ([detalhe](#relato-de-erro)) |
| `SENTRY_TRACES_SAMPLE_RATE` | Vercel (opcional) | fração de requisições com trace; ausente = `0.1`, `0` ou valor ilegível desliga ([detalhe](#tracing)) |
| `SENTRY_AUTH_TOKEN` | Vercel, **só build** | publica os mapas de origem do servidor; sem ela o build segue sem mapas ([detalhe](#mapas-de-origem)) |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Vercel (opcional) | padrão `master-timm` / `master-jobs` |
| `JHO_STORAGE_DRIVER` | Vercel (Preview **e** Production) | `vercel-blob` em deployment; `s3` para MinIO local ou AWS S3. Ausente = sem upload de foto e capa; valor desconhecido falha fechado ([ADR 0029](../adr/0029-armazenamento-de-objetos-formato-s3.md)) |
| `BLOB_READ_WRITE_TOKEN` | Vercel (Preview **e** Production), criada pela integração do Blob | credencial do Vercel Blob; o adapter grava sempre privado e apaga o valor de todo erro. Nunca em banco, log ou `.env.example` |
| `JHO_STORAGE_BUCKET` | Vercel (opcional) | prefixo dos objetos no Blob (bucket no S3); padrão `master-jobs` |
| `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | local (MinIO) ou futuro AWS S3 | só com `JHO_STORAGE_DRIVER=s3`; `S3_ENDPOINT` ausente é a AWS ([local-storage.md](local-storage.md)) |
| `JHO_ENV` | todo deployment (Vercel Production `production`, Preview `preview`; plano B no Fly em `fly.toml` **e** `Dockerfile`); na máquina do dono, `local` | declara o ambiente para `isLocalProcess()` (`src/contexts/auth/domain/open-mode.ts`) e para a guarda de ingestão (`src/core/ingest/guard.ts`). Só `JHO_ENV=local` (sem `VERCEL`/`VERCEL_ENV`) conta como máquina do dono — o sinal é positivo (G27, #378): ausente ou vazia, o processo **não** é local, então o modo aberto é recusado, o mailer omite o link (G18), `resolvePublicOrigin` não usa o `Host` (G17) e a varredura recusa. `pnpm dev` declara `JHO_ENV=local` sozinho (`scripts/dev.ts`) só quando nem o shell nem os `.env*` que o Next carrega em dev a declaram — um `JHO_ENV` do `.env` vence; `pnpm jho` e `pnpm start` locais leem do `.env` e precisam da linha lá para o modo aberto e o mailer de terminal |
| `JHO_PUBLIC_URL` | **só em Production** na Vercel; obrigatória no plano B no Fly (já fixada em `fly.toml`) | origem confiável (`https://host`) para o link de recuperação de senha (`src/contexts/auth/domain/public-origin.ts`), nunca o `Host` da requisição (G17/G18, host poisoning). **Na Vercel Production não precisa ser cadastrada**: sem ela, a função usa `VERCEL_PROJECT_PRODUCTION_URL` — variável de sistema da própria plataforma, não controlada pelo cliente. `VERCEL_PROJECT_PRODUCTION_URL` deve resolver para `jobs.mastertimm.com.br` (o domínio próprio tem precedência sobre o `*.vercel.app` gerado, quando o projeto tem um domínio de produção configurado) — confirmar isso é o item novo do checklist pós-deploy, abaixo. Cadastrar `JHO_PUBLIC_URL=https://jobs.mastertimm.com.br` em Production elimina a dúvida por completo, sem depender de nenhuma variável de sistema. **Nunca cadastrar em Preview**: um valor fixo enviaria o token de recuperação de qualquer branch de preview para o domínio de produção — Preview precisa continuar resolvendo por `VERCEL_BRANCH_URL`/`VERCEL_URL` (variáveis por branch/deployment). Fora da Vercel e da máquina do dono (o plano B no Fly), a ausência falha fechado |

**Dependência silenciosa: "Automatically expose System Environment
Variables".** A documentação da Vercel condiciona o acesso, em runtime de
função (não só no build), às variáveis de sistema — `VERCEL_ENV`,
`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_BRANCH_URL`, `VERCEL_URL` — a essa
opção estar ligada em **Project Settings → Environment Variables**. Vem
ligada por padrão em projeto novo, mas é uma configuração, não uma garantia
imutável da plataforma — projeto migrado ou reconfigurado pode tê-la
desligado sem ninguém notar. **Não verificado nesta entrega** exatamente
quais variáveis sobrevivem com a opção desligada (documentação da Vercel e
comportamento real podem divergir).

**O efeito é falha fechada, de disponibilidade e não de segurança.** Se
`VERCEL` e `VERCEL_ENV` não chegarem ao runtime, `isLocalProcess()`
(`src/contexts/auth/domain/open-mode.ts`) **não** trata o processo como a
máquina do dono: ela exige o sinal positivo `JHO_ENV=local` e nega por
omissão (issue [#378](https://github.com/andreustimm/master-jobs/issues/378);
até ela, a ausência de variáveis contava como "local", e esse cenário
reabria o modo aberto, o link no log e o `Host` do cliente como origem). O
que sobra é disponibilidade: sem `JHO_PUBLIC_URL` nem as variáveis de host
da Vercel, `resolvePublicOrigin` devolve `null` e a recuperação de senha
grava `reset_send_failed` em vez de enviar. A configuração que evita isso,
cadastrada explicitamente na Vercel, **com valores diferentes por
ambiente**:

- **Production:** `JHO_ENV=production` e
  `JHO_PUBLIC_URL=https://jobs.mastertimm.com.br`.
- **Preview:** `JHO_ENV=preview` — nunca `production`, porque a mesma
  variável também é lida pela guarda de ingestão
  (`src/core/ingest/guard.ts`), e `production` ali liberaria a varredura real
  contra fontes externas num ambiente que só deveria exercitar fixtures
  (ADR 0021); `preview` nega ingestão do mesmo jeito que `dev`/`staging`, sem
  depender de `JHO_SOURCE_ALLOWLIST` estar ausente por acaso. **Nunca**
  `JHO_PUBLIC_URL` em Preview — ver a tabela acima.

Isso elimina a dependência da opção em Production por completo. Em Preview,
a recuperação de senha continua dependendo de `VERCEL_BRANCH_URL`/`VERCEL_URL`
chegarem ao runtime — sem elas, falha fechado; um `JHO_PUBLIC_URL` fixo ali
seria pior, não melhor (ver a tabela acima). `JHO_ENV` nos dois ambientes
continua valendo pela guarda de ingestão e como declaração explícita, mas a
segurança do modo aberto, do mailer e da origem já não depende dela.

**A URL pode vir de mais de um nome, e a ordem é declarada.** A integração do
Supabase com a Vercel cadastra `POSTGRES_URL` e `POSTGRES_URL_NON_POOLING` e as
**mantém** — rotação de senha acontece do lado do provedor e chega sozinha.
Exigir que alguém copiasse aquele valor para uma `DATABASE_URL` genérica criaria
duas fontes da verdade que divergem no dia da rotação, e o sintoma apareceria
como produção fora do ar. Então os nomes com prefixo valem, nesta ordem:

| Papel | Ordem de resolução |
|---|---|
| runtime | `DATABASE_URL` → `POSTGRES_URL` → `POSTGRES_URL_NON_POOLING` |
| migration | `DATABASE_MIGRATION_URL` → `POSTGRES_URL_NON_POOLING` → `POSTGRES_URL` |

A diferença entre as duas listas não é enfeite: DDL não deve atravessar o pooler
em modo transação, e o runtime serverless quer justamente o pooler.
`DATABASE_URL` vence as duas porque é ela que o ambiente local, o Docker e o CI
configuram explicitamente. Variável em branco conta como ausente, e o erro de
configuração **nomeia a variável** de onde a URL veio — nunca o valor.

**Query string:** parâmetros de pool (`pgbouncer`, `connection_limit`) são
descartados, porque a configuração do cliente já é explícita. `sslmode` passa
por **lista de permissão**: `require`, `verify-ca` e `verify-full` pedem o mesmo
ou mais do que o cliente já impõe e são aceitos — é a forma que a integração do
Supabase com a Vercel cadastra em `POSTGRES_URL` (`?sslmode=require`), e
recusá-la derrubou a 1.13.1 por 28 minutos. Qualquer outro valor (`disable`,
`allow`, `prefer`, um valor inventado) e os demais parâmetros de TLS (`ssl`,
`sslrootcert`, `sslcert`…) são **recusados** com erro que nomeia a variável, e
não apagados em silêncio: a política de TLS é do cliente, e apagar
`sslmode=disable` deixaria quem escreveu convencido de que desligou a
verificação. Quando aceito, o parâmetro sai da URL antes de chegar ao driver.
Contrato em `src/core/db/config.ts`, provado por
`tests/db-config-diagnostics.test.ts` com a URL na forma que o provedor cadastra.

**`DATABASE_CA_CERT` aceita as duas formas:** o PEM colado direto na variável
(o gesto natural num painel serverless, onde não há onde pôr arquivo) ou o
caminho de um arquivo. O repositório versiona `config/certs/supabase-ca.crt` e o
`next.config.ts` o declara em `outputFileTracingIncludes` para ele viajar no
bundle. Valor que não é nenhum dos dois falha nomeando a variável.

`RESEND_API_KEY` e `RESEND_FROM` formam um par: se qualquer uma estiver ausente
ou vazia, nenhum e-mail é enviado. Onde o link vai parar depende de quem lê o
log: sem chave nenhuma, num processo que se declara local (`JHO_ENV=local`,
sem `VERCEL` nem `VERCEL_ENV`), `configuredMailer` usa o adapter de console,
que imprime o e-mail inteiro no terminal de quem opera. Em qualquer outro caso
— deployment na Vercel, `JHO_ENV` diferente de `local` **ou ausente**, ou
chave presente com o remetente faltando — usa `withheldMailer`, que registra um alerta **sem** destinatário, assunto nem link —
o link de recuperação é credencial, e o log das funções é lido por outras
pessoas. O pedido de recuperação continua respondendo igual para quem pede, e o
`auth_event` grava `reset_send_failed`. A regra de "processo local" é a mesma
do modo aberto (`isLocalProcess`, em `src/contexts/auth/domain/open-mode.ts`). Checklist de ativação em
[`docs/operations.md`](../operations.md#ativar-o-e-mail-de-recuperação-resend).
O operador cria a chave no Resend, verifica o domínio e cadastra os dois valores
diretamente no ambiente da Vercel. Os valores reais não devem ser copiados para
`.env.example`, documentação, logs ou commits.

**Foto e capa do perfil público (#327) precisam de armazenamento.** Sem
`JHO_STORAGE_DRIVER`, o deployment funciona igual, mas `/candidate` responde
que o envio de imagens não está configurado e `/p/` sai sem foto. **Passo do
dono**, uma vez, antes de a funcionalidade chegar a produção:

1. No painel da Vercel, projeto master-jobs → **Storage** → criar um **Blob
   store** com acesso **Private** e conectá-lo ao projeto nos ambientes
   **Preview** e **Production**. Público não serve: o adapter grava com
   `access: "private"`, e numa loja pública a URL do objeto ficaria legível
   por quem a tivesse, mesmo depois de o perfil deixar de ser público.
   A integração cadastra `BLOB_READ_WRITE_TOKEN` nos ambientes marcados —
   confira em **Settings → Environment Variables**; se não aparecer, copie o
   token de leitura e escrita da página do Blob store e cadastre-o com esse
   nome, como **Sensitive**, direto no painel. Não copie o valor para outro
   lugar.
2. Em **Settings → Environment Variables**, cadastrar `JHO_STORAGE_DRIVER` =
   `vercel-blob` em **Preview** e **Production**.
3. Provar com **envio real num deployment de Preview**, antes de produção
   (variável nova só vale no próximo build). Desde a Fase 1 da contingência
   de CI e deploy ([#351](https://github.com/andreustimm/master-jobs/issues/351)),
   push em `dev`/`staging` não cria deployment automático — publique um
   Preview avulso do SHA atual pela CLI da Vercel, autenticado no projeto
   `master-jobs` (`vercel deploy`, sem `--prod`; usa as variáveis do
   ambiente **Preview**, as mesmas cadastradas no passo 2):
   - foto de **~3,9 MB** (JPEG ou PNG): aceita, a prévia aparece e
     sobrevive ao reload;
   - arquivo de **~4,8 MB**: recusado com "A imagem passa de 4 MB." sem
     gravar nada. O teto é 4 MiB porque a Vercel recusa corpo acima de 4,5 MB
     com 413 antes de a action rodar; o seletor de arquivo avisa no
     navegador, e se o aviso não aparecer a tela mostra o erro genérico —
     anote e reporte;
   - com "Mostrar" marcado e o perfil Público, `/p/<endereço>` numa janela
     anônima mostra a foto; em **Storage → o Blob store**, o objeto aparece
     como privado e a URL dele, aberta sem token, não serve a imagem.

O token dá leitura e escrita na loja inteira: é segredo como a URL do banco.
Os objetos são gravados privados; ninguém os lê por URL do Blob, só pela rota
do app, que reconfere a visibilidade do perfil. Local e AWS S3 em
[local-storage.md](local-storage.md).

O suporte ao Gmail também está completo no código, mas a ativação pertence ao
operador: criar `GMAIL_CLIENT_ID` e `GMAIL_CLIENT_SECRET` no Google Cloud,
configurá-los fora do Git e executar `jho mail auth`. O escopo solicitado é
somente `gmail.readonly`; a ausência dessas credenciais não desativa a importação
manual de `.eml`.

**`JHO_AUTH_MODE` não deve existir em produção.** Com `open`, o sistema sintetiza
uma sessão e serve currículo, funil e export para qualquer requisição. É modo de
desenvolvimento local e num endereço público é o vazamento inteiro. Desde #197 o
código também recusa: o pedido só vale num processo que se declara local
(`JHO_ENV=local`, sem `VERCEL` nem `VERCEL_ENV`); em qualquer outro — inclusive
o que não declara ambiente nenhum (#378) — é ignorado, o login continua exigido
e o servidor registra uma vez no log `[auth] JHO_AUTH_MODE=open ignorado` com a
instrução de declarar `JHO_ENV=local` — ver
`src/contexts/auth/domain/open-mode.ts`.

## Os três ambientes

Um banco por ambiente. O de produção é o projeto Supabase `master-jobs` em
`sa-east-1` (São Paulo), e as funções da Vercel ficam em `gru1`, a região
vizinha: cada ida ao banco é um round-trip, e a tela do quadro fazia de dez a
doze por requisição (hoje de oito a dez, com bem menos esperas em série). Com a
função em `iad1` (Virgínia), cada uma cruzava o continente.

`tests/function-region.test.ts` trava o par: o host do pooler de produção
(`production-target.ts`) tem de mapear para a região de `vercel.json`. Trocar
um sem o outro reprova a suíte. Para conferir em produção, o cabeçalho
`x-vercel-id` deve dizer `<borda>::gru1::…` — o primeiro trecho é a borda de
quem pediu, só o segundo é a região da função. `<borda>::iad1::…` é a função no
lugar errado.

| Branch | Endereço | Banco | Ambiente Vercel | Deploy automático |
|---|---|---|---|---|
| `main` | `jobs.mastertimm.com.br` | Supabase produção (`production`) | Production | sim |
| `staging` | `jobs-staging.mastertimm.com.br` | fixture PostgreSQL isolada (provisionamento pendente) | Preview | não (Fase 1 da [#351](https://github.com/andreustimm/master-jobs/issues/351)) |
| `dev` | `jobs-dev.mastertimm.com.br` | fixture PostgreSQL isolada (provisionamento pendente) | Preview | não (Fase 1 da [#351](https://github.com/andreustimm/master-jobs/issues/351)) |
| — | local | PostgreSQL Docker isolado (`127.0.0.1:5432`) | Development | — |

Os três compartilham o schema; só o de produção carrega dado real. `dev` e
`staging` nascem vazios de propósito: copiar produção para lá levaria junto
`auth_user`, `auth_session` e `auth_login_token` — credenciais de gente de
verdade num ambiente com menos cuidado. Para popular um deles, aponte o script
para a URL correspondente e escolha à mão o que copiar.

`staging` e `dev` não recebem a URL, o certificado ou os secrets de produção.
Enquanto as fixtures remotas não forem provisionadas, esses deployments ficam
sem ingestão externa e usam somente dados sintéticos versionados. Um eventual
ambiente compartilhado precisa de uma ADR própria sobre quota, roles,
`search_path` e migrations; criar schemas no projeto de produção não é um
atalho seguro.

### Branches que geram deploy

**Somente `main` gera deployment automático.** A lista de permissão fica em
`git.deploymentEnabled` no `vercel.json`: `**: false` cobre branches de tarefa
(inclusive com `/`), e `dev`/`staging` são `false` desde a Fase 1 do
[ADR 0030](../adr/0030-contingencia-de-ci-e-deploy.md) ([#351](https://github.com/andreustimm/master-jobs/issues/351)).
Branches de tarefa e suas PRs executam o CI do GitHub, sem preview próprio —
e, agora, `dev` e `staging` também não recebem preview a cada push, porque os
dois ambientes não têm banco próprio ([Os três ambientes](#os-três-ambientes)):
cada deploy deles não validava nada que dependesse de dado, só consumia cota.

**Causa do corte:** em 22/09/2026 o limite de 100 deploys/dia da Vercel Hobby
recusou novo deploy com "Deployment rate limited — retry in 24 hours", e
produção ficou mais de 24 h sem poder publicar — inclusive a correção de
segurança da 1.22.1. Cada merge em `dev` e cada promoção geravam deploy de
`dev` **e** `staging` além do de `main` quando aplicável; cortar os dois
elimina a causa concreta do incidente.

**Religar um ambiente de preview** exige a fixture de banco dele já
provisionada (fora do escopo desta entrega) — a variável de repositório
`DEPLOY_PREVIEW_ENVS` não contorna essa pré-condição, só é o registro
documentado e verificável de qual ambiente está religado, para que exista "um
lugar só" a editar em vez de abrir `vercel.json` à mão:

- **Formato:** lista separada por vírgula, subconjunto de `dev,staging`
  (nunca `main`, que é sempre `true` e não depende da variável). Vazia ou
  ausente = só `main` deploya (o estado desta entrega). Exemplos válidos:
  `""`, `"dev"`, `"dev,staging"`.
- **Contrato executável:**
  [`scripts/github/verify-deploy-preview-envs.ts`](../../scripts/github/verify-deploy-preview-envs.ts)
  compara a variável ao `git.deploymentEnabled` publicado na **ponta de
  `main`, `dev` e `staging`** (API de conteúdo do GitHub, não o checkout
  local — a Vercel aplica o arquivo do commit de cada branch). Em cada
  branch, confere só o que decide o deploy **daquela** branch: a própria
  chave (`dev` no arquivo de `dev`, `staging` no de `staging`…), `**`
  (sempre `false`) e chave fora da lista de permissão
  `{"**", "main", "dev", "staging"}` (ex.: um padrão `"release/*"`
  esquecido no arquivo) — nunca o mapa inteiro: durante o runbook de religar,
  o arquivo de `dev` pode já ter `dev: true` enquanto o de `main` ainda não
  mesclou a mudança, e isso não afeta o deploy de `main` (a Vercel decide
  pela própria entrada da branch, nunca pela entrada de outra). Diverge em
  qualquer branch, sai com código 1. `GITHUB_TOKEN` não lê a API de
  variáveis de repositório (403, mesmo com `actions: read`) — só a leitura
  do `vercel.json` de cada branch usa `gh api`/`GITHUB_TOKEN` (via
  `contents: read`); a variável em si chega pronta pelo `vars.…` do workflow
  dedicado
  ([`verificar-deploy-preview-envs.yml`](../../.github/workflows/verificar-deploy-preview-envs.yml),
  disparado no push que toca `vercel.json` em `main`, `dev` ou `staging` —
  detecção quase imediata — mais um agendamento diário como rede de
  segurança; fora de "Governança em produção" para não misturar uma
  divergência de configuração com o sinal de disponibilidade da sonda
  `medir`) ou por `gh api` no uso manual, com a credencial de quem roda:

  ```bash
  rtk node scripts/github/verify-deploy-preview-envs.ts
  ```
- **Runbook de religar** um ambiente, quando a fixture existir: 1) confirmar a
  fixture do ambiente provisionada; 2) abrir PR para `dev` com `vercel.json`
  alterando `"dev": true` (regra 18/G43 — nunca commit direto em `dev`); 3)
  ao mesclar, `gh variable set DEPLOY_PREVIEW_ENVS --body "dev"`; 4) rodar o
  verificador; 5) confirmar o primeiro deploy de `dev` na Vercel.
- **Runbook de desligar de novo:** 1) abrir PR para `dev` com `vercel.json`
  voltando `"dev": false` (regra 18/G43 — nunca commit direto); 2) ao
  mesclar, `gh variable delete DEPLOY_PREVIEW_ENVS` (ou, com mais de um
  ambiente religado, `gh variable set DEPLOY_PREVIEW_ENVS --body "staging"`,
  sem `dev` na lista); 3) rodar o verificador; 4) confirmar no painel da
  Vercel que o próximo push em `dev` não gera deployment.

**Commit que não muda o site não gera deploy**, mesmo em `main`. O plano
Hobby limita os deploys por dia; `ignoreCommand` roda
`scripts/vercel-ignore-build.sh`, que pula o build quando todos os arquivos
alterados (desde `VERCEL_GIT_PREVIOUS_SHA`, ou o commit anterior) estão em
`docs/`, `.compozy/`, `tests/`, `.github/`, `.claude/` ou são `.md` avulsos.
`CHANGELOG.md` e `USER_CHANGELOG.*.md` constroem, porque a tela Novidades é
compilada deles; arquivo desconhecido também constrói — errar para "pular"
publicaria código velho.

A promoção `dev → staging` continua existindo como etapa de Git e CI (SHA
validado, versionamento, PR de produção — [promotion.md](promotion.md)), só
sem gerar deploy nenhum: `staging` e `dev` continuam no ambiente **Preview**
da Vercel, apenas desligado por `git.deploymentEnabled`. O nome do ambiente
nunca significou que toda PR recebe um deployment.

A Vercel [aplica a regra por branch e dá precedência a uma correspondência
`true`](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled).
Produção continua dependendo só do merge humano em `main`. A restrição vale
para a integração Git; na CLI ou API, o operador deve selecionar o ambiente
explicitamente.

Um status antigo de limite de deployments não é apagado pela mudança: depois
da liberação da cota, retome o deployment do commit vigente no ambiente
afetado e confira o resultado na Vercel e na PR.

### Novidades preparadas no build

`pnpm build` prepara o service worker e executa `pnpm changelog:build` antes
do Next. O gerador lê `USER_CHANGELOG.pt-BR.md`, `USER_CHANGELOG.en.md` e
`CHANGELOG.md`, e grava metadados e HTML sanitizado em
`src/generated/changelog.ts`, ignorado pelo Git. Cada build usa o histórico
daquele checkout, inclusive em rollback. Um arquivo de origem ausente
interrompe a geração.

O `CHANGELOG.md` técnico entra só pela lista de versões publicadas: toda versão
sem nota de usuário — marcada com `sem-nota-usuario` ou anterior ao marcador —
aparece no modal como "Melhorias internas, sem mudança visível." (texto do
dicionário i18n), com a data do marcador ou, na falta dele, a do cabeçalho
técnico. O texto técnico nunca chega ao artefato. Versão com nota de usuário
malformada não vira "interna": continua fora, com o diagnóstico do gerador.

O rodapé importa o módulo no servidor e envia apenas o idioma ativo a quem
tem sessão válida. Os Markdown e o renderer não são dependências de runtime
das novidades, nem arquivos públicos. No desenvolvimento, `pnpm dev` também
gera o artefato; após editar as notas, rode `pnpm changelog:build` ou reinicie.
Quem invocar `next build` diretamente precisa executar o gerador antes,
assim como o runner E2E isolado faz. Ver [ADR 0022](../adr/0022-novidades-compiladas-no-build.md).

### DNS

Os três são `CNAME` para `cname.vercel-dns.com` na Cloudflare, **sem proxy**
(nuvem cinza). Com a nuvem laranja ligada a Vercel não consegue emitir o
certificado, e o resultado são dois CDNs em série sem ninguém ganhar nada.

### Quem enxerga o quê

A proteção de deployment da Vercel está em `all_except_custom_domains`. Ela
isenta **apenas o domínio de produção**: `jobs.mastertimm.com.br` responde a
qualquer visitante, e é o que o portfólio público (`/p/…`) e o manifest da PWA
exigem.

`jobs-dev` e `jobs-staging` continuam atrás do SSO da Vercel, e isso é
deliberado — ambiente de teste com dado de teste não precisa de plateia. Para
abri-los seria preciso desligar a proteção do projeto inteiro, o que tornaria
públicas também as URLs diretas dos deployments de teste.

## Plano B: Fly.io como destino alternativo (Fase 4 da contingência)

A Vercel continua o destino padrão. O que segue existe só para o incidente em
que ela recusa deploy ou fica fora do ar por tempo maior do que a espera é
razoável ([issue #369](https://github.com/andreustimm/master-jobs/issues/369),
Fase 4 de [#351](https://github.com/andreustimm/master-jobs/issues/351),
[ADR 0030](../adr/0030-contingencia-de-ci-e-deploy.md)). Nenhuma peça daqui
roda automaticamente: publicar a imagem e implantá-la são passo manual do
dono, sempre.

**Artefatos.** `Dockerfile` (multi-stage: `deps` → `builder` roda `pnpm
build`, que já produz `output: "standalone"` — `next.config.ts` — → `runner`
copia só `.next/standalone`, `.next/static` e `public/`, e roda como o usuário
`nextjs`, uid 1101, nunca root). `.dockerignore` exclui `.env*` e todo
diretório operacional (`.claude/`, `.compozy/`, `tests/`, `docs/` etc.) do
contexto de build — regra 16: nenhum valor de ambiente entra numa camada.
`fly.toml` fixa `primary_region = "gru"` (São Paulo, a região Fly mais
próxima do Supabase de produção em `sa-east-1`, preservando o raciocínio de
round-trip curto descrito em "Os três ambientes") e um health check HTTP
contra `/manifest.json` — rota pública sem sessão (`proxy.ts`) e sem
dependência do banco, para que o check não confunda "Postgres fora do ar" com
"o processo não subiu". `.github/workflows/publicar-imagem-fly.yml` é
`workflow_dispatch` puro, e só publica a partir de `main` (o `if` do job
trava o ref, mesmo disparado à mão de outra branch): builda a imagem
localmente no runner (`load: true`, sem publicar ainda), **inspeciona o
sistema de arquivos dela** (`docker run … find` por `.env*`/`*.token.json`
etc. e `grep` por padrão de segredo) **antes** de qualquer login ou push,
publica em `ghcr.io/andreustimm/master-jobs`, confere de novo — agora nos
metadados da imagem publicada (`docker history --no-trunc`) — e, só se o dono
marcar `deploy: true` no disparo, implanta a imagem no Fly (`environment:
production`, o mesmo padrão de `migrate.yml`; `FLY_API_TOKEN` cadastrado
nesse ambiente é passo do dono, abaixo).

**Teste local do Dockerfile.** `docker build .` e, para exercitar o
contêiner sem expor a porta à rede local (o mesmo raciocínio da regra 12):

```bash
docker run --rm -p 127.0.0.1:3000:3000 <imagem>
```

Nunca `-p 3000:3000` sozinho — isso publica a porta em todas as interfaces do
host que roda o teste, não só em loopback.

**A tensão com a regra 12 (G36).** `pnpm dev` e `pnpm start` continuam presos
a `127.0.0.1` — nada muda para o laptop do dono. O contêiner do plano B
precisa escutar em todas as interfaces porque o proxy de borda do Fly fica
fora do namespace de rede dele; a exceção mora só no `ENV HOSTNAME=0.0.0.0`
do `Dockerfile`, nunca em `package.json` — não existe um `pnpm
start:container` nem qualquer script local capaz de reabrir esse bind por
engano. Detalhe e prova em
[security.md#g36](rules/security.md#g36).

**Segredos replicados, nunca automatizados.** Toda variável da tabela acima
que a aplicação lê em runtime (`DATABASE_URL`, `DATABASE_CA_CERT`,
`RESEND_API_KEY`, `RESEND_FROM`, `SENTRY_DSN`, `CRON_SECRET`,
`JHO_SOURCE_ALLOWLIST` etc.) precisa existir também no Fly, cadastrada à mão
pelo dono com `fly secrets set <NOME>=...` — nunca em `fly.toml`, na PR, no
ADR ou neste documento, que citam só o nome (regra 16). `JHO_ENV=production`
e `JHO_PUBLIC_URL=https://jobs.mastertimm.com.br` já vêm fixados no `fly.toml`
(não são segredo, não precisam de `fly secrets set`) — ver a tabela acima
para o porquê de cada um (G38, G17/G18). `JHO_STORAGE_DRIVER` merece decisão
própria do dono antes do primeiro failover real: `vercel-blob` depende da
integração de Blob da própria Vercel e não segue para o Fly; a alternativa
portável é `s3` contra um bucket real (não o MinIO local), documentada em
[local-storage.md](local-storage.md) — sem essa decisão, `/candidate` e `/p/`
sobem sem upload de foto e capa no plano B, o mesmo comportamento (não uma
regressão nova) de quando `JHO_STORAGE_DRIVER` está ausente.

**Limite por IP: a direção certa do risco.** `clientKey`
(`src/core/rate-limit.ts`) usa o primeiro valor de `x-forwarded-for` como
chave do balde — e o primeiro valor dessa lista é o que **o cliente
escreveu**, não o que um proxy confiável verificou. Na Vercel isso é aceito
porque a borda dela sobrescreve o `x-forwarded-for` recebido do cliente antes
de repassar à função; o risco não é "degradar para um balde só" (mais
restritivo), é o oposto — **um cliente escolhendo livremente o próprio balde**
para escapar do limite, ou forçando outro visitante para o seu. Fora da
Vercel essa garantia não existe. Por isso `clientKey` agora prefere
`Fly-Client-IP` — escrito pelo proxy de borda do próprio Fly, que o cliente
não alcança sem passar por ele — sempre que `VERCEL` não está declarado no
ambiente; declarado (a Vercel), o cabeçalho é ignorado, porque ali qualquer
cliente poderia forjá-lo sem que a borda o filtrasse. Prova em
`tests/rate-limit.test.ts`.

**Pré-requisitos, uma vez, antes do primeiro failover — todos passo do
dono:**

1. `fly apps create master-jobs` (ou o nome escolhido, igual ao `app` de
   `fly.toml`) na organização Fly do dono.
2. Cadastrar `FLY_API_TOKEN` no ambiente `production` deste repositório no
   GitHub (Settings → Environments → production → Secrets) — é o que o job
   `implantar` de `publicar-imagem-fly.yml` lê; sem ele, o disparo com
   `deploy: true` falha ao chamar `flyctl deploy`.
3. `fly certs add jobs.mastertimm.com.br` **antes** de qualquer incidente
   (o comando aceita o hostname mesmo com o DNS ainda apontando para a
   Vercel). `fly certs show jobs.mastertimm.com.br` devolve um registro
   `_acme-challenge.jobs.mastertimm.com.br` para cadastrar como `CNAME` na
   Cloudflare — isso deixa o certificado `Ready` com antecedência, para que o
   runbook abaixo não fique esperando emissão de TLS no meio do incidente.

**A varredura fatiada perde o alvo durante o failover.** O `pg_cron` do
Supabase chama `/api/cron/varredura` **na Vercel** (ADR 0025); ele não sabe
que o Fly existe. Duas saídas, nenhuma delas código novo:

1. Repontar o SQL do agendador (`supabase/cron/varredura.sql`) para a URL do
   Fly durante o incidente, com o mesmo `CRON_SECRET` também cadastrado lá —
   trabalho manual do dono, revertido junto com o DNS.
2. Aceitar a pausa da varredura fatiada pelo tempo do failover e deixar
   `.github/workflows/varredura.yml` (a rede de segurança já documentada em
   "A varredura diária") cobrir `sync`/captura/reconferência por
   `workflow_dispatch` — ele roda contra o banco de produção
   independentemente de qual frontend serve HTTP.

A opção 2 é o caminho recomendado: o failover existe para manter o dashboard
no ar, não para migrar a infraestrutura de ingestão sob a pressão de um
incidente.

**Runbook de failover de DNS (Cloudflare), os dois sentidos.** Os três CNAMEs
de produção/staging/dev já são "DNS only" (nuvem cinza) e TTL padrão — a
seção "DNS" acima explica por quê. Ida:

1. **Passo do dono:** confirmar os pré-requisitos acima já feitos (app criado,
   `FLY_API_TOKEN` cadastrado, certificado `Ready` — se o certificado ainda
   não foi pedido com antecedência, pedir agora com `fly certs add
   jobs.mastertimm.com.br` custa o tempo de emissão do TLS no meio do
   incidente). Disparar `publicar-imagem-fly.yml` (`workflow_dispatch`, com
   `deploy: true`) e confirmar `fly status` saudável.
2. Confirmar a aplicação respondendo direto no host temporário do Fly
   (`https://<app>.fly.dev/manifest.json`, depois login e um `/p/<slug>` de
   teste) **antes** de tocar o DNS.
3. **Passo do dono:** na Cloudflare, trocar o registro `CNAME` de
   `jobs.mastertimm.com.br` de `cname.vercel-dns.com` para o host do Fly,
   mantendo "DNS only" (nuvem laranja duplicaria CDN sem ganho, como já
   registrado para a Vercel) e baixando o TTL para 300 s antes da troca, se
   ainda não estiver nesse valor.
4. Confirmar propagação (`dig +trace jobs.mastertimm.com.br`) dentro do TTL
   declarado e TLS válido no destino novo.
5. Smoke test manual: `/login` autentica, nenhuma rota responde sem sessão,
   `/p/<slug>` de um perfil de teste devolve o esperado (mesma checklist de
   "O que confirmar depois de subir").

Volta, quando a Vercel normalizar: repetir o passo 3 apontando de volta para
`cname.vercel-dns.com`, confirmar propagação e TLS, e então (se a opção 1 da
varredura foi usada) repontar `supabase/cron/varredura.sql` de volta à
Vercel. O Fly pode ficar parado (`fly scale count 0`) até o próximo
incidente — `auto_stop_machines` em `fly.toml` já reduz o custo entre
failovers.

## A varredura diária

> **Pausa operacional:** o workflow permanece opt-in até concluir o corte para
> Supabase, a importação seletiva e os gates de retenção. O incidente Turso de
> 03/09/2026 é apenas o diagnóstico histórico; consulte os
> [gates documentados](../operations/turso-quota-incident-2026-09-03.md).

Quando habilitado, `.github/workflows/varredura.yml` roda `jobs sync`, `scrape
queue`+`run` e `jobs recheck queue`+`run` contra **produção**, todo dia às
06:00 UTC (03:00 em São Paulo), com `workflow_dispatch` para rodar à mão depois
de mexer em `config/sources.yaml`.

**Agora é rede de segurança.** Desde a
[ADR 0025](../adr/0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md), a
varredura de verdade roda na Vercel, fatiada e agendada pelo `pg_cron` do
Supabase — a ~57 minutos por execução daqui (runner nos EUA, banco em São
Paulo), o Actions não chegaria a "de hora em hora". Até a troca ser ativada
([runbook](../operations.md#varredura-horária-ativar-o-agendador)), a execução
diária continua como sempre. Depois dela, a variável de repositório
`VARREDURA_AGENDADOR=supabase` faz o disparo agendado não rodar nada; o
`workflow_dispatch` continua, e é o caminho de volta se a Vercel parar.
`tests/workflow-environment-isolation.test.ts` exige `crons` vazio no
`vercel.json`, a reconferência agendada uma única vez no SQL do `pg_cron` e o
disparo agendado do Actions condicionado à variável — mudar o dono é mudar esse
teste junto.

Só produção é varrida. `dev` e `staging` existem para exercitar código, não para
acumular acervo — varrer os três triplicaria as requisições contra APIs de
terceiros para produzir dois acervos que ninguém lê.

O passo final confere `jho sources list`, porque `syncAll` **não aborta** quando
uma fonte quebra (o que é certo: uma API fora do ar não pode zerar a varredura).
O efeito colateral é a falha ficar silenciosa até alguém olhar — então o CI
olha. Uma fonte fora é aviso; mais da metade é erro, porque aí a causa é comum e
provavelmente daqui.

Segredos opcionais: `ADZUNA_APP_ID` e `ADZUNA_APP_KEY`. Das 15 fontes ativas,
nenhuma exige Adzuna; se ele for habilitado sem essas credenciais, é ignorado
com aviso e as outras fontes seguem.

## O portão

`.github/workflows/ci.yml` roda typecheck, testes com cobertura e build no PR e
no push das três branches. Os gates correm em jobs paralelos:

| Job | O que prova |
|---|---|
| `contratos` | changelogs prontos, tracker de QA, tipos, contratos das skills de QA |
| `testes` (4 fatias) | a suíte Vitest, cada fatia num runner com o próprio PostgreSQL em Docker |
| `cobertura` | mescla os blobs das fatias e aplica o piso de `vitest.config.ts` sobre o total |
| `pwa-browser` | a fronteira de privacidade do service worker num Chromium real |
| `build` | `next build`, com `.next/cache` reaproveitado entre execuções |
| `schema-e-migracao` | `schema.ts` e `drizzle/` em sincronia |
| `qualidade` | agregador: só passa quando todos os anteriores passaram |

`qualidade` e `schema-e-migracao` são os nomes que a promoção e a proteção de
branch exigem. O agregador usa `if: always()` porque check obrigatório
**pulado** conta como aprovado na proteção de branch: sem a condição, um job
anterior vermelho faria `qualidade` ser pulado, e a PR ficaria mesclável. Job
novo no CI entra em `qualidade.needs`; `tests/ci-pipeline.test.ts` reprova quem
esquecer. A fatia de teste zera os limiares de cobertura porque a cobertura de
um quarto da suíte não mede nada; o piso vale sobre a soma, em `cobertura`.

O job `e2e-navegador` roda ao lado a suíte `pnpm test:e2e` inteira, sem
segredo e com PostgreSQL descartável no loopback do runner. Ele é a única
exceção registrada a `qualidade.needs` (`NON_BLOCKING_CI_JOBS` em
`scripts/release/promotion-ci.ts`), até a instabilidade estar medida — ver
[O que o CI prova](../qa/README.md#o-que-o-ci-prova-e-o-que-só-a-jornada-prova).
Não bloqueante vale nas três portas, e não só no agregador:

- **Autorização da promoção.** `requireSourceCI` avalia os jobs da execução de
  push em `dev`, não a conclusão da execução inteira. `qualidade` e
  `schema-e-migracao` precisam ter passado; os demais jobs bloqueantes não podem
  ter reprovado nem estar pendentes; os da lista não bloqueante são ignorados.
  Uma execução vermelha ou em andamento só autoriza quando a causa está num job
  da lista — senão o motivo é desconhecido e a promoção recusa. A conclusão da
  execução inteira não serve: um E2E vermelho a torna `failure`.
- **Chamada reutilizável da promoção** (`target-sha`): o job nem roda.
- **`workflow_dispatch` em `staging`**, que a promoção dispara para a PR de
  produção: o job também não roda. Ali só contam os checks que o ruleset de
  `main` exige, e `staging` recebe o SHA cujo push em `dev` já rodou o E2E.

Não há atalho para PR só de documentação: cerca de quarenta arquivos de teste
leem `docs/`, os changelogs e `.claude/skills/`, e o build compila os
changelogs. Pular a suíte nesses casos deixaria passar exatamente a quebra de
contrato documental que ela existe para pegar. O ganho para essas PRs vem do
paralelismo, que já vale para todas.

Medido em 23/09/2026: o job único levava 6 min 53 s (run 35803388420, em `dev`);
os jobs paralelos, 2 min 41 s do disparo ao `qualidade` (run 35850357880, PR
#266). O caminho crítico é a fatia mais lenta (~2 min) + `cobertura` (~30 s). A
cobertura mesclada saiu idêntica, contador por contador, à de uma execução
única local — a divisão não perde nem duplica nada. Se o caminho crítico
crescer, a primeira alavanca é o número de fatias.

`migrate.yml` aplica migrações somente em produção, de dois jeitos
([ADR 0028](../adr/0028-migracao-automatica-so-aditiva.md)): **sozinho**, no
push para `main` (todo push, sem filtro de caminho: o filtro do GitHub só vê
300 arquivos do diff), quando todo o lote pendente no banco é aditivo; e por `workflow_dispatch`, depois de confirmar o
project ref do Supabase, para o que exige revisão. As migrations de `dev` e
`staging` ficam desativadas até existirem bancos de fixture isolados. Esta
configuração não pausa os deployments da Vercel.

**A Vercel implanta no push, independente do CI.** As duas coisas disparam do
mesmo evento e não se conhecem. Por isso o portão está na entrada de `main`:
desde 22/09/2026 um ruleset exige ali PR aprovada com `qualidade` e
`schema-e-migracao` verdes, sem bypass de CI, e recusa push direto. Em
`staging` e `dev` o push continua implantando sem CI prévio. A plataforma não
aceita a exceção de que a promoção precisaria, e a promoção valida o SHA pelo
CI reutilizável antes do fast-forward. Detalhes, limites e reversão em
[github-protections.md](github-protections.md).

O segredo usado por `migrate.yml` é `SUPABASE_MIGRATION_URL`; o workflow valida o
project ref antes de abrir a conexão.

**O host direto não é alcançável do runner.** `db.<ref>.supabase.co` só publica
registro AAAA, e o runner hospedado do GitHub não tem IPv6: de 19/09 a 22/09/2026
toda execução falhou com `Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`,
que é como o drizzle embrulha o erro de conexão. `migrar.sh` converte a URL direta
no pooler de sessão da mesma região (`aws-0-sa-east-1.pooler.supabase.com:5432`,
usuário `postgres.<ref>`, mesma senha) por `reachableMigrationTarget()` e mascara
o resultado no log. A porta 6543 (transação) continua recusada.

### Runner self-hosted opt-in (`CI_RUNS_ON`)

Fase 2 da contingência de CI/deploy ([issue #367](https://github.com/andreustimm/master-jobs/issues/367),
[ADR 0030](../adr/0030-contingencia-de-ci-e-deploy.md)). O `runs-on:` de todo
job de `ci.yml` é uma única expressão, nunca um literal
(`tests/ci-runner-selection.test.ts` reprova quem adicionar `runs-on:
ubuntu-latest` de novo):

```yaml
runs-on: ${{ github.event_name == 'pull_request' &&
  github.event.pull_request.head.repo.full_name != github.repository &&
  'ubuntu-latest' || fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}
```

- **Ausente ou vazia** (padrão): `ubuntu-latest`, o runner hospedado de hoje —
  nada muda sem ação do dono (princípio 1/2 da ADR).
- **Setada** com **JSON válido** (`gh variable set CI_RUNS_ON --body
  '["self-hosted","linux","master-jobs"]'`): todo job passa a rodar no runner
  próprio, sem editar `ci.yml`. **Cuidado com a citação:** o valor precisa ser
  JSON — uma string entre aspas duplas ou um array — nunca texto cru. `gh
  variable set CI_RUNS_ON --body 'self-hosted'` (sem aspas internas) faz
  `fromJSON` falhar e derruba o CI inteiro no próximo push; os dois comandos
  acima, com as aspas simples e duplas exatamente como estão, são os únicos
  valores testados.

#### Pré-requisito do dono: aprovação de workflow de fork (aplicado em 29/09/2026)

**A metade da expressão antes de `||` (a guarda de fork embutida no
`runs-on:`) é defesa em profundidade, NÃO a barreira real** (achado da
revisão L2 da PR #376, C1). Num evento `pull_request`, o GitHub executa a
versão de `ci.yml` que está na `head` da PRÓPRIA PR — uma PR de fork pode
editar o arquivo e substituir a expressão inteira por `runs-on:
[self-hosted, ...]` literal, sem esbarrar em nada que esteja dentro do
workflow, porque é o próprio workflow que está sendo reescrito. Nenhuma
guarda embutida no YAML resolve isso sozinha.

A barreira que de fato impede a execução é externa ao arquivo: a política de
aprovação de workflow de colaborador externo do repositório
(`fork-pr-contributor-approval`). **O dono já mudou essa política para
`all_external_contributors` em 29/09/2026** (todo PR de colaborador externo,
não só o primeiro, exige "Approve and run" de alguém com escrita no
repositório) — confira o valor efetivo antes de qualquer mudança em
`CI_RUNS_ON`:

```bash
gh api repos/andreustimm/master-jobs/actions/permissions/fork-pr-contributor-approval
```

Comando usado pelo dono, registrado aqui para repetir se algum dia a política
regredir ao padrão (nunca rodado por um agente):

```bash
gh api -X PUT repos/andreustimm/master-jobs/actions/permissions/fork-pr-contributor-approval \
  -f approval_policy=all_external_contributors
```

O padrão de fábrica, `first_time_contributors`, dispensa aprovação para quem
já teve uma contribuição aceita antes — insuficiente aqui, porque uma conta
comprometida ou um colaborador que vira malicioso depois de aprovado uma vez
não passaria por aprovação nenhuma na PR seguinte. **Nenhum agente muda essa
política sozinho** — é decisão e ação do dono, assim como contratar a VPS. A
exigência de aprovação em si ("Approve and run", em *Settings → Actions →
General*) já está ativa; o que mudou aqui foi o alcance dela.

#### Provisionamento: contêiner descartável, sem credencial de longa duração no job

Revisão L2 da PR #376 (C2) trocou o desenho original (runner instalado direto
no host, registrado por token reutilizável) por um mais estreito; a
re-revisão de 29/09/2026 (C1) fechou um furo do primeiro desenho do
contêiner:

- **`scripts/runner/Dockerfile`** builda uma imagem IMUTÁVEL com Node/pnpm na
  versão de `package.json`, a versão EXATA de Playwright do
  `pnpm-lock.yaml`, o binário do runner do GitHub (checksum verificado, M5) e
  um Docker Engine para um dockerd **isolado dentro do próprio contêiner** —
  o job nunca recebe o socket Docker do host, só o seu próprio, descartado
  com o contêiner.
- **Cada job roda num CONTÊINER DESCARTÁVEL** (`docker run --rm`) criado
  dessa imagem, com o runtime **`sysbox-runc`, NUNCA `--privileged`**
  (re-revisão C1: `--privileged` daria ao contêiner do job acesso aos
  dispositivos de bloco do PRÓPRIO HOST — montar `/dev/sda`, ler
  `/etc/master-jobs-runner/env`, o arquivo com o PAT que controla até a
  política de fork acima. `sysbox-runc`, instalado por `provision-vps.sh`
  com checksum verificado, dá ao contêiner o suficiente para um dockerd
  interno de verdade sem essas capacidades amplas). `scripts/runner/
  entrypoint.sh`, root-owned e só leitura dentro da imagem, limpa qualquer
  resquício de execução anterior, sobe o dockerd isolado e roda o runner como
  o usuário não-root `runner` sobre uma CÓPIA gravável e descartável do
  binário, com o bit de escrita restaurado para o novo dono (M1 — a origem
  em `/opt/actions-runner` continua sem bit de escrita para ninguém depois
  do build da imagem). O entrypoint é o PID 1 do contêiner e roda o
  `run.sh` em segundo plano, direto no usuário `runner` por `setpriv` (sem a
  camada do `su`, que não repassa sinal de forma confiável): um `docker stop`
  (SIGTERM) ou SIGINT vira SIGTERM para o `run.sh`, o entrypoint espera o
  runner sair, para o dockerd interno e termina com 143 (130 no SIGINT) —
  nunca com 75, para o controller não ler uma parada como "nenhum job". Sem o
  trap, o PID 1 ignorava o sinal e o `docker stop` só terminava no SIGKILL
  do timeout. Para o sinal chegar ao Runner.Listener (e ao Worker), o
  entrypoint define `RUNNER_MANUALLY_TRAP_SIG=1` (só com ela o `run.sh` do
  GitHub instala `trap 'kill -INT -$PID' INT TERM` e repassa SIGINT ao grupo
  do helper) e lança o `run.sh` com job control (`set -m`), porque filho em
  segundo plano de shell não interativo herda SIGINT ignorado e o helper
  nunca o veria. O teste usa uma cópia fiel do `run.sh` do upstream
  (`tests/fixtures/runner-upstream/run.sh`); o Runner.Listener real não foi
  exercitado.
- **`scripts/runner/runner-controller.sh`** roda no HOST, como o serviço
  systemd `master-jobs-runner-controller.service` (instalado por
  `provision-vps.sh`, com `Requires=docker.service`). Para cada job, ele pede
  à API do GitHub uma **configuração JIT de uso único** (`POST .../actions/
  runners/generate-jitconfig`, cabeçalho `Authorization` passado ao `curl`
  por `-H @-`/stdin — nunca como argumento visível em `ps`) e passa só essa
  configuração (`JIT_CONFIG`, variável de ambiente daquele contêiner
  específico) para `docker run` — o PAT de longa duração nunca sai do
  processo do controller, e nunca entra no contêiner do job. Um `docker run`
  que falha (status ≠ 0), ou um contêiner que sinaliza "nunca peguei um job"
  (`entrypoint.sh` sai com o código 75 quando `run.sh` termina sem o log
  `_diag/Worker_*.log`) faz o controller desregistrar o runner órfão e
  esperar com backoff exponencial (30s a 10min) antes de tentar de novo —
  NUNCA por duração de parede (3ª revisão L2 de 29/09/2026, minor 2): um job
  curto e legítimo, como uma PR só de documentação, não pode ser tratado como
  falha só por ser rápido.
- **Escopo do PAT.** Fine-grained, com a permissão de repositório
  **"Administration: write"** — é a permissão mínima que a API de
  configuração JIT aceita hoje; não existe uma mais estreita para esta
  capacidade específica (o próprio endpoint de registro de runner exige
  administração do repositório). **Nunca** um PAT clássico com escopo `repo`:
  esse escopo clássico dá leitura/escrita de código, issues e muito mais,
  bem além do que registrar um runner precisa — a diferença importa porque o
  PAT fica na VPS, fora do controle de acesso do GitHub.

**Passo do dono, antes de ligar a chave:**

1. Confirmar `fork-pr-contributor-approval=all_external_contributors`
   (seção acima — já aplicada em 29/09/2026).
2. Contratar a VPS (Hetzner CPX22 ou DigitalOcean 4 GB — Decisão 2 do PRD da
   issue #367), Ubuntu 24.04 LTS.
3. Antes de rodar o script, confirmar o checksum ainda placeholder do runner
   do GitHub (`RUNNER_SHA256` em `scripts/runner/Dockerfile`, publicado em
   <https://github.com/actions/runner/releases> para a versão fixada) — o
   build da imagem falha de propósito enquanto o valor for o placeholder. O
   checksum do `sysbox-ce` (`SYSBOX_SHA256` em
   `scripts/runner/provision-vps.sh`) já foi conferido pelo agente com `gh
   api repos/nestybox/sysbox/releases/tags/v0.7.1` em 29/09/2026 — só
   reconfira se `SYSBOX_VERSION` mudar.
4. Copiar o repositório para a VPS e rodar como root:
   `sudo bash scripts/runner/provision-vps.sh`. O script instala Docker,
   depois `sysbox-runc` (registrando o runtime no Docker do host) e só então
   builda a imagem do runner.
5. Criar um PAT fine-grained com "Administration: write" só neste
   repositório, e colar em `/etc/master-jobs-runner/env` (o script cria o
   arquivo vazio com o `chmod 600` certo, se ainda não existir):
   `GH_RUNNER_REGISTRATION_PAT=<valor>`. Depois: `systemctl start
   master-jobs-runner-controller`.
6. Confirmar, no log do serviço (`journalctl -u
   master-jobs-runner-controller -f`), um contêiner subindo e um runner
   aparecendo em *Settings → Actions → Runners* com os labels `self-hosted`,
   `linux`, `master-jobs`, e desaparecendo de novo ao fim de cada job (é
   efêmero — "sumir" entre jobs é o comportamento esperado, não uma falha).
7. Só então: `gh variable set CI_RUNS_ON --body
   '["self-hosted","linux","master-jobs"]'` e um push real em `dev` para
   confirmar o CI inteiro verde no runner próprio (checklist F2-M01–F2-M03 em
   `_tests.md`).

**Voltar ao hospedado**, a qualquer momento e sem tocar na VPS:

```bash
gh variable set CI_RUNS_ON --body '"ubuntu-latest"'   # ou: gh variable delete CI_RUNS_ON
```

O próximo push já roda em `ubuntu-latest`. **Se havia execução do CI em fila
ou em andamento esperando o runner próprio** no momento da troca, ela fica
presa (nenhum runner com aquele label vai aparecer para pegá-la). Restrinja a
`--workflow ci.yml` — cancelar um workflow alheio (`varredura.yml`,
`migrate.yml` etc.) por engano é um efeito colateral desnecessário — e
redispare o MESMO run com `gh run rerun`, sem criar commit nenhum (regra 18:
nada de commit avulso fora do fluxo de PR só para forçar um re-run):

```bash
# Guarda os IDs antes de cancelar, para redisparar exatamente esses runs.
presos=$(gh run list --workflow ci.yml --status queued --json databaseId -q '.[].databaseId'; \
         gh run list --workflow ci.yml --status in_progress --json databaseId -q '.[].databaseId')
for id in $presos; do gh run cancel "$id"; done
# `gh run cancel` é assíncrono — sem esperar o cancelamento terminar de
# verdade, `gh run rerun` num run ainda "cancelling" falha ou não faz nada
# (minor 3, 3ª revisão L2 de 29/09/2026). `gh run watch` bloqueia até o run
# concluir (`--exit-status` não importa aqui, só queremos o estado final).
for id in $presos; do gh run watch "$id" --exit-status || true; done
for id in $presos; do gh run rerun "$id"; done
```

## Migrar o banco

```bash
export DATABASE_MIGRATION_URL="postgresql://..."
pnpm jho db migrate
DATABASE_URL="$DATABASE_MIGRATION_URL" pnpm jho db check
```

Em produção, ninguém roda isto no dia a dia: o merge em `main` dispara
`migrate.yml`, que executa `jho db migrate --additive-only` e depois
`jho db check`. `--additive-only` lê no banco o lote que o migrador vai
aplicar, classifica cada comando com o detector de
`src/core/db/migration-review.ts` e, se algum não for aditivo, recusa **antes
de qualquer DDL**, listando arquivo, motivo e comando. Sem a flag, o comando
aplica o lote inteiro — é o que o dispatch manual faz, com
`confirm_project=bujawvnxwtmneiggizje`; o workflow recusa outro project ref.
`MIGRATION_MODE` (`aditiva` no push, `revisada` no dispatch) escolhe entre os
dois em `migrar.sh`, e valor ausente ou desconhecido não migra nada.

**O que é aditivo** (lista de permissão; o resto pede revisão): criar schema,
tabela, índice não único, sequência, enum ou extensão; acrescentar coluna nula
ou com default; acrescentar valor a enum; `DROP NOT NULL`; `SET DEFAULT`;
`GRANT`; `COMMENT`; `INSERT` sem `DO UPDATE`. FK e índice único só quando a
tabela nasce no mesmo lote ou as colunas são novas e sem default. `DROP`,
`RENAME`, mudança de tipo, `SET NOT NULL` em coluna existente, restrição sobre
dado existente, `UPDATE`/`DELETE`/`TRUNCATE`, `REVOKE`, bloco `DO`, função e
qualquer forma não prevista pedem revisão. Toda migração publicada tem o
veredito revisado em `tests/fixtures/migration-verdicts/<tag>.json` (`[]`
quando aditiva), um arquivo por migração, que entra no mesmo commit dela;
`tests/migration-review.test.ts` reprova a migração sem veredito e diz o que
o detector acha dela.

**Ordem com o deploy.** A Vercel constrói `main` no mesmo push em que o job
migra, e os dois não se esperam. Para aditiva a corrida é aceita: o código
antigo não enxerga o que foi acrescentado, e o novo só erra se o build
terminar antes do job (o job leva cerca de um minuto; o build, alguns). Se a
migração aditiva falhar, o código novo serve sobre o schema velho até a
correção — o job vermelho e o alerta do Sentry são o sinal. A migração que
falhou continua pendente e roda primeiro em qualquer lote seguinte; corrija o
próprio `.sql`, que nunca foi aplicado (a promoção pede `confirmar-migracao`
por ele ter mudado).

### Migração que não é aditiva

O job automático para vermelho com `Migração pendente exige execução manual`,
e a promoção `dev → staging` já tinha parado antes, pedindo
`confirmar-migracao=true` ([promotion.md](promotion.md)). Quem revisa escolhe a
ordem, porque nenhuma é segura sozinha:

- **Contrair o que o código novo já não usa** (remover coluna, índice ou
  restrição órfã): mescle `staging → main`, espere o deploy e dispare
  `migrate.yml` à mão com `confirm_project=bujawvnxwtmneiggizje`.
- **Mudar o que o código antigo ainda usa** (chave, tipo, `NOT NULL`,
  reescrita de dado): migre **antes** do merge, pela CLI, a partir do commit que
  vai ser mesclado, e mescle logo depois — o roteiro da 1.15.0 abaixo. O job do
  push em seguida encontra o lote vazio e passa.

A migration deve ser aplicada e verificada antes da importação de dados.

### Release 1.15.0: migrar antes, pela CLI

As migrations 0004–0008 trocam a chave de `job_score` (expandir, preencher,
contrair) e criam as tabelas da busca por termo. Nenhuma ordem entre migrar e
publicar deixa a versão no ar funcionando sozinha: o código novo lê
`target_track` em toda consulta de nota, e o antigo grava nota com
`ON CONFLICT (candidate_id, job_id)`, a chave que a 0006 remove. O `migrate.yml`
só roda a partir de `main`, e a Vercel publica `main` no mesmo push — seguir o
caminho aprovado daria 500 em toda tela com nota até alguém disparar o workflow.
(Hoje o detector classifica a 0005 e a 0006 como não aditivas, e o push
automático as recusaria do mesmo jeito.)
Nesta versão a migração vem antes, pela CLI, e o merge logo depois:

1. Desligue a varredura: `vars.SUPABASE_CRAWL_ENABLED=false`. Ela grava nota com
   o código antigo e disputa a janela.
2. Com a PR `staging → main` aprovada e pronta, aplique as migrations a partir
   do commit que vai ser mesclado:

   ```bash
   export DATABASE_MIGRATION_URL="postgresql://..."   # SUPABASE_MIGRATION_URL
   pnpm jho db migrate
   DATABASE_URL="$DATABASE_MIGRATION_URL" pnpm jho db check
   ```

   Até o passo seguinte, a leitura continua funcionando (só existe a linha da
   trilha principal por vaga). O que falha com o código antigo é gravar nota:
   cadastrar vaga pela tela ou comparar uma vaga à mão. Faça os dois passos em
   sequência.
3. Mescle `staging → main` imediatamente e espere o deploy da Vercel terminar.
4. Pontue produção e religue a varredura. O CLI lê `DATABASE_URL` do `.env`
   primeiro — sem apontá-la para produção, a nota iria para o banco local:

   ```bash
   DATABASE_URL="$DATABASE_MIGRATION_URL" pnpm jho jobs score --every-candidate
   ```

   Depois, `vars.SUPABASE_CRAWL_ENABLED=true`.

**Sem rollback para 1.14.x.** Depois da 0006 o código antigo duplica linha de
nota por trilha na leitura e falha na gravação, e a 0005 apaga notas sem trilha.
Correção desta versão vai para frente, numa versão nova.

Para o snapshot legado, `scripts/migration/select-production.ts` aplica a
allowlist de tabelas e exclui sessões, tokens, filas e HTML de crawler. O
`scripts/migration/import-production.ts` importa somente a seleção verificada,
exige destino vazio, mantém as FKs ativas e aborta acima de 400 MiB. Não há
comando de reset destrutivo implícito: uma nova carga deve usar uma instância
local vazia ou um destino explicitamente provisionado.

As FKs não são desligadas durante a cópia PostgreSQL. A transação trava as
tabelas, verifica o schema esperado, importa em ordem de dependência e compara
um hash normalizado de cada tabela antes de ajustar as identities.

O snapshot SQLite legado tinha **525,7 MiB**, e a maior parte era entrada
reconstruível duplicada:

| | tamanho | linhas |
|---|---:|---:|
| `job_page.html` | 137,1 MiB | 220 |
| `job.raw` | 125,3 MiB | 13.384 |
| `job.description_html` | 67,7 MiB | 13.384 |
| `job.description_text` | 65,7 MiB | 13.384 |

Esses números são históricos, não uma meta para o Supabase. Desde a ADR 0019,
`job_page.html` é apagado após extração bem-sucedida; fontes de rede também
deixam de persistir o payload integral em `raw` e `description_html` (o
`workplaceType` mínimo permanece quando declarado). O limite de importação atual
é 400 MiB, e a limpeza semanal remove somente dados reconstruíveis e vagas
fechadas sem candidatura:

```bash
pnpm jho db cleanup
pnpm jho db cleanup --apply
```

Páginas cuja extração falhou preservam HTML para reprocessamento; páginas
tratadas não devem acumular o HTML bruto indefinidamente.

## Dar login à role de runtime

A migration `0001_production_access` cria `master_jobs_runtime` **sem login e
sem privilégio administrativo**, e concede a ela exatamente o que a aplicação
usa: `USAGE` no schema, `SELECT/INSERT/UPDATE/DELETE` nas tabelas e
`USAGE/SELECT` nas sequências — com `ALTER DEFAULT PRIVILEGES` para que tabela
nova nasça acessível. O que ela **não** tem: criar tabela, criar role, replicar,
ignorar RLS.

Dar senha a ela é passo de operador, e é por isso que a migration não o faz:
senha dentro de migration vira segredo versionado, copiado em backup e lido por
quem abrir o repositório.

O papel de grupo existe para que a credencial seja trocável sem mexer em
permissão. Criar o login, uma vez, com a conexão privilegiada:

```sql
-- Senha forte gerada localmente; ela nunca entra no repositório.
CREATE ROLE master_jobs_app LOGIN PASSWORD '<gerada>' NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT master_jobs_runtime TO master_jobs_app;
```

E então cadastrar na Vercel, em Production:

```
DATABASE_URL=postgresql://master_jobs_app.<project-ref>:<senha>@<pooler-host>:5432/postgres?sslmode=require
```

No pooler compartilhado do Supabase, o usuário é `<role>.<project-ref>`;
na conexão direta, é somente `<role>`. Copie host e porta da configuração do
projeto. Query string é desnecessária — a política de TLS é do cliente. Se
vier, `?sslmode=require` (ou `verify-ca`/`verify-full`) é aceito e descartado,
e a verificação de cadeia continua com a CA configurada; `?sslmode=disable`,
valores desconhecidos ou outros parâmetros que mudem a política são recusados
com erro que nomeia a variável.

**Por que isto importa mesmo com o fallback.** O runtime aceita `POSTGRES_URL`
quando `DATABASE_URL` falta, e é isso que faz o deploy subir sem configuração
manual. Só que a variável que a integração do Supabase cadastra conecta como
`postgres`, **o superusuário**: funciona, e joga fora a separação de privilégio
que esta seção descreve. O fallback é rede de segurança contra indisponibilidade,
não o destino.

Para conferir que a role ficou com o alcance certo, sem adivinhar:

```sql
SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
  FROM pg_roles WHERE rolname = 'master_jobs_app';       -- tudo false
SELECT has_table_privilege('master_jobs_app', 'production.job', 'SELECT'),
       has_schema_privilege('master_jobs_app', 'production', 'CREATE');
                                                          -- true, false
```

Confira cada privilégio individualmente: uma lista como
`has_table_privilege(..., 'SELECT,INSERT,UPDATE,DELETE')` responde se **algum**
dos privilégios existe, não se todos existem. Valide também o uso das sequências
e faça uma transação somente leitura usando o mesmo cliente e CA do runtime.

Antes de alterar credencial, preserve-a em armazenamento privado recuperável,
fora do Git, com acesso exclusivo do operador. Registre a etapa antes de cada
efeito remoto: se a execução parar, a retomada reutiliza a mesma credencial.
Uma senha gerada somente em memória pode ser perdida depois de aplicada no
banco e antes de chegar à Vercel. A variável deve ser **Sensitive**, somente
em Production, e ser cadastrada apenas após o preflight passar.

Para uma role já em uso, prefira criar outro login no mesmo grupo, validar,
migrar os clientes e só então aposentar o anterior. As permissões continuam no
grupo. O pooler pode rejeitar temporariamente uma senha recém-alterada com
`28P01`; não faça rotações repetidas. A [orientação do Supabase](https://supabase.com/docs/guides/troubleshooting/supavisor-error-password-authentication-failed-after-password-rotation)
explica como distinguir atraso do cache de credencial incorreta.

### Configuração verificada em 22/09/2026

`DATABASE_URL` foi cadastrada como Sensitive somente em Production para
`master_jobs_app`, após validar TLS, leitura real de `job` e `application`,
os quatro privilégios em cada uma das 36 tabelas e uso das 28 sequências.
As flags administrativas e CREATE no schema `production` permaneceram negadas.
A primeira conexão retornou `28P01`; a seguinte passou com a mesma credencial,
sem outra rotação. `POSTGRES_URL` permanece como fallback quando a variável
preferida estiver ausente.

A configuração será aplicada no próximo deploy de produção aprovado por humano;
não foi disparado redeploy. Depois da promoção, conferir a fumaça de produção,
login e leitura de vagas, e confirmar sessões de `master_jobs_app` no banco.
Até essa evidência, O-01 permanece em validação. Se houver falha, preservar os
registros, **remover `DATABASE_URL` de Production** na Vercel e fazer
redeploy — só a ausência da variável devolve o runtime ao fallback
`POSTGRES_URL`; editar outra variável não reverte nada. Nunca imprimir URLs
de conexão nem rotacionar o usuário `postgres` como tentativa de diagnóstico.

## Relato de erro

Existe por um caso concreto: **o corte de produção da 1.13.1 devolveu 500 em
toda página que toca o banco por 28 minutos, e quem descobriu foi uma pessoa
abrindo o site.** Nenhuma linha deste sistema avisou.

Cadastre `SENTRY_DSN` na Vercel (Production) com o DSN do projeto Sentry.
**Sem ela, nada é enviado** — a mesma regra do `RESEND_API_KEY`: ausência de
provedor não bloqueia produto, e o desenvolvimento local segue sem conta, sem
rede e sem ruído. O DSN não é segredo (ele só permite *enviar* evento), mas
cadastre como variável, nunca no código.

### O que sai daqui, e o que não sai

A decisão mora em `src/core/observability.ts`, é função pura, e é testada em
`tests/observability.test.ts` — porque configuração de SDK some numa
atualização de dependência e teste não.

| Dado | Vai? | Por quê |
|---|---|---|
| Caminho da rota | sim | é onde quebrou, e é preciso para reproduzir |
| **Query string** | **não** | termo de busca, faixa salarial e estágio do funil são uso, não diagnóstico |
| `content-type`, `accept`, `accept-language`, `x-vercel-*` | sim | não identificam pessoa |
| **`cookie`** | **não** | é a sessão inteira |
| **`authorization`** | **não** | é a credencial |
| **`x-forwarded-for`, `x-real-ip`** | **não** | IP é dado pessoal |
| Corpo da requisição | não | carrega CV, nota de funil e senha |
| Identidade do usuário | não | `sendDefaultPii: false`, e `event.user` é apagado |

A lista de cabeçalhos é de **permissão**: cabeçalho novo não vai até alguém
decidir que pode. Cabeçalho fora da lista some por inteiro, em vez de aparecer
redigido — dizer que ele existe já conta algo sobre a requisição.

Antes de enviar, a mensagem e a pilha passam por `redactSecrets`, que apaga
credencial de URL, esquema `Bearer`, chave nomeada e e-mail. Isso não é zelo
abstrato: **uma falha de conexão do driver `postgres` traz a URL inteira, com
senha, no texto da exceção.**

### Só servidor, e a CSP é a razão

Não há SDK de browser. A CSP em `next.config.ts` declara `connect-src 'self'`,
então o SDK de browser seria **bloqueado ao enviar, em silêncio** — foi o que
já aconteceu com a fonte do Google até um browser de verdade reportar. Ligá-lo
exigiria abrir a CSP para um terceiro e passar a mandar JS de cliente que estas
páginas hoje não mandam. O erro que motivou isto era do servidor.

### Tracing

Ligado desde #219, só no servidor, amostrado por `SENTRY_TRACES_SAMPLE_RATE`
(padrão `0.1`). `0` desliga; valor que não seja número entre 0 e 1 também
desliga, em vez de cair no padrão — engano de configuração não pode mandar mais
dado do que o pedido. A taxa vale para toda requisição: um `tracesSampler` fixo
faz o SDK ignorar a decisão que chega no cabeçalho `sentry-trace` (`…-1`), que
de outro modo deixaria qualquer cliente forçar 100% de amostragem e gastar a
quota — e tornaria o `0` inútil.

Cada leitura de tela medida vira um span `jho.leitura` (`leitura /jobs`,
`leitura /`), e cada estágio do cronômetro (`auth`, `prelude`, `brought_by`,
`board`, `facets`, `tail`, `queue`, `cockpit`) um span `jho.etapa` filho — os
mesmos nomes da linha `perf` do log. O SDK acrescenta os spans de
renderização do Next e de PostgreSQL.

Uma transação carrega exatamente o que o relato de erro exclui: a URL com o
filtro da pessoa (`http.target`, `url.full`, `url.query`), o IP
(`client.address`), o texto da consulta (`db.query.text`) e o endereço do
banco (`server.address`). Por isso a peneira é outra lista de permissão:

| Onde | O que sai | O que não sai |
|---|---|---|
| Nome da transação e descrição de span | caminho, método, rota | query string e fragmento |
| Atributos (`ALLOWED_SPAN_DATA`) | método, status, rota, `next.*`, `db.system`, `db.operation.name`, `jho.etapa` | qualquer outro, inclusive os quatro acima |
| Span de banco | o verbo (`SELECT`, `UPDATE`…) | o texto da consulta |
| Contextos | `trace`, `runtime`, `os`, `app`, `device` | `otel`, `response` e o que vier |
| `extra`, migalhas, usuário | — | tudo |

`tracePropagationTargets: []` impede o SDK de anexar `sentry-trace` e
`baggage` às requisições de saída — o `baggage` levaria a chave pública, o
release e o nome da transação a cada board consultado.

A organização no Sentry está com a limpeza do lado do servidor **desligada**
(`dataScrubber: false`, `scrubIPAddresses: false`, lido em 22/09/2026), então a
peneira daqui é a única. `tests/sentry-tracing.test.ts` monta a transação no
formato do SDK com um marcador por dado privado e reprova se algum sobreviver.

**Quota** (API `customers/master-timm`, 22/09/2026): plano Developer
(`am3_f`), 5.000.000 spans reservados por ciclo (11/09 a 10/10), 48.198 usados,
sem gasto sob demanda — passar da quota descarta span, não cobra. A quota é da
organização, dividida com outros três projetos. Uma leitura de `/jobs` rende
algumas dezenas de spans; a 10% o custo fica em fração pequena da quota.
Reveja com:

```bash
rtk sentry api "customers/master-timm/" --json --fields plan,categories.spans
```

### Mapas de origem

Sem eles a pilha chega minificada (`chunks/5303.js:1:1963`), que foi
exatamente como o erro da 1.13.1 apareceu no log da Vercel.

`next.config.ts` liga o gancho `compiler.runAfterProductionCompile`, que chama
`scripts/sentry-source-maps.ts`: `sentry-cli sourcemaps inject` e `upload` em
`.next/server`, com o SHA do commit como release. O identificador de depuração
injetado no `.js` e no `.map` é o que casa a pilha com o mapa. Só servidor —
não há SDK de browser, e `productionBrowserSourceMaps` fica `false`.

- **Sem `SENTRY_AUTH_TOKEN`**, nada muda: nem `.map` é gerado
  (`experimental.serverSourceMaps` só liga com o token), e o log de build
  mostra `[sentry] SENTRY_AUTH_TOKEN ausente: o build segue sem publicar mapas
  de origem`. É o estado do CI e do desenvolvimento local.
- **Com o token e o Sentry fora do ar** (ou token revogado), o build segue e o
  log mostra `[sentry] falha ao publicar mapas de origem; o build segue sem
  eles`. Relato de erro não derruba o que ele observa.
- Os `.map` ficam dentro do pacote da função, que não é servido ao browser.
  Apagá-los quebra o build: a saída `standalone` copia `proxy.js.map`.
- Não se usa `withSentryConfig`: ele injeta `instrumentation-client.ts` na
  entrada do cliente pelo webpack e embrulha cada rota do servidor.

**Passo humano para ligar** (o token não pode ser criado por agente):

1. Em <https://master-timm.sentry.io/settings/auth-tokens/>, crie um
   *Organization Token* (nasce com o escopo fixo `org:ci`, feito para enviar
   mapas e criar release). Se preferir token pessoal, marque só
   `project:releases` e `org:read`.
2. Cadastre na Vercel, só para Production (o padrão da CLI já é Sensitive, que
   é o certo aqui — ao contrário do DSN, o token é credencial):
   `vercel env add SENTRY_AUTH_TOKEN production`.
3. Faça um deploy e confira no log de build a linha `[sentry] mapas de origem
   do servidor publicados em master-timm/master-jobs`.
4. Confirme a resolução: com um erro de servidor no release novo,
   `rtk sentry issue view <issue> --json` deve mostrar frames com caminho de
   `app/…` ou `src/…` e linha do fonte, não `chunks/<n>.js:1`.

### Alertas de produção

A regra [Master Jobs — erros em produção](https://master-timm.sentry.io/monitors/alerts/6032839/)
é do projeto `master-timm/master-jobs` e usa o detector de issues `10385751`.
Foi configurada em 22/09/2026 e reaproveita a regra existente, sem duplicá-la.

- Ambiente: `production`, o mesmo valor de `VERCEL_ENV` usado na instrumentação.
- Disparos: primeira ocorrência, regressão ou issue de alta prioridade.
- Filtro: nível `error` ou `fatal`.
- Canal: e-mail direto para Andreus, membro `4377260` no Sentry.
- Intervalo entre notificações repetidas: 30 minutos.

O canário sintético `MASTER-JOBS-7`, evento `92d23a7c0e784e12b1a9efc764f59e5b`,
foi recebido às 13:52:44 UTC; o Sentry registrou o disparo da regra às
13:53:12 UTC em 22/09/2026. Isso comprova a ingestão e a execução do alerta;
a entrega na caixa de entrada não foi inspecionada. O evento é identificado
por `synthetic:true` e `verification:O03-canary` e não representa falha do produto.
A issue `MASTER-JOBS-7` foi marcada como resolvida após a validação.

Para conferir ou suspender a regra:

```bash
rtk sentry alert issues view master-timm/master-jobs/6032839 --json
rtk sentry alert issues edit master-timm/master-jobs/6032839 --status disabled
rtk sentry alert issues edit master-timm/master-jobs/6032839 --status active
```

O CLI precisa de `alerts:write` para editar alertas; autenticar só com leitura
resulta em 403. Resolver uma issue de teste exige separadamente `event:write`.
Os tokens ficam no armazenamento de credenciais do CLI, nunca no repositório.
O alerta não cobre processos encerrados antes de enviar o evento, como o limite
de execução da Vercel; esse diagnóstico continua no
[runbook de timeouts](../operations.md#uma-tela-devolve-504-em-produção-e-só-às-vezes).

## O que confirmar depois de subir

1. `/login` responde e nenhuma outra rota responde sem sessão.
2. `/p/<slug>` de um perfil privado devolve **404**, não 403.
3. `jho jobs recheck status` a partir do laptop enxerga a mesma fila.
4. `/manifest.json`, `/sw.js`, `/icons/icon-192.png`,
   `/icons/icon-512.png` e `/icons/icon-maskable-512.png` respondem; os três PNGs
   decodificam nas dimensões declaradas no manifest — sem isso a PWA não instala.
5. `rtk pnpm check:deployed-css` passa contra produção: todos os marcadores da
   geração atual estão presentes e nenhuma assinatura obsoleta permanece.
6. Com uma PWA que já estava aberta antes do deploy, voltar do segundo plano
   com rede disponível provoca no máximo uma recarga e adota o visual novo sem
   limpar cache nem reinstalar. No aparelho físico, confirmar o piso protetor
   em retrato e, em paisagem baixa de telefone, a ausência da faixa artificial
   de 48px sem perder o inset real informado pelo sistema.
7. Com `RESEND_API_KEY`/`RESEND_FROM` configuradas em produção (G18: sem
   provedor real, o link não vai para lugar nenhum que este teste possa ler —
   em deployment o mailer omite, nunca imprime), pedir recuperação de senha
   para uma conta de teste e conferir no e-mail recebido que o link aponta
   para `jobs.mastertimm.com.br` — nunca para um `*.vercel.app` gerado nem
   para qualquer outro host. Sem provedor configurado, confirmar em vez disso
   que `JHO_PUBLIC_URL` está cadastrada em Production (tabela acima) — não
   basta ler `VERCEL_PROJECT_PRODUCTION_URL` no painel, porque isso não prova
   o que o runtime realmente recebeu.
