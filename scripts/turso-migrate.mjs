/**
 * Copia o banco local para a Turso.
 *
 * Não usa `turso db shell < dump.sql`: o dump de 529 MB estoura o limite de
 * requisição do cliente HTTP e falha no meio, deixando um banco parcialmente
 * populado que ninguém sabe dizer onde parou. Aqui a cópia é por tabela, em
 * lotes, e o progresso é impresso — uma interrupção diz exatamente o que já foi.
 *
 * **Idempotente por `INSERT OR REPLACE`.** Rodar duas vezes não duplica, e
 * retomar depois de uma falha não exige limpar nada. O preço é sobrescrever o
 * que estiver no destino, e é por isso que a checagem de banco não-vazio existe.
 *
 * Ordem das tabelas segue a dependência de chave estrangeira. As FKs são
 * desligadas durante a cópia mesmo assim: uma tabela que se referencia — como
 * `auth_event.user_id` apontando para `auth_user` — não tem ordem que resolva
 * sozinha, e o `pragma foreign_key_check` no fim confere o resultado.
 *
 * Desligar é feito por `client.migrate()`, não por `PRAGMA foreign_keys=OFF`:
 * o pragma é ignorado dentro de transação, e `batch(…, "write")` abre uma.
 *
 *   node scripts/turso-migrate.mjs --dry-run
 *   node scripts/turso-migrate.mjs
 *   node scripts/turso-migrate.mjs --skip-html
 *   node scripts/turso-migrate.mjs --skip-html --reset   # limpa o destino antes
 */
import { createClient } from "@libsql/client";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipHtml = args.has("--skip-html");
// Retomada depois de falha no meio: `INSERT OR REPLACE` não remove o que sobrou
// de uma tabela que encolheu, então a carga limpa é explícita, nunca implícita.
const reset = args.has("--reset");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !url.startsWith("libsql://")) {
  console.error("TURSO_DATABASE_URL precisa apontar para libsql://. Nada foi feito.");
  process.exit(1);
}
if (!authToken) {
  console.error("TURSO_AUTH_TOKEN ausente. Nada foi feito.");
  process.exit(1);
}

const local = createClient({ url: "file:./data/jobs.db" });
const remote = createClient({ url, authToken });

/**
 * Ordem de dependência.
 *
 * Escrita à mão em vez de derivada do schema: derivar exigiria um ordenamento
 * topológico que falha em ciclo, e há um — `auth_event` referencia `auth_user`,
 * que é apagado em cascata por sessão. A lista é curta e revisável.
 */
const ORDER = [
  "source", "company", "job", "job_page", "job_score", "scrape_task", "verify_task",
  "candidate", "candidate_document", "candidate_matching_profile",
  "skill", "candidate_skill", "skill_demand",
  "application", "application_event",
  "contact", "positioning_task", "post", "post_metric", "engagement",
  "auth_user", "auth_session", "auth_login_token", "auth_event", "recruiter_candidate",
  "llm_provider", "llm_model", "fx_rate", "target_account", "mail_message", "mail_suggestion",
];

const BATCH = 200;

async function tabelasExistentes(client) {
  const r = await client.execute(
    "select name from sqlite_master where type='table' and name not like 'sqlite_%'",
  );
  return new Set(r.rows.map((row) => String(row.name)));
}

async function main() {
  const [locais, remotas] = await Promise.all([tabelasExistentes(local), tabelasExistentes(remote)]);

  const faltando = [...locais].filter((t) => !remotas.has(t) && t !== "__drizzle_migrations");
  if (faltando.length > 0) {
    console.error(
      `\nO destino não tem ${faltando.length} tabela(s): ${faltando.slice(0, 5).join(", ")}` +
        `\nRode \`pnpm jho db migrate\` contra a Turso antes de copiar.\n`,
    );
    process.exit(1);
  }

  // Destino com dado é sinal de que alguém já migrou, ou de que o banco não é o
  // que se pensa. `INSERT OR REPLACE` sobrescreveria em silêncio.
  const [{ n: jaTem }] = (await remote.execute("select count(*) n from job")).rows;
  if (Number(jaTem) > 0 && !dryRun && reset) {
    const alvo = ORDER.filter((t) => remotas.has(t));
    console.log(`\n  --reset: limpando ${alvo.length} tabela(s) no destino\n`);
    await remote.migrate(alvo.map((t) => ({ sql: `delete from "${t}"` })));
  } else if (Number(jaTem) > 0 && !dryRun) {
    console.error(
      `\nO destino já tem ${jaTem} vaga(s). Este script sobrescreve por chave primária.` +
        `\nSe a intenção é recarregar do zero, rode com --reset.\n`,
    );
    process.exit(1);
  }

  const ordenadas = ORDER.filter((t) => locais.has(t));
  const ignoradas = [...locais].filter((t) => !ORDER.includes(t) && t !== "__drizzle_migrations");
  if (ignoradas.length > 0) {
    // Silêncio aqui seria perda de dado com cara de sucesso.
    console.warn(`\n  Fora da ordem declarada, NÃO copiadas: ${ignoradas.join(", ")}\n`);
  }

  let total = 0;
  for (const tabela of ordenadas) {
    const cols = (await local.execute(`pragma table_info(${tabela})`)).rows.map((r) => String(r.name));
    const usadas = skipHtml && tabela === "job_page" ? cols.filter((c) => c !== "html") : cols;

    const [{ n }] = (await local.execute(`select count(*) n from ${tabela}`)).rows;
    const linhas = Number(n);
    if (linhas === 0) {
      console.log(`  ${tabela.padEnd(28)} vazia`);
      continue;
    }

    const lista = usadas.map((c) => `"${c}"`).join(", ");
    const marcadores = usadas.map(() => "?").join(", ");

    let copiadas = 0;
    for (let offset = 0; offset < linhas; offset += BATCH) {
      const lote = await local.execute({
        sql: `select ${lista} from ${tabela} limit ? offset ?`,
        args: [BATCH, offset],
      });
      if (!dryRun && lote.rows.length > 0) {
        // `batch(…, "write")` abre transação, e o SQLite ignora
        // `PRAGMA foreign_keys` dentro de transação: a cópia quebrava ao
        // inserir filho antes do pai. `migrate()` roda com as FKs desligadas,
        // que é o modo correto para carga em massa. O `foreign_key_check` do
        // fim continua sendo a rede de segurança.
        await remote.migrate(
          lote.rows.map((row) => ({
            sql: `insert or replace into ${tabela} (${lista}) values (${marcadores})`,
            args: usadas.map((c) => row[c] ?? null),
          })),
        );
      }
      copiadas += lote.rows.length;
      if (linhas > 1000) process.stdout.write(`\r  ${tabela.padEnd(28)} ${copiadas}/${linhas}`);
    }

    if (linhas > 1000) process.stdout.write("\r\x1b[K");
    const nota = skipHtml && tabela === "job_page" ? "  (sem html)" : "";
    console.log(`  ${tabela.padEnd(28)} ${copiadas}${nota}`);
    total += copiadas;
  }

  if (!dryRun) {
    await remote.execute("PRAGMA foreign_keys=ON");
    const violacoes = await remote.execute("pragma foreign_key_check");
    if (violacoes.rows.length > 0) {
      console.error(`\n  ${violacoes.rows.length} violação(ões) de chave estrangeira no destino.\n`);
      process.exit(1);
    }
  }

  console.log(`\n${dryRun ? "[dry-run] " : ""}${total} linha(s) em ${ordenadas.length} tabela(s).`);
  if (dryRun) console.log("Nada foi escrito. Rode sem --dry-run para copiar.\n");
}

try {
  await main();
} finally {
  local.close();
  remote.close();
}
