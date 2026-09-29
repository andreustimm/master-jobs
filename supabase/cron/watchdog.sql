-- Vigia de cota (ADR 0030, Fase 3): pg_cron/pg_net do Supabase consultando a
-- API da Vercel e a do GitHub Actions DIRETAMENTE — nunca chamando
-- jobs.mastertimm.com.br. É a diferença de propósito com `varredura.sql`
-- (ADR 0025): um vigia hospedado no mesmo provedor que ele monitora não
-- reage quando esse provedor cai (ADR 0030 decisão 6), então este arquivo não
-- tem NENHUMA dependência de execução em Vercel ou GitHub além das próprias
-- APIs que ele lê — só Supabase e as APIs externas consultadas (F3-04).
--
-- A checagem manual equivalente, para testar sem esperar o `pg_cron`, é
-- `GET /api/cron/watchdog` (mesmo `CRON_SECRET` das outras rotas de cron) —
-- ela usa os MESMOS limiares (`src/contexts/operations/domain/quota-watch.ts`,
-- `decideQuotaWatch`), mas não é chamada por este arquivo, de propósito. Os
-- limiares abaixo espelham essa função; qualquer mudança de limiar altera as
-- duas no mesmo commit (G62).
--
-- SÓ NO PROJETO SUPABASE DE PRODUÇÃO — mesma trava de `varredura.sql`,
-- reaproveitando `jho_cron_base_url` como sinal de "este é o projeto certo"
-- mesmo este arquivo nunca chamando essa URL.
--
-- NÃO é migração do Drizzle, de propósito: depende de `pg_cron`, `pg_net` e
-- do Supabase Vault, que o PostgreSQL local dos testes não tem. Quem aplica é
-- uma pessoa, no SQL Editor do projeto de produção (runbook em
-- docs/operations.md, "Vigia de cota: ativar"). Idempotente: reaplicar
-- atualiza as funções e as agendas pelo nome.
--
-- Pré-requisitos (passo humano, uma vez):
--   1. Extensões pg_cron e pg_net habilitadas (já ligadas por varredura.sql,
--      se ela já foi aplicada; senão, as duas linhas `create extension`
--      abaixo bastam).
--   2. A migração do Drizzle que cria `production.quota_watch` já aplicada
--      em produção (`pnpm jho db migrate`, ou o deploy automático de main).
--   3. No Vault, quatro segredos (regra 16 — o VALOR nunca entra neste
--      arquivo nem em commit):
--        select vault.create_secret('<PAT com repo:issues e leitura de actions:read>', 'watchdog_github_token');
--        select vault.create_secret('andreustimm/master-jobs', 'watchdog_github_repo');
--        select vault.create_secret('<token de leitura da API da Vercel>', 'watchdog_vercel_token');
--        select vault.create_secret('<project id do projeto na Vercel>', 'watchdog_vercel_project_id');
--   4. Opcional, e só depois de confirmar que a Fase 2 (runner selecionável)
--      está viva em produção — sem isto o vigia sempre abre a issue e grava a
--      linha, mas NUNCA aplica a variável de verdade, só recomenda o comando
--      (ADR 0030 princípio 2, "nada ativa por omissão"):
--        select vault.create_secret('true', 'watchdog_auto_apply');

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'jho_cron_base_url'), '')
     <> 'https://jobs.mastertimm.com.br' then
    raise exception 'watchdog.sql só se aplica ao projeto Supabase de produção (jho_cron_base_url precisa ser https://jobs.mastertimm.com.br)';
  end if;
end
$$;

create schema if not exists jho_cron;
revoke all on schema jho_cron from public;

-- `pg_net` é assíncrono: `http_get`/`http_post` devolvem o id do pedido na
-- hora, e a resposta chega minutos depois em `net._http_response` (mesmo
-- modelo de `varredura.sql`). Esta tabela guarda qual pedido é qual métrica,
-- para o passo de coleta não precisar adivinhar pelo conteúdo da resposta.
create table if not exists jho_cron.vigia_pendente (
  request_id bigint primary key,
  metrica text not null,
  disparado_em timestamptz not null default now()
);
revoke all on table jho_cron.vigia_pendente from public;

-- Passo 1 (dispara): as três leituras, fogo e esquece. Faltando um segredo, a
-- métrica correspondente simplesmente não é pedida — o passo 2 trata a
-- ausência de resposta como "amostra indisponível" (F3-02), nunca como "ok".
create or replace function jho_cron.vigia_disparar()
returns void
language plpgsql
set search_path = ''
as $$
declare
  github_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_github_token');
  github_repo text := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_github_repo'), 'andreustimm/master-jobs');
  vercel_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_vercel_token');
  vercel_project text := (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_vercel_project_id');
  req bigint;
begin
  -- Pedido de uma rodada anterior que nunca foi coletado (a função de coleta
  -- não rodou, a resposta nunca chegou): não acumula lixo indefinidamente.
  delete from jho_cron.vigia_pendente where disparado_em < now() - interval '30 minutes';

  if vercel_token is not null and vercel_project is not null then
    req := net.http_get(
      url := 'https://api.vercel.com/v6/deployments?projectId=' || vercel_project
        || '&since=' || (extract(epoch from (now() - interval '24 hours')) * 1000)::bigint
        || '&limit=100',
      headers := jsonb_build_object('authorization', 'Bearer ' || vercel_token),
      timeout_milliseconds := 10000
    );
    insert into jho_cron.vigia_pendente (request_id, metrica) values (req, 'vercel_deploys');
  end if;

  if github_token is not null then
    req := net.http_get(
      url := 'https://api.github.com/repos/' || github_repo || '/actions/runs?status=queued&per_page=100',
      headers := jsonb_build_object(
        'accept', 'application/vnd.github+json',
        'authorization', 'Bearer ' || github_token,
        'x-github-api-version', '2022-11-28'
      ),
      timeout_milliseconds := 10000
    );
    insert into jho_cron.vigia_pendente (request_id, metrica) values (req, 'actions_queue');
  end if;

  -- Sem autenticação: status público da plataforma, sempre pedido.
  req := net.http_get(url := 'https://www.githubstatus.com/api/v2/status.json', timeout_milliseconds := 10000);
  insert into jho_cron.vigia_pendente (request_id, metrica) values (req, 'actions_status');
end;
$$;
revoke all on function jho_cron.vigia_disparar() from public;

-- Passo 2 (coleta e decide): lê o que já respondeu, decide pelos mesmos
-- limiares de `decideQuotaWatch`, grava uma linha em `quota_watch` e, se
-- precisar, alerta. Nunca decide "ok" por uma métrica que não respondeu.
create or replace function jho_cron.vigia_coletar()
returns void
language plpgsql
set search_path = ''
as $$
declare
  vercel_deploys integer := null;
  actions_wait_s integer := null;
  actions_status text := null;
  pendente record;
  resp record;
  vercel_estado text; -- ok | aviso | acao | indisponivel
  actions_estado text;
  gatilho text;
  motivo text;
  decisao text;
  acao text := null;
  reversao text := null;
  github_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_github_token');
  github_repo text := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_github_repo'), 'andreustimm/master-jobs');
  auto_apply boolean := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_auto_apply'), '') = 'true';
begin
  for pendente in
    select p.request_id, p.metrica
    from jho_cron.vigia_pendente p
    where p.disparado_em >= now() - interval '30 minutes'
  loop
    select r.status_code, r.content into resp from net._http_response r where r.id = pendente.request_id;
    if resp.status_code is distinct from 200 or resp.content is null then
      continue; -- sem resposta (ainda) ou erro: a métrica fica null, nunca "ok" por omissão.
    end if;

    if pendente.metrica = 'vercel_deploys' then
      vercel_deploys := jsonb_array_length(coalesce((resp.content::jsonb) -> 'deployments', '[]'::jsonb));
    elsif pendente.metrica = 'actions_queue' then
      select coalesce(max(extract(epoch from (now() - (run.value ->> 'created_at')::timestamptz)))::int, 0)
        into actions_wait_s
      from jsonb_array_elements(coalesce((resp.content::jsonb) -> 'workflow_runs', '[]'::jsonb)) as run;
    elsif pendente.metrica = 'actions_status' then
      actions_status := (resp.content::jsonb) -> 'status' ->> 'indicator';
    end if;
  end loop;

  -- vercel: 70 %/90 % de 100 deploys/dia (DEFAULT_QUOTA_THRESHOLDS).
  if vercel_deploys is null then
    vercel_estado := 'indisponivel';
  elsif vercel_deploys >= 90 then
    vercel_estado := 'acao';
  elsif vercel_deploys >= 70 then
    vercel_estado := 'aviso';
  else
    vercel_estado := 'ok';
  end if;

  -- actions: major/critical já é ação; minor é aviso; senão, fila em minutos.
  if actions_status in ('major', 'critical') then
    actions_estado := 'acao';
  elsif actions_wait_s is null and actions_status is null then
    actions_estado := 'indisponivel';
  elsif actions_status = 'minor' then
    actions_estado := 'aviso';
  elsif actions_wait_s is null then
    actions_estado := 'indisponivel';
  elsif actions_wait_s >= 1200 then -- 20 min
    actions_estado := 'acao';
  elsif actions_wait_s >= 600 then -- 10 min
    actions_estado := 'aviso';
  else
    actions_estado := 'ok';
  end if;

  -- O pior dos dois vence: acao > aviso > indisponivel > ok — mesma ordem de
  -- RANK em decideQuotaWatch. Em empate, vercel decide (ordem estável).
  motivo := format('vercel_deploys_24h=%s actions_queue_max_wait_s=%s actions_status=%s', vercel_deploys, actions_wait_s, actions_status);
  if array_position(array['ok', 'indisponivel', 'aviso', 'acao'], actions_estado)
       > array_position(array['ok', 'indisponivel', 'aviso', 'acao'], vercel_estado) then
    decisao := actions_estado;
    gatilho := 'actions';
  else
    decisao := vercel_estado;
    gatilho := 'vercel';
  end if;

  if decisao = 'acao' then
    decisao := 'acao-automatica';
    if gatilho = 'vercel' then
      acao := 'recomendar gh variable set DEPLOY_PREVIEW_ENVS --body ""';
      reversao := 'gh variable set DEPLOY_PREVIEW_ENVS --body "<valor anterior>"';
    else
      acao := 'recomendar gh variable set CI_RUNS_ON --body ''["self-hosted","master-jobs"]''';
      reversao := 'gh variable set CI_RUNS_ON --body ''"ubuntu-latest"''';
    end if;
  elsif decisao = 'indisponivel' then
    decisao := 'amostra-indisponivel';
  end if;

  insert into production.quota_watch (
    checked_at, vercel_deploys_24h, actions_queue_max_wait_s, actions_status,
    decision, action_taken, reversal_command, note
  ) values (
    to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    vercel_deploys, actions_wait_s, actions_status,
    decisao, acao, reversao, motivo
  );

  -- Alertar nunca é silencioso (ADR 0030 decisão 7): aviso e ação automática
  -- sempre tentam abrir a issue, fogo e esquece — a linha acima já é a fonte
  -- de verdade, com ou sem a issue.
  if decisao in ('aviso', 'acao-automatica') and github_token is not null then
    perform net.http_post(
      url := 'https://api.github.com/repos/' || github_repo || '/issues',
      headers := jsonb_build_object(
        'accept', 'application/vnd.github+json',
        'authorization', 'Bearer ' || github_token,
        'content-type', 'application/json',
        'x-github-api-version', '2022-11-28'
      ),
      body := jsonb_build_object(
        'title', 'Vigia de cota: ' || decisao || ' (' || gatilho || ')',
        'body', motivo || case when acao is not null then E'\n\nAção recomendada: ' || acao || E'\n\nReverter com:\n\n```\n' || reversao || E'\n```' else '' end,
        'labels', jsonb_build_array('vigia-de-cota')
      ),
      timeout_milliseconds := 10000
    );
  end if;

  -- "Vira a chave sozinho" (aplicar `gh variable set` de verdade, não só
  -- recomendar) fica FORA deste arquivo, de propósito. `pg_net` só oferece
  -- `http_get`/`http_post`/`http_delete` — a API do GitHub exige `PATCH`
  -- para atualizar uma variável existente, e simular `PATCH` sem o método
  -- real é o tipo de gambiarra que falha em silêncio no adapter errado.
  -- `watchdog_auto_apply` (Vault) fica reservado para quando essa aplicação
  -- for implementada — hoje ela não faz nada, e o vigia SEMPRE só recomenda
  -- (`action_taken`/`reversal_command` na linha) e alerta, nunca aplica.
  -- `auto_apply` continua lido acima para o runbook decidir o segredo com
  -- antecedência, sem precisar reaplicar este arquivo quando o dia chegar.

  delete from jho_cron.vigia_pendente where request_id in (
    select p.request_id from jho_cron.vigia_pendente p where p.disparado_em >= now() - interval '30 minutes'
  );
end;
$$;
revoke all on function jho_cron.vigia_coletar() from public;

-- Agendas: dispara na hora cheia, coleta cinco minutos depois — pg_net
-- normalmente resolve em segundos, cinco minutos é folga larga.
select cron.unschedule(jobname) from cron.job where jobname in ('jho-vigia-disparar', 'jho-vigia-coletar');
select cron.schedule('jho-vigia-disparar', '0 * * * *', $$select jho_cron.vigia_disparar()$$);
select cron.schedule('jho-vigia-coletar', '5 * * * *', $$select jho_cron.vigia_coletar()$$);

-- Conferir (não altera nada):
--   select * from production.quota_watch order by checked_at desc limit 10;
--   select jobname, schedule, active from cron.job where jobname like 'jho-vigia-%';
--
-- Desfazer:
--   select cron.unschedule(jobname) from cron.job where jobname like 'jho-vigia-%';
--   drop function if exists jho_cron.vigia_coletar();
--   drop function if exists jho_cron.vigia_disparar();
--   drop table if exists jho_cron.vigia_pendente;
--   e apagar os segredos do Vault (watchdog_*).
