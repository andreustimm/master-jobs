# PostgreSQL local com extensões do Supabase

O runtime do master-jobs usa PostgreSQL. Este Compose sobe apenas o banco, em
uma porta local separada, com a distribuição oficial `supabase/postgres` e as
extensões `pgmq` e `vector` habilitadas. Ele não sobe Auth, PostgREST, Studio,
Storage ou Realtime; para isso é necessário o stack completo do Supabase CLI.

## Subir

O banco local usa a porta `5433` para não disputar a `5432` da instância que já
existe na máquina:

```bash
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml ps
```

As URLs correspondentes são:

```bash
export DATABASE_URL=postgresql://supabase_admin:master_jobs_local_only@127.0.0.1:5433/master_jobs_local
export DATABASE_MIGRATION_URL="$DATABASE_URL"
pnpm jho db migrate
pnpm jho db seed
```

O Compose expõe somente `127.0.0.1`. A senha padrão é apenas para a máquina
local e pode ser substituída por `LOCAL_POSTGRES_PASSWORD` em um `.env` não
versionado.

## Carregar uma cópia sanitizada de produção

Para testar com dados representativos, use o snapshot SQLite produzido pelo
exportador de migração. O importador aplica as migrations, exige um destino em
loopback e carrega somente a seleção revisada de produção: usuários e decisões
do funil, o perfil, empresas e vagas referenciadas. Sessões, tokens, filas de
crawler, HTML e payloads brutos de scraping ficam fora. O arquivo do snapshot
deve permanecer fora do Git.

O alvo precisa estar vazio. Para trocar a fixture, pare o Compose e remova
somente o volume local antes de subir novamente:

```bash
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml up -d
export DATABASE_URL=postgresql://supabase_admin:master_jobs_local_only@127.0.0.1:5433/master_jobs_local
export DATABASE_MIGRATION_URL="$DATABASE_URL"
pnpm db:import-local --source data/migration/production-YYYYMMDD.db
```

O comando calcula o hash do arquivo, seleciona os dados dentro de uma
transação SQLite, verifica que o snapshot não mudou, executa as migrations e
valida contagens e hashes no PostgreSQL antes de confirmar a carga. Ele recusa
URLs remotas, portanto não é um mecanismo de sincronização com produção. A
fonte Turso original continua sendo o backup de corte; gere uma nova fixture
quando precisar reproduzir outro estado.

## Recomeçar o acervo local

Depois de `down -v`, escolha uma única fonte para preencher o banco vazio:

```bash
# Opção A: fixture sanitizada do snapshot de produção
pnpm db:import-local --source data/migration/production-YYYYMMDD.db

# Opção B: buscar novamente as fontes públicas e pontuar as vagas
pnpm jho jobs sync
```

O reset do volume é deliberadamente amplo: remove também contas, candidaturas
e tarefas locais. Se essas decisões ainda forem necessárias, não apague vagas
com SQL; preserve o histórico ou importe novamente a fixture que as contém.
O `jobs sync` é permitido somente no ambiente local e consulta as fontes
públicas configuradas; ele não faz scraping de LinkedIn nem é executado por
dev/staging.

## Verificar PGMQ e pgvector

As extensões são criadas somente na primeira inicialização do volume. Para
repetir o teste sem alterar a aplicação:

```bash
docker compose -f docker-compose.local.yml exec -T db \
  psql -U supabase_admin -d master_jobs_local -f /docker/verify.sql
```

O script confirma a versão do PostgreSQL, as versões de `pgmq` e `vector`, e a
lista de filas. A aplicação continua usando `scrape_task`, `verify_task` e
`score_task` como filas transacionais; instalar PGMQ não troca o adapter por
baixo do worker. A troca para PGMQ precisa ser uma tarefa própria com
`QueuePort`, idempotência e teste de retry.

Para testar a semântica de uma fila sem deixá-la no ambiente:

```bash
docker compose -f docker-compose.local.yml exec -T db psql -U supabase_admin -d master_jobs_local <<'SQL'
SELECT pgmq.create('local_smoke');
SELECT * FROM pgmq.send('local_smoke', '{"ok":true}'::jsonb);
SELECT * FROM pgmq.read('local_smoke', 30, 10);
SELECT pgmq.drop_queue('local_smoke');
SQL
```

Use filas logadas (o padrão) para ter durabilidade comparável à fila gerenciada.
Filas `UNLOGGED` podem perder mensagens e não devem ser usadas para scraping ou
decisões de candidatura.

## pgvector sem inflar o catálogo

`vector` está disponível para uma futura busca semântica, mas não deve receber
HTML bruto nem cada captura de crawler. Quando houver uma necessidade medida,
crie uma tabela de embeddings separada com `job_id`, modelo, dimensão, versão
do scorer e timestamps. O texto normalizado e as decisões de candidatura
continuam sendo os dados duráveis.

## Parar e resetar

```bash
docker compose -f docker-compose.local.yml down
```

Esse comando preserva o volume. Para apagar o banco local e iniciar do zero,
use `down -v`; isso é destrutivo e nunca deve ser usado com dados de produção.

## Paridade com Supabase gerenciado

Há paridade de PostgreSQL e das extensões, não de toda a plataforma. O banco
local não tem backups/PITR, pooler, limites de plano, RLS configurado pelo
projeto ou os serviços HTTP do Supabase. O tag da imagem é fixado para tornar o
teste repetível; `LOCAL_POSTGRES_IMAGE` permite testar outro tag após verificar
`CREATE EXTENSION pgmq` e `CREATE EXTENSION vector` do zero. O padrão é
`supabase/postgres:17.6.1.171`, na mesma linha major/minor observada no
Supabase de produção (`17.6.1.166`). A inicialização cria os papéis de
bootstrap esperados pela imagem antes de habilitar as extensões. Se o patch da
imagem mudar, destrua o volume e repita o smoke test antes de atualizar o
valor versionado.
