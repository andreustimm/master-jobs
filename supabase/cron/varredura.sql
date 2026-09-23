-- Varredura horária na Vercel, agendada pelo pg_cron do Supabase (ADR 0025).
--
-- NÃO é migração do Drizzle, de propósito: depende de `pg_cron`, `pg_net` e do
-- Supabase Vault, que o PostgreSQL local dos testes não tem, e de um segredo
-- que nenhum arquivo versionado pode carregar. Quem aplica é uma pessoa, no SQL
-- Editor do projeto de produção, seguindo o runbook de `docs/operations.md`
-- ("Varredura horária: ativar o agendador"). O arquivo é idempotente: rodar de
-- novo atualiza a função e as agendas pelo nome.
--
-- Pré-requisitos (passo humano, uma vez):
--   1. Extensões `pg_cron` e `pg_net` habilitadas (Dashboard → Integrations,
--      ou as duas linhas `create extension` abaixo).
--   2. No Vault, dois segredos:
--        select vault.create_secret('<o mesmo valor de CRON_SECRET na Vercel>', 'jho_cron_secret');
--        select vault.create_secret('https://jobs.mastertimm.com.br', 'jho_cron_base_url');
--      O valor do segredo NUNCA entra neste arquivo nem em commit.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schema próprio e fora da Data API. Uma função em `public` viraria RPC do
-- PostgREST, e qualquer um com a chave anônima dispararia a varredura com o
-- nosso segredo.
create schema if not exists jho_cron;
revoke all on schema jho_cron from public;

-- Uma chamada assíncrona: `pg_net` enfileira e devolve o id do pedido; a
-- resposta aparece em `net._http_response`. O timeout de 30 s é o teto da
-- função da Vercel — esperar mais que isso só mediria o nada.
create or replace function jho_cron.chamar_fatia(fatia text)
returns bigint
language sql
set search_path = ''
as $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'jho_cron_base_url')
      || '/api/cron/varredura?fatia=' || fatia,
    headers := jsonb_build_object(
      'authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jho_cron_secret')
    ),
    timeout_milliseconds := 30000
  );
$$;
revoke all on function jho_cron.chamar_fatia(text) from public;

-- As agendas. Cada fatia se limita sozinha — fonte no máximo a cada 45 min,
-- candidato a cada 10 —, então chamar com folga só custa uma resposta vazia.
-- Minutos desencontrados para duas fatias pesadas não caírem juntas.
--
-- sync: 30 chamadas/h para ~48 fontes; cada chamada sincroniza as que couberem
-- em 20 s, a mais antiga primeiro. Meta: toda fonte a cada ≤ 60 min.
select cron.schedule('jho-varredura-sync', '*/2 * * * *', $$select jho_cron.chamar_fatia('sync')$$);
-- pontuar: vaga nova ganha nota para todo candidato em ~10 min.
select cron.schedule('jho-varredura-pontuar', '*/5 * * * *', $$select jho_cron.chamar_fatia('pontuar')$$);
-- repontuar: a fila de quem salvou currículo ou mexeu em trilha (ADR 0026).
-- Minutos ímpares: a fatia do `after()` já atende quem salvou; esta termina o
-- que não coube nela, em até dois minutos.
select cron.schedule('jho-varredura-repontuar', '1-59/2 * * * *', $$select jho_cron.chamar_fatia('repontuar')$$);
-- reconferencia: o ÚNICO agendador da reconferência depois da troca.
select cron.schedule('jho-varredura-reconferencia', '3,13,23,33,43,53 * * * *', $$select jho_cron.chamar_fatia('reconferencia')$$);
-- captura: quatro páginas por chamada, uma por host.
select cron.schedule('jho-varredura-captura', '7,17,27,37,47,57 * * * *', $$select jho_cron.chamar_fatia('captura')$$);
-- termos: as capturas por termo do dia, dentro da cota de cada plataforma.
select cron.schedule('jho-varredura-termos', '9,19,29,39,49,59 * * * *', $$select jho_cron.chamar_fatia('termos')$$);

-- Conferir (não altera nada):
--   select jobname, schedule, active from cron.job where jobname like 'jho-varredura-%';
--   select status_code, created, left(content::text, 200) from net._http_response order by created desc limit 20;
--
-- Desfazer (volta tudo para o GitHub Actions diário):
--   select cron.unschedule(jobname) from cron.job where jobname like 'jho-varredura-%';
--   e apagar a variável de repositório VARREDURA_AGENDADOR.
