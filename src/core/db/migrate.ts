import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectDatabase } from "./client.ts";
import { resolveDatabaseUrl } from "./config.ts";

/**
 * Conexão privilegiada separada. A credencial de runtime não precisa de DDL.
 *
 * A ordem de nomes aqui prefere a conexão DIRETA à do pooler: DDL em pooler
 * modo transação é onde migrations travam sem explicar por quê.
 */
export async function runMigrations(folder = "./drizzle/postgres"): Promise<void> {
  const { url, source } = resolveDatabaseUrl("migration");
  const { db, client } = connectDatabase(url, source);
  try { await migrate(db, { migrationsFolder: folder }); }
  catch (error) { throw withDatabaseCause(error); }
  finally { await client.end({ timeout: 5 }); }
}

/**
 * O drizzle embrulha QUALQUER falha da primeira consulta em "Failed query:
 * CREATE SCHEMA ...", inclusive conexão recusada, TLS e senha errada — o
 * `migrate.yml` falhou três dias assim sem ninguém saber por quê. A causa real
 * fica em `error.cause`; aqui sobem só o código e a mensagem do servidor ou do
 * socket, que não carregam a URL nem a senha.
 */
export function withDatabaseCause(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const cause = (error as { cause?: unknown }).cause;
  if (!(cause instanceof Error)) return error;
  const code = (cause as { code?: unknown }).code;
  const detail = [typeof code === "string" ? code : "", cause.message].filter(Boolean).join(" ");
  return new Error(`${error.message.split("\n")[0]} — causa: ${detail}`, { cause });
}
