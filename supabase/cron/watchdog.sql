-- Vigia de cota (ADR 0030, Fase 3): pg_cron/pg_net do Supabase consultando a
-- API da Vercel e a do GitHub Actions DIRETAMENTE — nunca chamando
-- jobs.mastertimm.com.br. É a diferença de propósito com `varredura.sql`
-- (ADR 0025): um vigia hospedado no mesmo provedor que ele monitora não
-- reage quando esse provedor cai (ADR 0030 decisão 6), então este arquivo não
-- tem NENHUMA dependência de execução em Vercel ou GitHub além das próprias
-- APIs que ele lê — só Supabase e as APIs externas consultadas (F3-04).
--
-- O vigia NUNCA aplica mudança nenhuma sozinho (corte de escopo desta
-- entrega, `docs/operations.md`, "Vigia de cota: ativar"): toda decisão
-- `aviso`/`acao-recomendada` só grava a linha e abre/comenta uma issue com o
-- texto da recomendação e o comando de reversão. A coluna chama-se
-- `action_recommended`, não `action_taken` — a tabela não pode registrar uma
-- ação que não foi tomada.
--
-- A checagem manual equivalente, para testar sem esperar o `pg_cron`, é
-- `GET /api/cron/watchdog` (mesmo `CRON_SECRET` das outras rotas de cron) —
-- ela usa os MESMOS limiares e o MESMO dedupe
-- (`src/contexts/operations/domain/quota-watch.ts`, `decideQuotaWatch` e
-- `planAlert`), mas não é chamada por este arquivo, de propósito. Qualquer
-- mudança de limiar, de dedupe ou de mapeamento de status altera os dois no
-- mesmo commit (G62).
--
-- SÓ NO PROJETO SUPABASE DE PRODUÇÃO — mesma trava de `varredura.sql`,
-- reaproveitando `jho_cron_base_url` como sinal de "este é o projeto certo"
-- mesmo este arquivo nunca chamando essa URL.
--
-- NÃO é migração do Drizzle, de propósito: depende de `pg_cron`, `pg_net` e
-- do Supabase Vault, que o PostgreSQL local dos testes não tem — os testes
-- (`tests/quota-watch-sql-function.test.ts`) aplicam só os blocos de função
-- deste arquivo contra `net`/`vault` FALSOS, nunca as linhas de
-- `create extension`/`cron.schedule`. Quem aplica de verdade é uma pessoa, no
-- SQL Editor do projeto de produção (runbook em docs/operations.md).
-- Idempotente: reaplicar atualiza as funções e as agendas pelo nome.
--
-- Pré-requisitos (passo humano, uma vez):
--   1. Extensões pg_cron e pg_net habilitadas (já ligadas por varredura.sql,
--      se ela já foi aplicada; senão, as duas linhas `create extension`
--      abaixo bastam).
--   2. A migração do Drizzle que cria `production.quota_watch` já aplicada
--      em produção (`pnpm jho db migrate`, ou o deploy automático de main).
--   3. Um PAT do GitHub com escopo MÍNIMO `actions:read` (ler a fila de
--      runs) e `issues:write` (abrir/comentar) — sem `actions:write` nem
--      `variables:write`, porque este arquivo nunca escreve variável de
--      repositório nem dispara workflow. Um token de leitura da API da
--      Vercel (escopo leitura) e o project id do projeto `master-jobs`.
--      Premissa: um projeto Vercel e um repositório GitHub monitorados — o
--      `teamId` só entra se o token for de uma conta de time (Vercel Teams),
--      não de conta pessoal; deixe o segredo `watchdog_vercel_team_id` de
--      fora do Vault quando for conta pessoal.
--   4. No Vault, quatro segredos (regra 16 — o VALOR nunca entra neste
--      arquivo nem em commit):
--        select vault.create_secret('<PAT do passo 3>', 'watchdog_github_token');
--        select vault.create_secret('andreustimm/master-jobs', 'watchdog_github_repo');
--        select vault.create_secret('<token de leitura da Vercel>', 'watchdog_vercel_token');
--        select vault.create_secret('<project id da Vercel>', 'watchdog_vercel_project_id');
--      Time da Vercel (opcional): `watchdog_vercel_team_id`.

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
-- modelo de `varredura.sql`). Esta tabela guarda qual pedido é qual métrica —
-- ou, para o pedido de abrir issue, qual linha de `quota_watch` ele pertence
-- (`issue_open:<id>`), para `vigia_registrar_issue` gravar o número de volta.
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
  github_repo text := coalesce(nullif((select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_github_repo'), ''), 'andreustimm/master-jobs');
  vercel_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_vercel_token');
  vercel_project text := (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_vercel_project_id');
  vercel_team text := nullif((select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_vercel_team_id'), '');
  req bigint;
begin
  -- Pedido de uma rodada anterior que nunca foi coletado (a função de coleta
  -- não rodou, a resposta nunca chegou): não acumula lixo indefinidamente.
  -- `issue_open:%` tem prazo mais largo (até o registro seguinte, 10 min).
  delete from jho_cron.vigia_pendente where disparado_em < now() - interval '30 minutes' and metrica not like 'issue_open:%';
  delete from jho_cron.vigia_pendente where disparado_em < now() - interval '2 hours';

  if vercel_token is not null and vercel_project is not null then
    -- Concatenação inline (não numa variável): o alvo literal fica visível no
    -- próprio `url :=`, o que `tests/quota-watch-sql.test.ts` (F3-04) confere.
    req := net.http_get(
      url := 'https://api.vercel.com/v6/deployments?projectId=' || vercel_project
        || '&since=' || (extract(epoch from (now() - interval '24 hours')) * 1000)::bigint
        || '&limit=100'
        || coalesce('&teamId=' || vercel_team, ''),
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

  -- M2: o componente "Actions", não o indicador agregado da página — um
  -- incidente em Pages/Codespaces não pode acender o vigia do Actions. Sem
  -- autenticação: status público.
  req := net.http_get(url := 'https://www.githubstatus.com/api/v2/components.json', timeout_milliseconds := 10000);
  insert into jho_cron.vigia_pendente (request_id, metrica) values (req, 'actions_status');
end;
$$;
revoke all on function jho_cron.vigia_disparar() from public;

-- Passo 2 (coleta e decide): lê o que já respondeu, decide pelos mesmos
-- limiares de `decideQuotaWatch`, grava uma linha em `quota_watch` e, se
-- precisar, alerta com dedupe (M1) — nunca decide "ok" por uma métrica que
-- não respondeu, e uma métrica com JSON inesperado vira `null` sem derrubar
-- as outras (M3: cada parse tem seu próprio `exception when others`).
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
  streak_indisponivel int;
  alertavel boolean := false;
  alerta_gatilho text := null;
  prev_decisao text;
  prev_gatilho text;
  prev_issue integer;
  novo_id integer;
  corpo_issue text;
  req bigint;
  github_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_github_token');
  github_repo text := coalesce(nullif((select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_github_repo'), ''), 'andreustimm/master-jobs');
begin
  for pendente in
    select p.request_id, p.metrica
    from jho_cron.vigia_pendente p
    where p.disparado_em >= now() - interval '30 minutes' and p.metrica not like 'issue_open:%'
  loop
    select r.status_code, r.content into resp from net._http_response r where r.id = pendente.request_id;
    if resp.status_code is distinct from 200 or resp.content is null then
      continue; -- sem resposta (ainda) ou erro: a métrica fica null, nunca "ok" por omissão.
    end if;

    if pendente.metrica = 'vercel_deploys' then
      begin
        -- `deployments` ausente é resposta malformada — nunca "zero
        -- deployments" (F3-02). `?` testa a CHAVE, não o valor: só um corpo
        -- que realmente declara o array (mesmo vazio) conta como amostra.
        if (resp.content::jsonb) ? 'deployments' then
          vercel_deploys := jsonb_array_length((resp.content::jsonb) -> 'deployments');
        else
          vercel_deploys := null;
        end if;
      exception when others then
        vercel_deploys := null; -- JSON inesperado (ex.: `deployments` não é array) não derruba as outras métricas.
      end;
    elsif pendente.metrica = 'actions_queue' then
      begin
        -- `workflow_runs` ausente é resposta malformada — nunca "fila vazia".
        -- Presente e vazio, esse sim, é zero de verdade. Presente com runs
        -- mas nenhum com data legível: `max` sobre só nulos é nulo, e o
        -- `coalesce` NÃO entra aqui — só cobre a lista vazia, para não
        -- confundir "sem dado" com "zero".
        if not ((resp.content::jsonb) ? 'workflow_runs') then
          actions_wait_s := null;
        elsif jsonb_array_length((resp.content::jsonb) -> 'workflow_runs') = 0 then
          actions_wait_s := 0;
        else
          -- `run_started_at` só existe quando o runner já pegou o run; runs
          -- ainda `queued` não têm — `created_at` é o fallback (sempre existe).
          select max(extract(epoch from (
                   now() - coalesce((run.value ->> 'run_started_at'), (run.value ->> 'created_at'))::timestamptz
                 )))::int
            into actions_wait_s
          from jsonb_array_elements((resp.content::jsonb) -> 'workflow_runs') as run;
        end if;
      exception when others then
        actions_wait_s := null;
      end;
    elsif pendente.metrica = 'actions_status' then
      begin
        select case comp.value ->> 'status'
                 when 'operational' then 'none'
                 when 'under_maintenance' then 'none'
                 when 'degraded_performance' then 'minor'
                 when 'partial_outage' then 'major'
                 when 'major_outage' then 'critical'
                 else null
               end
          into actions_status
        from jsonb_array_elements((resp.content::jsonb) -> 'components') as comp
        where comp.value ->> 'name' = 'Actions'
        limit 1;
      exception when others then
        actions_status := null;
      end;
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
    decisao := 'acao-recomendada';
    alertavel := true;
    alerta_gatilho := gatilho;
    if gatilho = 'vercel' then
      -- DEPLOY_PREVIEW_ENVS é só registro (techspec); a alavanca real é
      -- pausar a promoção, sem depender do runner da Fase 2 existir.
      acao := 'recomendar gh workflow disable promover-para-staging.yml (pausa a promoção dev->staging)';
      reversao := 'gh workflow enable promover-para-staging.yml';
    else
      acao := 'recomendar gh variable set CI_RUNS_ON --body ''["self-hosted","master-jobs"]'' (só se o runner da Fase 2 já existir)';
      -- Apagar a variável devolve o ci.yml ao runner hospedado padrão, sem
      -- copiar aqui uma etiqueta do Ubuntu que envelhece (issue #468).
      reversao := 'gh variable delete CI_RUNS_ON';
    end if;
  elsif decisao = 'aviso' then
    alertavel := true;
    alerta_gatilho := gatilho;
  elsif decisao = 'indisponivel' then
    decisao := 'amostra-indisponivel';
    gatilho := null;
    -- M4: só alerta na 3ª checagem SEGUIDA (streak) em amostra-indisponivel —
    -- uma falha isolada de rede não abre issue.
    select count(*) into streak_indisponivel
    from (select decision from production.quota_watch order by id desc limit 2) s
    where s.decision = 'amostra-indisponivel';
    if streak_indisponivel >= 2 then
      alertavel := true;
      alerta_gatilho := null;
    end if;
  else
    gatilho := null;
  end if;

  -- M1: dedupe contra a linha imediatamente anterior — mesmo estado E mesmo
  -- gatilho, com issue conhecida, comenta em vez de abrir outra.
  select decision, trigger, issue_number into prev_decisao, prev_gatilho, prev_issue
  from production.quota_watch order by id desc limit 1;

  insert into production.quota_watch (
    checked_at, vercel_deploys_24h, actions_queue_max_wait_s, actions_status,
    decision, trigger, action_recommended, reversal_command, note, issue_number
  ) values (
    to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    vercel_deploys, actions_wait_s, actions_status,
    decisao, gatilho, acao, reversao, motivo,
    case when alertavel and prev_decisao = decisao and prev_gatilho is not distinct from alerta_gatilho and prev_issue is not null
         then prev_issue else null end
  )
  returning id into novo_id;

  if alertavel and github_token is not null then
    corpo_issue := motivo || case when acao is not null then E'\n\nRecomendação (nunca aplicada sozinha): ' || acao || E'\n\nReverter com:\n\n```\n' || reversao || E'\n```' else '' end;

    if prev_decisao = decisao and prev_gatilho is not distinct from alerta_gatilho and prev_issue is not null then
      -- Comentário: fogo e esquece, sem precisar da resposta.
      perform net.http_post(
        url := 'https://api.github.com/repos/' || github_repo || '/issues/' || prev_issue || '/comments',
        headers := jsonb_build_object(
          'accept', 'application/vnd.github+json',
          'authorization', 'Bearer ' || github_token,
          'content-type', 'application/json',
          'x-github-api-version', '2022-11-28'
        ),
        body := jsonb_build_object('body', 'Checagem se repete — ' || corpo_issue),
        timeout_milliseconds := 10000
      );
    else
      -- Issue nova: a resposta chega minutos depois, com o número. Guarda o
      -- pedido marcado com a linha que acabou de ser inserida — quem grava o
      -- número de volta é `vigia_registrar_issue` (passo 3).
      req := net.http_post(
        url := 'https://api.github.com/repos/' || github_repo || '/issues',
        headers := jsonb_build_object(
          'accept', 'application/vnd.github+json',
          'authorization', 'Bearer ' || github_token,
          'content-type', 'application/json',
          'x-github-api-version', '2022-11-28'
        ),
        body := jsonb_build_object(
          'title', 'Vigia de cota: ' || decisao || ' (' || coalesce(alerta_gatilho, 'amostra') || ')',
          'body', corpo_issue,
          'labels', jsonb_build_array('vigia-de-cota')
        ),
        timeout_milliseconds := 10000
      );
      insert into jho_cron.vigia_pendente (request_id, metrica) values (req, 'issue_open:' || novo_id);
    end if;
  end if;

  delete from jho_cron.vigia_pendente where metrica not like 'issue_open:%' and request_id in (
    select p.request_id from jho_cron.vigia_pendente p where p.disparado_em >= now() - interval '30 minutes' and p.metrica not like 'issue_open:%'
  );
end;
$$;
revoke all on function jho_cron.vigia_coletar() from public;

-- Passo 3 (registra o número da issue nova): lê a resposta do `http_post` de
-- abertura e grava `issue_number` na linha que motivou o alerta — sem isto, a
-- PRÓXIMA checagem não saberia em qual issue comentar (M1).
create or replace function jho_cron.vigia_registrar_issue()
returns void
language plpgsql
set search_path = ''
as $$
declare
  pendente record;
  resp record;
  linha_id integer;
  numero integer;
begin
  for pendente in
    select p.request_id, p.metrica
    from jho_cron.vigia_pendente p
    where p.metrica like 'issue_open:%' and p.disparado_em >= now() - interval '2 hours'
  loop
    select r.status_code, r.content into resp from net._http_response r where r.id = pendente.request_id;
    if resp.status_code is distinct from 201 or resp.content is null then
      continue; -- ainda sem resposta, ou o GitHub recusou: tenta de novo na próxima rodada, até expirar.
    end if;

    linha_id := split_part(pendente.metrica, ':', 2)::integer;
    begin
      numero := (resp.content::jsonb) ->> 'number';
    exception when others then
      numero := null;
    end;
    if numero is not null then
      update production.quota_watch set issue_number = numero where id = linha_id;
    end if;
    delete from jho_cron.vigia_pendente where request_id = pendente.request_id;
  end loop;
end;
$$;
revoke all on function jho_cron.vigia_registrar_issue() from public;

-- Agendas: dispara na hora cheia, coleta cinco minutos depois (pg_net
-- normalmente resolve em segundos, cinco minutos é folga larga), registra o
-- número da issue mais cinco minutos depois (a issue nova precisa ter sido
-- pedida por `vigia_coletar` primeiro).
select cron.unschedule(jobname) from cron.job where jobname in ('jho-vigia-disparar', 'jho-vigia-coletar', 'jho-vigia-registrar-issue');
select cron.schedule('jho-vigia-disparar', '0 * * * *', $$select jho_cron.vigia_disparar()$$);
select cron.schedule('jho-vigia-coletar', '5 * * * *', $$select jho_cron.vigia_coletar()$$);
select cron.schedule('jho-vigia-registrar-issue', '10 * * * *', $$select jho_cron.vigia_registrar_issue()$$);

-- Conferir (não altera nada):
--   select * from production.quota_watch order by id desc limit 10;
--   select jobname, schedule, active from cron.job where jobname like 'jho-vigia-%';
--
-- Desfazer:
--   select cron.unschedule(jobname) from cron.job where jobname like 'jho-vigia-%';
--   drop function if exists jho_cron.vigia_registrar_issue();
--   drop function if exists jho_cron.vigia_coletar();
--   drop function if exists jho_cron.vigia_disparar();
--   drop table if exists jho_cron.vigia_pendente;
--   e apagar os segredos do Vault (watchdog_*).
