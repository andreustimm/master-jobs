import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/core/db/client.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * M3 — as funções de `supabase/cron/watchdog.sql` rodam de verdade contra o
 * PostgreSQL local, com `net`/`vault` FALSOS (stubs controlados pelo teste),
 * nunca `pg_cron`/`pg_net` de verdade (que o PostgreSQL local não tem).
 *
 * Só os blocos de `create schema`/`create table`/`create or replace function`
 * são extraídos e aplicados — nunca `create extension`, a trava de ambiente
 * (`do $$ ... jho_cron_base_url ...`) nem `cron.schedule`, que dependem de
 * extensões reais. F3-01 (limiares) e F3-02 (amostra ausente nunca "ok") são
 * provados aqui contra a função de verdade, não só a réplica em TypeScript.
 */

const WATCHDOG_SQL = readFileSync("supabase/cron/watchdog.sql", "utf8");

function extractBlock(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  if (start === -1) throw new Error(`marcador de início não encontrado: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  if (end === -1) throw new Error(`marcador de fim não encontrado: ${endMarker}`);
  return text.slice(start, end + endMarker.length);
}

const SCHEMA_BLOCK = extractBlock(WATCHDOG_SQL, "create schema if not exists jho_cron;", "revoke all on schema jho_cron from public;");
const PENDENTE_TABLE = extractBlock(
  WATCHDOG_SQL,
  "create table if not exists jho_cron.vigia_pendente",
  "revoke all on table jho_cron.vigia_pendente from public;",
);
const DISPARAR_FN = extractBlock(
  WATCHDOG_SQL,
  "create or replace function jho_cron.vigia_disparar()",
  "revoke all on function jho_cron.vigia_disparar() from public;",
);
const COLETAR_FN = extractBlock(
  WATCHDOG_SQL,
  "create or replace function jho_cron.vigia_coletar()",
  "revoke all on function jho_cron.vigia_coletar() from public;",
);
const REGISTRAR_FN = extractBlock(
  WATCHDOG_SQL,
  "create or replace function jho_cron.vigia_registrar_issue()",
  "revoke all on function jho_cron.vigia_registrar_issue() from public;",
);

/**
 * `net`/`vault` de mentira: `http_get`/`http_post` respondem na hora (o teste
 * não espera nenhum worker assíncrono) a partir de `test_stub_responses`,
 * casada pelo prefixo mais específico da URL pedida. Toda chamada de
 * `http_post` também fica registrada em `test_stub_posts`, para o teste
 * confirmar QUAL rota foi chamada (dedupe do M1).
 */
const STUB_SCHEMA = `
create schema if not exists net;
create schema if not exists vault;

create sequence if not exists net.request_id_seq;
create table if not exists net._http_response (
  id bigint primary key,
  status_code int,
  content text,
  created timestamptz not null default now()
);
create table if not exists test_stub_responses (
  url_prefix text primary key,
  status_code int not null,
  content text not null
);
create table if not exists test_stub_posts (
  id bigserial primary key,
  url text not null,
  body jsonb,
  created timestamptz not null default now()
);
create table if not exists vault.decrypted_secrets (
  name text primary key,
  decrypted_secret text
);

-- search_path totalmente qualificado: quem chama (jho_cron.vigia_*) roda com
-- search_path = '', e essa configuração vale para toda a cadeia de chamada —
-- inclusive estes stubs. Sem o prefixo public., a tabela de resposta canned
-- "some" dentro da função real.
create or replace function net.http_get(url text, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
returns bigint language plpgsql as $stub$
declare
  req_id bigint := nextval('net.request_id_seq');
  found record;
begin
  select r.status_code, r.content into found
  from public.test_stub_responses r
  where url like (r.url_prefix || '%')
  order by length(r.url_prefix) desc
  limit 1;
  insert into net._http_response (id, status_code, content) values (req_id, coalesce(found.status_code, 599), coalesce(found.content, ''));
  return req_id;
end;
$stub$;

create or replace function net.http_post(url text, headers jsonb default '{}'::jsonb, body jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
returns bigint language plpgsql as $stub$
declare
  req_id bigint := nextval('net.request_id_seq');
  found record;
begin
  insert into public.test_stub_posts (url, body) values (url, body);
  select r.status_code, r.content into found
  from public.test_stub_responses r
  where url like (r.url_prefix || '%')
  order by length(r.url_prefix) desc
  limit 1;
  insert into net._http_response (id, status_code, content)
    values (req_id, coalesce(found.status_code, 201), coalesce(found.content, '{"number": 999}'));
  return req_id;
end;
$stub$;
`;

async function exec(text: string): Promise<void> {
  await getDb().execute(sql.raw(text));
}

async function seedSecret(name: string, value: string): Promise<void> {
  await exec(`insert into vault.decrypted_secrets (name, decrypted_secret) values ('${name}', '${value}') on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;`);
}

async function seedResponse(urlPrefix: string, statusCode: number, content: string): Promise<void> {
  const escaped = content.replaceAll("'", "''");
  await exec(
    `insert into test_stub_responses (url_prefix, status_code, content) values ('${urlPrefix}', ${statusCode}, '${escaped}') on conflict (url_prefix) do update set status_code = excluded.status_code, content = excluded.content;`,
  );
}

type WatchRow = {
  decision: string;
  trigger: string | null;
  vercel_deploys_24h: number | null;
  actions_queue_max_wait_s: number | null;
  actions_status: string | null;
  action_recommended: string | null;
  reversal_command: string | null;
  issue_number: number | null;
};

async function rows(): Promise<WatchRow[]> {
  const result = await getDb().execute(sql.raw("select * from production.quota_watch order by id asc;"));
  return result as unknown as WatchRow[];
}

async function posts(): Promise<Array<{ url: string }>> {
  const result = await getDb().execute(sql.raw("select url from test_stub_posts order by id asc;"));
  return result as unknown as Array<{ url: string }>;
}

async function disparar(): Promise<void> {
  await exec("select jho_cron.vigia_disparar();");
}
async function coletar(): Promise<void> {
  await exec("select jho_cron.vigia_coletar();");
}
async function registrarIssue(): Promise<void> {
  await exec("select jho_cron.vigia_registrar_issue();");
}

const VERCEL_OK = JSON.stringify({ deployments: [{}, {}, {}, {}, {}] });
const ACTIONS_EMPTY = JSON.stringify({ workflow_runs: [] });
const STATUS_OPERATIONAL = JSON.stringify({ components: [{ name: "Actions", status: "operational" }, { name: "Pages", status: "major_outage" }] });

beforeEach(async () => {
  await useTestDb();
  await exec(STUB_SCHEMA);
  await exec(SCHEMA_BLOCK);
  await exec(PENDENTE_TABLE);
  await exec(DISPARAR_FN);
  await exec(COLETAR_FN);
  await exec(REGISTRAR_FN);
});

afterEach(async () => {
  await releaseTestDb();
});

describe("F3-01 — limiares decidem a ação certa, com a função de verdade", () => {
  it("amostra normal: ok, sem gatilho, sem recomendação", async () => {
    await seedSecret("watchdog_vercel_token", "v-token");
    await seedSecret("watchdog_vercel_project_id", "proj_1");
    await seedSecret("watchdog_github_token", "gh-token");
    await seedResponse("https://api.vercel.com", 200, VERCEL_OK);
    await seedResponse("https://api.github.com/repos/andreustimm/master-jobs/actions", 200, ACTIONS_EMPTY);
    await seedResponse("https://www.githubstatus.com", 200, STATUS_OPERATIONAL);

    await disparar();
    await coletar();

    const [row] = await rows();
    expect(row).toMatchObject({ decision: "ok", trigger: null, vercel_deploys_24h: 5, actions_queue_max_wait_s: 0, actions_status: "none" });
    expect(row!.action_recommended).toBeNull();
    expect(row!.reversal_command).toBeNull();
  });

  it("90% dos deploys: acao-recomendada com recomendação e reversão sem placeholder", async () => {
    await seedSecret("watchdog_vercel_token", "v-token");
    await seedSecret("watchdog_vercel_project_id", "proj_1");
    await seedSecret("watchdog_github_token", "gh-token");
    await seedResponse("https://api.vercel.com", 200, JSON.stringify({ deployments: Array.from({ length: 91 }, () => ({})) }));
    await seedResponse("https://api.github.com/repos/andreustimm/master-jobs/actions", 200, ACTIONS_EMPTY);
    await seedResponse("https://www.githubstatus.com", 200, STATUS_OPERATIONAL);

    await disparar();
    await coletar();

    const [row] = await rows();
    expect(row).toMatchObject({ decision: "acao-recomendada", trigger: "vercel" });
    expect(row!.reversal_command).toBe("gh workflow enable promover-para-staging.yml");
    expect(row!.reversal_command).not.toContain("<");
    expect(row!.action_recommended).not.toBeNull();
  });

  it("major_outage no componente Actions: acao-recomendada mesmo com fila vazia (M2, por componente)", async () => {
    await seedSecret("watchdog_github_token", "gh-token");
    await seedResponse("https://api.github.com/repos/andreustimm/master-jobs/actions", 200, ACTIONS_EMPTY);
    await seedResponse(
      "https://www.githubstatus.com",
      200,
      JSON.stringify({ components: [{ name: "Actions", status: "major_outage" }] }),
    );

    await disparar();
    await coletar();

    const [row] = await rows();
    expect(row).toMatchObject({ decision: "acao-recomendada", trigger: "actions", actions_status: "critical" });
  });

  it("indicador global da página em outro componente (Pages) não acende o vigia do Actions (M2)", async () => {
    await seedSecret("watchdog_vercel_token", "v-token");
    await seedSecret("watchdog_vercel_project_id", "proj_1");
    await seedSecret("watchdog_github_token", "gh-token");
    await seedResponse("https://api.vercel.com", 200, VERCEL_OK);
    await seedResponse("https://api.github.com/repos/andreustimm/master-jobs/actions", 200, ACTIONS_EMPTY);
    // "Actions" operacional, só "Pages" em outage: o vigia do Actions não reage.
    await seedResponse("https://www.githubstatus.com", 200, STATUS_OPERATIONAL);

    await disparar();
    await coletar();

    const [row] = await rows();
    expect(row).toMatchObject({ decision: "ok", actions_status: "none" });
  });
});

describe("F3-02 — amostra ausente ou inválida nunca decide como se fosse ok", () => {
  it("sem nenhum segredo configurado: amostra-indisponivel, não ok", async () => {
    await disparar();
    await coletar();

    const [row] = await rows();
    expect(row).toMatchObject({ decision: "amostra-indisponivel", vercel_deploys_24h: null, actions_queue_max_wait_s: null, actions_status: null });
  });

  it("JSON inesperado numa métrica não derruba as outras (M3, exception por métrica)", async () => {
    await seedSecret("watchdog_vercel_token", "v-token");
    await seedSecret("watchdog_vercel_project_id", "proj_1");
    await seedSecret("watchdog_github_token", "gh-token");
    // Vercel responde 200, mas `deployments` não é um array (JSON válido,
    // formato inesperado): `jsonb_array_length` lança, e o `exception when
    // others` do bloco isola só esta métrica.
    await seedResponse("https://api.vercel.com", 200, JSON.stringify({ deployments: "formato-inesperado" }));
    await seedResponse("https://api.github.com/repos/andreustimm/master-jobs/actions", 200, ACTIONS_EMPTY);
    await seedResponse("https://www.githubstatus.com", 200, STATUS_OPERATIONAL);

    await disparar();
    await coletar();

    const [row] = await rows();
    // Vercel indisponível, mas Actions seguiu lido normalmente.
    expect(row!.vercel_deploys_24h).toBeNull();
    expect(row!.actions_queue_max_wait_s).toBe(0);
    expect(row!.actions_status).toBe("none");
  });

  it("resposta HTTP não-200 vira null, não zero nem ok", async () => {
    await seedSecret("watchdog_vercel_token", "v-token");
    await seedSecret("watchdog_vercel_project_id", "proj_1");
    await seedResponse("https://api.vercel.com", 500, "erro interno");

    await disparar();
    await coletar();

    const [row] = await rows();
    expect(row!.vercel_deploys_24h).toBeNull();
    expect(row!.decision).toBe("amostra-indisponivel");
  });
});

describe("M1 — dedupe: mesma decisão e gatilho comentam, não abrem outra issue", () => {
  it("duas checagens seguidas em aviso (vercel): uma issue aberta, a segunda comenta nela", async () => {
    await seedSecret("watchdog_vercel_token", "v-token");
    await seedSecret("watchdog_vercel_project_id", "proj_1");
    await seedSecret("watchdog_github_token", "gh-token");
    await seedResponse("https://api.vercel.com", 200, JSON.stringify({ deployments: Array.from({ length: 75 }, () => ({})) }));
    await seedResponse("https://api.github.com/repos/andreustimm/master-jobs/actions", 200, ACTIONS_EMPTY);
    await seedResponse("https://www.githubstatus.com", 200, STATUS_OPERATIONAL);

    await disparar();
    await coletar();
    await registrarIssue();

    await disparar();
    await coletar();

    const [first, second] = await rows();
    expect(first).toMatchObject({ decision: "aviso", trigger: "vercel" });
    expect(first!.issue_number).toBe(999);
    expect(second).toMatchObject({ decision: "aviso", trigger: "vercel", issue_number: 999 });

    const calls = await posts();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/andreustimm/master-jobs/issues");
    expect(calls[1]!.url).toBe("https://api.github.com/repos/andreustimm/master-jobs/issues/999/comments");
  });

  it("gatilho muda de vercel para actions: abre uma issue nova, não comenta na antiga", async () => {
    await seedSecret("watchdog_vercel_token", "v-token");
    await seedSecret("watchdog_vercel_project_id", "proj_1");
    await seedSecret("watchdog_github_token", "gh-token");
    await seedResponse("https://api.vercel.com", 200, JSON.stringify({ deployments: Array.from({ length: 75 }, () => ({})) }));
    await seedResponse("https://api.github.com/repos/andreustimm/master-jobs/actions", 200, ACTIONS_EMPTY);
    await seedResponse("https://www.githubstatus.com", 200, STATUS_OPERATIONAL);
    await disparar();
    await coletar();
    await registrarIssue();

    // Segunda rodada: Vercel volta ao normal, mas o Actions agora está em aviso.
    await seedResponse("https://api.vercel.com", 200, VERCEL_OK);
    await seedResponse(
      "https://api.github.com/repos/andreustimm/master-jobs/actions",
      200,
      JSON.stringify({ workflow_runs: [{ created_at: new Date(Date.now() - 11 * 60_000).toISOString() }] }),
    );
    await disparar();
    await coletar();

    const calls = await posts();
    const issuePosts = calls.filter((c) => c.url.endsWith("/issues"));
    expect(issuePosts).toHaveLength(2); // duas issues abertas — gatilhos diferentes, nunca comentário cruzado.
  });
});

describe("M4 — amostra indisponível persistente alerta na 3ª checagem seguida", () => {
  it("duas checagens isoladas não alertam; a terceira seguida abre issue", async () => {
    await seedSecret("watchdog_github_token", "gh-token");
    // Nenhuma resposta cadastrada para nenhum host: tudo fica indisponível.

    await disparar();
    await coletar();
    await disparar();
    await coletar();
    let calls = await posts();
    expect(calls).toHaveLength(0); // duas seguidas ainda não é streak de 3.

    await disparar();
    await coletar();
    calls = await posts();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/andreustimm/master-jobs/issues");

    const all = await rows();
    expect(all.map((r) => r.decision)).toEqual(["amostra-indisponivel", "amostra-indisponivel", "amostra-indisponivel"]);
  });
});
