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

Duas saídas, e a escolha é de custo:

- **Cron da Vercel chamando uma rota que processa um lote pequeno.** É o que o
  `vercel.json` prevê: uma chamada por dia que consome parte da fila. Simples,
  cabe no plano gratuito, e leva dias para vencer uma fila grande.
- **Continuar rodando o runner fora da Vercel.** O GitHub Actions aponta para o
  PostgreSQL de produção por secret e tem até seis horas por job; localmente,
  o mesmo worker aponta para a instância Docker isolada. Nenhuma captura longa
  deve ficar presa ao limite de uma função Edge.

### 3. `profile.yaml` e `sources.yaml` são lidos do disco em runtime

`loadProfile()` e `loadSourcesConfig()` fazem `readFile` sobre `process.cwd()`.
Os dois arquivos estão versionados e entram no pacote, mas o Turbopack avisa que
o acesso dinâmico ao sistema de arquivos "causa o rastreamento do projeto
inteiro" — é como eles acabam incluídos, e é frágil.

`JHO_PROFILE_PATH` e `JHO_SOURCES_PATH` existem e permitem apontar para outro
lugar. Enquanto os dois arquivos forem versionados, o padrão funciona.

## Variáveis

| Variável | Onde | Para quê |
|---|---|---|
| `DATABASE_URL` | aplicação | URL PostgreSQL de runtime; vence as demais |
| `POSTGRES_URL` | Vercel (integração) | usada no runtime quando não há `DATABASE_URL` |
| `DATABASE_MIGRATION_URL` | migration/CI | URL PostgreSQL com privilégio de DDL |
| `POSTGRES_URL_NON_POOLING` | Vercel (integração) | usada na migration quando não há a de cima |
| `DATABASE_CA_CERT` | CI/Vercel | o PEM da CA **ou** o caminho de um arquivo |
| `SUPABASE_CRAWL_ENABLED` | Actions produção | `true` somente após os gates de quota/retensão |
| `RESEND_API_KEY` | Vercel | e-mail transacional; sem ela o link vai para o log |
| `RESEND_FROM` | Vercel | remetente de domínio verificado |
| `CRON_SECRET` | Vercel | protege a rota de cron; a Vercel a envia em `authorization` |

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
descartados, porque a configuração do cliente já é explícita. Parâmetros de TLS
(`sslmode`, `ssl`, `sslrootcert`…) são **recusados** com erro, e não apagados em
silêncio: a política de TLS é do cliente, e apagar `sslmode=disable` deixaria
quem escreveu convencido de que desligou a verificação.

**`DATABASE_CA_CERT` aceita as duas formas:** o PEM colado direto na variável
(o gesto natural num painel serverless, onde não há onde pôr arquivo) ou o
caminho de um arquivo. O repositório versiona `config/certs/supabase-ca.crt` e o
`next.config.ts` o declara em `outputFileTracingIncludes` para ele viajar no
bundle. Valor que não é nenhum dos dois falha nomeando a variável.

`RESEND_API_KEY` e `RESEND_FROM` formam um par: se qualquer uma estiver ausente
ou vazia, `configuredMailer` usa o adapter de console e nenhum e-mail é enviado.
O operador cria a chave no Resend, verifica o domínio e cadastra os dois valores
diretamente no ambiente da Vercel. Os valores reais não devem ser copiados para
`.env.example`, documentação, logs ou commits.

O suporte ao Gmail também está completo no código, mas a ativação pertence ao
operador: criar `GMAIL_CLIENT_ID` e `GMAIL_CLIENT_SECRET` no Google Cloud,
configurá-los fora do Git e executar `jho mail auth`. O escopo solicitado é
somente `gmail.readonly`; a ausência dessas credenciais não desativa a importação
manual de `.eml`.

**`JHO_AUTH_MODE` não deve existir em produção.** Com `open`, o sistema sintetiza
uma sessão e serve currículo, funil e export para qualquer requisição. É modo de
desenvolvimento local e num endereço público é o vazamento inteiro.

## Os três ambientes

Um banco por ambiente, no grupo `master-jobs` em `aws-us-east-1` — a mesma
região das funções da Vercel (`iad1`), para o round-trip não atravessar o país.

| Branch | Endereço | Banco | Ambiente Vercel |
|---|---|---|---|
| `main` | `jobs.mastertimm.com.br` | Supabase produção (`production`) | Production |
| `staging` | `jobs-staging.mastertimm.com.br` | fixture PostgreSQL isolada (provisionamento pendente) | Preview |
| `dev` | `jobs-dev.mastertimm.com.br` | fixture PostgreSQL isolada (provisionamento pendente) | Preview |
| — | local | PostgreSQL Docker isolado (`127.0.0.1:5432`) | Development |

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
pública também toda URL de preview de PR.

## A varredura diária

> **Pausa operacional:** o workflow permanece opt-in até concluir o corte para
> Supabase, a importação seletiva e os gates de retenção. O incidente Turso de
> 03/09/2026 é apenas o diagnóstico histórico; consulte os
> [gates documentados](../operations/turso-quota-incident-2026-09-03.md).

Quando habilitado, `.github/workflows/varredura.yml` roda `jobs sync`, `scrape
queue`+`run` e `jobs recheck queue`+`run` contra **produção**, todo dia às
06:00 UTC (03:00 em São Paulo), com `workflow_dispatch` para rodar à mão depois
de mexer em `config/sources.yaml`.

**Por que no GitHub e não na Vercel.** A Vercel tem `/api/cron/recheck`, e ele
resolve um pedaço pequeno: 25 vagas por execução, porque o teto de função no
plano gratuito é de 30 segundos. Com 427 vagas elegíveis (fit ≥ 55, abertas, com
URL), o ciclo completo leva ~17 dias — enquanto `enqueueStale` declara a meta de
reconferir a cada 7. O cron de lá entrega menos da metade do que promete, e não
por defeito: por teto.

E a **busca** não roda lá de jeito nenhum: `jobs sync` e `scrape run` não têm
rota de API. Um runner do GitHub tem 6 horas por job, e é a mesma tarefa num
lugar onde ela cabe. A rota da Vercel servia como rede de segurança, mas não
deve voltar junto com o Actions sem orçamento e responsabilidade distintos.

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
no push das três branches. `migrate.yml` aplica migrações somente em produção,
por `workflow_dispatch`, depois de confirmar o project ref do Supabase. As
migrations de `dev` e `staging` ficam desativadas até existirem bancos de
fixture isolados. Esta configuração não pausa os deployments da Vercel.

**A Vercel implanta no push, independente do CI.** As duas coisas disparam do
mesmo evento e não se conhecem: sem proteção de branch em `main` exigindo o CI
verde, o workflow vermelho não impede o deploy. O portão existe, mas só fecha
depois que alguém liga a proteção em Settings → Branches.

O segredo usado por `migrate.yml` é `SUPABASE_MIGRATION_URL`; o workflow valida o
project ref antes de abrir a conexão.

## Migrar o banco

```bash
export DATABASE_MIGRATION_URL="postgresql://..."
pnpm jho db migrate
DATABASE_URL="$DATABASE_MIGRATION_URL" pnpm jho db check
```

Em produção, o caminho aprovado é o workflow manual `migrate.yml`, com
`confirm_project=bujawvnxwtmneiggizje`. A migration deve ser aplicada e
verificada antes da importação de dados; o workflow recusa outro project ref.

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
