import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.ts";
import { normalizeConnectionUrl, resolveDatabaseUrl } from "./config.ts";

export type DB = ReturnType<typeof drizzle<typeof schema>>;
/** A transação que `db.transaction(fn)` entrega a `fn`. */
export type DbTransaction = Parameters<Parameters<DB["transaction"]>[0]>[0];
let cached: { client: postgres.Sql; db: DB } | undefined;

/**
 * A CA pode chegar como caminho ou como o próprio PEM.
 *
 * O painel de variáveis de um serviço serverless é uma caixa de texto, e colar
 * o certificado nela é o gesto natural — não há onde pôr um arquivo. Só que o
 * valor era lido com `readFileSync` sempre, e o PEM colado virava um `ENOENT`
 * com o certificado inteiro no lugar do nome do arquivo: um erro que não conta
 * o que houve, no meio de um corte de produção.
 *
 * Certificado não é segredo — é a chave pública que prova o servidor —, então
 * aceitar as duas formas não afrouxa nada. O que continuaria inaceitável é
 * desligar a verificação, e isso segue impossível por aqui.
 */
function certificateAuthority(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("BEGIN CERTIFICATE")) return trimmed;
  try {
    return readFileSync(trimmed, "utf8");
  } catch {
    // Nomear a variável e a forma esperada; nunca o valor, que num engano de
    // configuração pode ser qualquer coisa que o operador colou ali.
    throw new Error(
      "DATABASE_CA_CERT não é um PEM nem um arquivo legível: use o conteúdo do certificado ou o caminho de um arquivo existente",
    );
  }
}

/**
 * Conexão PostgreSQL explícita; nunca cai para um arquivo local em silêncio.
 *
 * `source` nomeia a variável de onde a URL veio. Ele existe para o erro poder
 * dizer QUAL configuração está errada num ambiente que tem três nomes
 * possíveis — e nunca carrega o valor, que é credencial.
 */
export function connectDatabase(
  url: string,
  source = "DATABASE_URL",
): { client: postgres.Sql; db: DB } {
  const normalized = normalizeConnectionUrl(url, source);
  const parsed = new URL(normalized);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  const ca = certificateAuthority(process.env.DATABASE_CA_CERT);
  const client = postgres(normalized, {
    ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    prepare: false,
    // Três conexões, e isso é contrato com quem escreve tela: nenhum trecho
    // pode disparar mais de três consultas ao mesmo tempo. Uma quarta espera
    // conexão, e em produção — função da Vercel contra o pooler do Supabase —
    // essa espera não terminava: a tela morria nos 30s do runtime em vez de
    // ficar um pouco mais lenta. `tests/db-fan-out.test.ts` mede o pico real.
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return { client, db: drizzle(client, { schema }) };
}

export function getDb(): DB {
  if (!cached) {
    const { url, source } = resolveDatabaseUrl("runtime");
    cached = connectDatabase(url, source);
  }
  return cached.db;
}

/** Await in CLI/tests so pending work drains before teardown. */
export async function closeDb(): Promise<void> {
  const previous = cached;
  cached = undefined;
  await previous?.client.end({ timeout: 5 });
}

export { schema };
