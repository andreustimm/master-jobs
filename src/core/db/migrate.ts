import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectDatabase } from "./client.ts";
import { resolveDatabaseUrl } from "./config.ts";
import {
  describeFindings, pendingEntries, reviewMigrations, type JournalEntry, type MigrationFinding,
} from "./migration-review.ts";

export type MigrationOptions = {
  /**
   * Recusa o lote inteiro, antes de qualquer DDL, se uma migração pendente não
   * for aditiva. É o modo do disparo automático no push para `main`
   * (`migrate.yml`); a execução manual, depois de revisão, não o usa.
   */
  additiveOnly?: boolean;
};

/** A recusa carrega os achados para o job imprimir o que barrou e onde. */
export class MigrationNeedsReview extends Error {
  readonly findings: MigrationFinding[];
  constructor(findings: MigrationFinding[]) {
    super(`Migração pendente exige execução manual depois de revisão humana:\n${describeFindings(findings)}`);
    this.name = "MigrationNeedsReview";
    this.findings = findings;
  }
}

/**
 * Conexão privilegiada separada. A credencial de runtime não precisa de DDL.
 *
 * A ordem de nomes aqui prefere a conexão DIRETA à do pooler: DDL em pooler
 * modo transação é onde migrations travam sem explicar por quê.
 *
 * Devolve as tags aplicadas nesta execução, para o log do job dizer o que mudou.
 */
export async function runMigrations(folder = "./drizzle/postgres", options: MigrationOptions = {}): Promise<string[]> {
  const { url, source } = resolveDatabaseUrl("migration");
  const { db, client } = connectDatabase(url, source);
  try {
    const { entries: journal } = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
      entries: JournalEntry[];
    };
    // A pergunta é "o que o migrador vai aplicar", e só o banco responde:
    // uma destrutiva barrada ontem continua pendente hoje.
    const pending = pendingEntries(journal, await lastApplied(client));
    if (options.additiveOnly) {
      const review = reviewMigrations(pending.map((entry) => ({
        name: entry.tag, sql: readFileSync(join(folder, `${entry.tag}.sql`), "utf8"),
      })));
      if (!review.automatic) throw new MigrationNeedsReview(review.findings);
    }
    await migrate(db, { migrationsFolder: folder });
    return pending.map((entry) => entry.tag);
  } catch (error) { throw withDatabaseCause(error); }
  finally { await client.end({ timeout: 5 }); }
}

/** `created_at` da última aplicada; banco sem a tabela de controle ainda não migrou nada. */
async function lastApplied(client: ReturnType<typeof connectDatabase>["client"]): Promise<number | null> {
  const [table] = await client<{ exists: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  if (!table!.exists) return null;
  const [row] = await client<{ last: string | null }[]>`select max(created_at)::text as last from drizzle.__drizzle_migrations`;
  return row!.last === null ? null : Number(row!.last);
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
