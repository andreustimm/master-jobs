import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../../src/core/db/schema.ts";

// Explicit allowlist: new tables require a reviewed transfer policy.
export const policies: Record<string, string> = {
  application: "all", application_event: "all", auth_event: "all",
  auth_user: "all", candidate: "all", candidate_document: "all",
  candidate_matching_profile: "all", candidate_skill: "all",
  engagement: "all", fx_rate: "all", llm_model: "all", llm_provider: "all",
  mail_message: "all", mail_suggestion: "all", metric_snapshot: "all",
  positioning_task: "all", post: "all", recruiter_candidate: "all",
  skill: "all", source: "configuration", target_account: "all",
  company: "referenced-or-researched", job: "business-references-or-manual",
  // Derivada e agora por trilha (ADR-008): o snapshot não tem trilha, e a
  // versão 1.4.0 do scorer recalcula tudo no alvo de qualquer forma.
  job_score: "exclude-derived",
  auth_login_token: "exclude-ephemeral", auth_session: "exclude-ephemeral",
  job_page: "exclude-crawler", scrape_task: "exclude-crawler",
  score_task: "exclude-queue", verify_task: "exclude-crawler",
};

/**
 * Colunas que o alvo ganhou depois que o snapshot legado foi congelado.
 *
 * A trava de drift existe para que coluna nova não atravesse a importação sem
 * decisão; por isso cada uma entra aqui com o valor que a importação escreve,
 * em vez de a comparação passar a tolerar diferença em silêncio. O snapshot não
 * tem conceito de arquivamento — tudo que vem dele chega ao alvo ativo.
 */
export const postSnapshotColumns: Record<string, Record<string, unknown>> = {
  job: { archived_at: null },
  job_score: { track_id: null },
  // Endereço público (#235). Nulo na importação: sem endereço o perfil não
  // responde em `/p/`, que é o lado seguro; o dono escolhe um em `/candidate`.
  candidate: { public_slug: null },
  // Catálogo governado pelo banco (#223). A linha importada nasce não gerida
  // e na revisão 1: continua espelhando o YAML até `jho sources import --apply`.
  source: { retired_at: null, origin: "system", config_revision: 1, secret_ref: null, managed_at: null },
};

/**
 * Tabelas que o alvo ganhou depois do snapshot. Chegam vazias: trilhas e termos
 * salvos nascem da aplicação (a trilha principal sai do perfil no primeiro uso),
 * e fila, atribuição e cota de captura por termo são estado operacional.
 */
export const postSnapshotTables = new Set([
  "target_track",
  "saved_term",
  "saved_term_request",
  "term_capture",
  "term_attribution",
  "platform_quota",
  // Reserva e métrica da varredura fatiada (ADR 0025): estado operacional.
  "sweep_lease",
  "sweep_run",
  // Cursor da passada de pontuação (#288): derivado; vazio = começar do topo.
  "score_cursor",
  // Análise estruturada da vaga (#223): derivada de LLM, refeita sob pedido.
  "job_analysis",
  // Orçamento diário de requisições por rotina (#291): contador operacional.
  "request_budget",
]);

const selectedJobs = `SELECT id FROM job WHERE
  id IN (SELECT job_id FROM application UNION SELECT job_id FROM mail_suggestion WHERE job_id IS NOT NULL)
  OR posted_by_user_id IS NOT NULL
  OR source_id IN (SELECT id FROM source WHERE kind IN ('manual', 'recruiter'))`;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

export function selectProduction(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  let transaction = false;
  try {
    // Keep one consistent SQLite snapshot for every table. A WAL writer may
    // append while we read, but it cannot turn the selected rows into a mix of
    // pre- and post-write values inside this transaction.
    db.exec("BEGIN");
    transaction = true;
    if (db.prepare("PRAGMA integrity_check").all().some((r) => r.integrity_check !== "ok")) {
      throw new Error("Source integrity check failed");
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Source has invalid foreign keys");
    const tables = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .map(getTableConfig)
      .filter((table) => !postSnapshotTables.has(table.name));
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      .map((r) => String(r.name)).filter((name) => !["sqlite_sequence", "__drizzle_migrations"].includes(name)).sort();
    if (JSON.stringify(names) !== JSON.stringify(Object.keys(policies).sort()) ||
        JSON.stringify(names) !== JSON.stringify(tables.map((t) => t.name).sort())) {
      throw new Error("Unreviewed source/target table drift");
    }
    const rows: Record<string, Record<string, unknown>[]> = {};
    const manifest = [];
    for (const table of tables.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = table.name;
      const added = postSnapshotColumns[name] ?? {};
      const actual = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map((c) => String(c.name)).sort();
      const expected = table.columns.map((c) => c.name).filter((c) => !(c in added)).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Unreviewed column drift: ${name}`);
      }
      const policy = policies[name]!;
      let predicate = "1";
      if (policy.startsWith("exclude-")) predicate = "0";
      if (name === "job") predicate = `id IN (${selectedJobs})`;
      if (name === "company") predicate = `id IN (SELECT company_id FROM job WHERE id IN (${selectedJobs}))
        OR notes IS NOT NULL OR hires_contractors IS NOT NULL OR hires_latam IS NOT NULL OR via_agency IS NOT NULL`;
      const keys = table.columns.filter((c) => c.primary).map((c) => c.name);
      for (const pk of table.primaryKeys) keys.push(...pk.columns.map((c) => c.name));
      if (!keys.length) throw new Error(`Missing primary key: ${name}`);
      // Coluna posterior ao snapshot não existe na origem, nem para ordenar.
      const order = keys.filter((key) => !(key in added));
      rows[name] = db.prepare(`SELECT * FROM ${quote(name)} WHERE ${predicate} ORDER BY ${order.map(quote).join(",")}`).all().map((row) => {
        const result: Record<string, unknown> = {};
        for (const col of table.columns) {
          // Na posição da coluna, não antes: a verificação do alvo compara o
          // hash do JSON, e chave fora de ordem muda o hash sem mudar o dado.
          if (col.name in added) {
            result[col.name] = added[col.name];
            continue;
          }
          let value: unknown = row[col.name];
          if (value !== null && col.dataType === "boolean") {
            if (value !== 0 && value !== 1) throw new Error(`Invalid boolean: ${name}.${col.name}`);
            value = value === 1;
          }
          if (value !== null && col.dataType === "json") value = JSON.parse(String(value));
          result[col.name] = value;
        }
        if (name === "source") {
          for (const key of ["last_synced_at", "last_status", "last_error", "last_job_count"]) result[key] = null;
        }
        if (name === "job") {
          result.description_html = null;
          const manual = db.prepare("SELECT kind FROM source WHERE id = ?").get(String(row.source_id));
          if (!["manual", "recruiter"].includes(String(manual?.kind))) {
            const workplaceType = result.raw && typeof result.raw === "object" && !Array.isArray(result.raw)
              ? (result.raw as Record<string, unknown>).workplaceType
              : undefined;
            result.raw = typeof workplaceType === "string" && workplaceType.trim()
              ? { workplaceType: workplaceType.trim() }
              : {};
          }
        }
        return result;
      });
      const serialized = JSON.stringify(rows[name]);
      manifest.push({ table: name, policy, sourceCount: Number(db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get()!.n),
        selectedCount: rows[name].length, payloadBytes: Buffer.byteLength(serialized),
        sha256: createHash("sha256").update(serialized).digest("hex") });
    }
    // Check the selected set, not just the full source: exclusions must never
    // strand a business row. Composite ownership FKs are checked as tuples.
    for (const table of tables) {
      for (const fk of table.foreignKeys) {
        const ref = fk.reference();
        const parent = getTableConfig(ref.foreignTable).name;
        // Tabela posterior ao snapshot chega vazia; a coluna que aponta para ela
        // também é posterior e vem nula.
        if (postSnapshotTables.has(parent)) continue;
        const available = new Set(rows[parent]!.map((row) =>
          JSON.stringify(ref.foreignColumns.map((col) => row[col.name]))));
        for (const row of rows[table.name]!) {
          const values = ref.columns.map((col) => row[col.name]);
          if (values.some((value) => value === null)) continue;
          if (!available.has(JSON.stringify(values))) {
            throw new Error(`Selection breaks foreign key: ${table.name} -> ${parent}`);
          }
        }
      }
    }
    db.exec("COMMIT");
    transaction = false;
    return { rows, manifest };
  } finally {
    if (transaction) {
      try { db.exec("ROLLBACK"); } catch { /* close below is the final guard */ }
    }
    db.close();
  }
}
