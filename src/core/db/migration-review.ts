/**
 * O que uma migração pode fazer em produção sem ninguém olhar.
 *
 * A Vercel publica `main` no mesmo push que dispara `migrate.yml`, e os dois
 * não se conhecem: por alguns minutos o código ANTIGO serve contra o schema
 * NOVO (ou o novo contra o antigo). Migração aditiva sobrevive a essa corrida;
 * a que remove, renomeia, muda tipo, aperta restrição ou reescreve dado, não.
 *
 * Por isso a classificação é LISTA DE PERMISSÃO, não de bloqueio: só as formas
 * de comando reconhecidas como aditivas passam, e qualquer outra — inclusive
 * uma que ninguém previu — pede revisão humana. Errar para o lado de pedir
 * revisão custa um clique; errar para o outro derruba produção ou apaga dado.
 *
 * Puro: recebe o texto do SQL e devolve o veredito. Sem banco, sem git, sem
 * disco — é o que deixa `promotion.ts` (sem `pnpm install`) e `jho db migrate`
 * usarem a mesma regra.
 */

export type MigrationRisk =
  | "drop"
  | "rename"
  | "type-change"
  | "set-not-null"
  | "not-null-without-default"
  | "constraint-on-existing"
  | "data-rewrite"
  | "revoke"
  | "procedural"
  | "unknown"
  | "history-rewritten"
  | "outside-postgres";

export type MigrationSource = { name: string; sql: string };
export type MigrationFinding = { migration: string; statement: string; risk: MigrationRisk };
export type MigrationReview = { automatic: boolean; findings: MigrationFinding[] };

/** Uma linha por risco, em português, para o log do job e o erro da promoção. */
export const RISK_LABEL: Record<MigrationRisk, string> = {
  "drop": "remove objeto, coluna, restrição ou default",
  "rename": "renomeia — o código no ar ainda usa o nome antigo",
  "type-change": "muda o tipo de coluna",
  "set-not-null": "torna obrigatória uma coluna existente",
  "not-null-without-default": "coluna obrigatória sem default em tabela existente",
  "constraint-on-existing": "restrição nova sobre dado ou coluna existente",
  "data-rewrite": "reescreve ou apaga dado",
  "revoke": "retira privilégio",
  "procedural": "bloco procedural ou função — não dá para ler o efeito",
  "unknown": "forma de comando não reconhecida como aditiva",
  "history-rewritten": "altera ou remove migração já publicada",
  "outside-postgres": "arquivo fora de drizzle/postgres/",
};

type Statement = { text: string; idents: string[] };
type Column = { hasDefault: boolean };

const IDENT = String.raw`(?:@\d+|[a-z_][\w$]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;

/**
 * Separa em comandos, sem comentário e com literal mascarado.
 *
 * Literal de texto vira `''` e corpo com cifrão vira `$$ $$`: uma palavra
 * `DROP` dentro de um default ou de um comentário não é comando. Identificador
 * entre aspas vira `@N` (o nome fica em `idents`), para que uma coluna chamada
 * "drop" não pareça palavra-chave — e para que o nome não se perca.
 */
export function splitStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let text = "";
  let idents: string[] = [];
  const flush = () => {
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed) statements.push({ text: collapsed, idents });
    text = "";
    idents = [];
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      // `--> statement-breakpoint` não é só comentário: é por ele que o
      // drizzle divide o arquivo. Sem `;` antes dele, os dois comandos viram
      // um só aqui, e o prefixo permitido esconderia o que vem depois.
      const breakpoint = sql.startsWith("--> statement-breakpoint", i);
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      if (breakpoint) flush();
      else text += " ";
    } else if (ch === "/" && next === "*") {
      // PostgreSQL aninha comentário de bloco.
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      text += " ";
    } else if (ch === "'") {
      const escaped = /[eE]$/.test(text) && !/[\w$][eE]$/.test(text);
      i++;
      while (i < sql.length) {
        if (escaped && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      if (escaped) text = text.slice(0, -1);
      text += "''";
    } else if (ch === '"') {
      let name = "";
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { name += '"'; i += 2; continue; }
        if (sql[i] === '"') { i++; break; }
        name += sql[i];
        i++;
      }
      text += ` @${idents.length} `;
      idents.push(name);
    } else if (ch === "$" && !/[\w$]$/.test(text)) {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (!tag) { text += ch; i++; continue; }
      const end = sql.indexOf(tag[0], i + tag[0].length);
      i = end === -1 ? sql.length : end + tag[0].length;
      text += " $$ $$ ";
    } else if (ch === ";") {
      flush();
      i++;
    } else {
      text += ch;
      i++;
    }
  }
  flush();
  return statements;
}

/** Um segmento de nome: identificador entre aspas volta literal, o resto em minúsculas. */
function segmentOf(segment: string, idents: string[]): string {
  const quoted = /^@(\d+)$/.exec(segment.trim());
  return quoted ? idents[Number(quoted[1])]! : segment.trim().toLowerCase();
}

/** Nome de coluna: último segmento. */
function nameOf(qualified: string, idents: string[]): string {
  return segmentOf(qualified.split(".").pop()!, idents);
}

/**
 * Tabela pelo nome COMPLETO, com schema. `backup.job` não é `production.job`,
 * e `job` sem schema não se confunde com nenhuma das duas: na dúvida a tabela
 * conta como existente, que é o lado que pede revisão.
 */
function tableOf(qualified: string, idents: string[]): string {
  return qualified.split(".").map((segment) => segmentOf(segment, idents)).join(".");
}

/** Divide por vírgula de nível zero; parênteses protegem listas de coluna. */
function topLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current.trim()); current = ""; }
    else current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

/** O trecho até o `)` que fecha o `(` já consumido. */
function untilClose(rest: string): string {
  let depth = 1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "(") depth++;
    if (rest[i] === ")" && --depth === 0) return rest.slice(0, i);
  }
  return rest;
}

/** Lista de colunas simples `(a, "b")`; expressão devolve `null`. */
function columnList(list: string, idents: string[]): string[] | null {
  const names = topLevel(list);
  if (!names.every((part) => new RegExp(`^${IDENT}$`, "i").test(part))) return null;
  return names.map((part) => nameOf(part, idents));
}

function restore(statement: Statement): string {
  const text = statement.text
    .replace(/@(\d+)/g, (_, n: string) => `"${statement.idents[Number(n)]}"`)
    .replaceAll('" . "', '"."');
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/**
 * O lote é a unidade, não o arquivo: tabela criada no arquivo 0020 é nova
 * também para o 0021 do mesmo lote, e o código no ar não a conhece.
 */
export function reviewMigrations(batch: readonly MigrationSource[]): MigrationReview {
  const created = new Set<string>();
  const added = new Map<string, Map<string, Column>>();
  const findings: MigrationFinding[] = [];

  const newColumns = (table: string) => added.get(table) ?? new Map<string, Column>();
  /** Coluna nova, sem default: o código no ar nunca a escreve, e ela nasce nula. */
  const untouched = (table: string, columns: string[] | null) =>
    columns !== null && columns.length > 0 &&
    columns.every((column) => newColumns(table).get(column)?.hasDefault === false);

  const alterAction = (table: string, action: string, idents: string[]): MigrationRisk | null => {
    if (/^rename\b/i.test(action)) return "rename";
    if (/^drop\b/i.test(action)) return "drop";

    const constraint = /^add (?:constraint \S+ )?(primary key|unique|foreign key|check|exclude)\b(.*)$/i.exec(action);
    if (constraint) {
      const kind = constraint[1]!.toLowerCase();
      // NULLS NOT DISTINCT trata os nulos como iguais: numa coluna nova, toda
      // linha existente é nula, e a segunda já viola a restrição.
      if (/^\s*nulls not distinct\b/i.test(constraint[2]!)) return "constraint-on-existing";
      const columns = /^\s*(?:nulls (?:not )?distinct )?\(([^()]*)\)/i.exec(constraint[2]!);
      if ((kind === "foreign key" || kind === "unique") && untouched(table, columns ? columnList(columns[1]!, idents) : null)) {
        return null;
      }
      return "constraint-on-existing";
    }
    // Restrição de forma não prevista não pode cair no ramo de coluna nova.
    if (/^add constraint\b/i.test(action)) return "unknown";

    const column = new RegExp(`^add (?:column )?(if not exists )?(${IDENT})\\s*(.*)$`, "i").exec(action);
    if (column) {
      const definition = column[3]!;
      const hasDefault = /\b(default|generated)\b/i.test(definition);
      // `IF NOT EXISTS` pode ser no-op sobre coluna que já existe e tem dado:
      // ela não conta como nova para as restrições seguintes.
      if (!column[1]) {
        const columns = newColumns(table);
        columns.set(nameOf(column[2]!, idents), { hasDefault });
        added.set(table, columns);
      }
      if (/\bprimary key\b/i.test(definition)) return "constraint-on-existing";
      if (/\bnulls not distinct\b/i.test(definition)) return "constraint-on-existing";
      if (/\bnot null\b/i.test(definition) && !hasDefault) return "not-null-without-default";
      if (hasDefault && /\b(unique|references|check)\b/i.test(definition)) return "constraint-on-existing";
      return null;
    }

    const alter = new RegExp(`^alter (?:column )?(${IDENT}) (.*)$`, "i").exec(action);
    if (alter) {
      const change = alter[2]!;
      if (/^drop not null$/i.test(change) || /^set default\b/i.test(change)) return null;
      if (/^drop default$/i.test(change)) return "drop";
      if (/^(set data )?type\b/i.test(change)) return "type-change";
      if (/^set not null$/i.test(change)) {
        return newColumns(table).get(nameOf(alter[1]!, idents))?.hasDefault ? null : "set-not-null";
      }
    }
    return "unknown";
  };

  const classify = (statement: Statement): MigrationRisk | null => {
    const { text, idents } = statement;
    if (/^create schema\b/i.test(text)) return null;
    const table = new RegExp(`^create table (if not exists )?(${QNAME})`, "i").exec(text);
    if (table) {
      // Só o CREATE TABLE sem `IF NOT EXISTS` prova que a tabela nasce aqui; o
      // outro pode ser no-op sobre uma tabela viva, com dado e leitores.
      if (!table[1]) created.add(tableOf(table[2]!, idents));
      return null;
    }
    const index = new RegExp(
      `^create (unique )?index (?:concurrently )?(?:if not exists )?(?:${IDENT} )?on (?:only )?(${QNAME})\\s*(?:using ${IDENT}\\s*)?\\(`,
      "i",
    ).exec(text);
    if (index) {
      const target = tableOf(index[2]!, idents);
      if (!index[1] || created.has(target)) return null;
      const rest = text.slice(index[0].length);
      const list = untilClose(rest);
      if (/^\)\s*nulls not distinct\b/i.test(rest.slice(list.length))) return "constraint-on-existing";
      return untouched(target, columnList(list, idents)) ? null : "constraint-on-existing";
    }
    if (/^create (sequence|extension)\b/i.test(text)) return null;
    if (new RegExp(`^create type ${QNAME} as enum\\b`, "i").test(text)) return null;
    if (/^(grant|comment on)\b/i.test(text)) return null;
    if (/^alter default privileges\b/i.test(text)) return /\brevoke\b/i.test(text) ? "revoke" : null;
    if (/^revoke\b/i.test(text)) return "revoke";
    if (/^insert into\b/i.test(text)) return /\bdo update\b/i.test(text) ? "data-rewrite" : null;
    if (/^(update|delete|truncate|merge)\b/i.test(text)) return "data-rewrite";
    if (/^drop\b/i.test(text)) return "drop";
    if (/^(do\b|create (or replace )?(function|procedure|trigger)\b)/i.test(text)) return "procedural";

    const alterTable = new RegExp(`^alter table (?:if exists )?(?:only )?(${QNAME}) (.*)$`, "i").exec(text);
    if (alterTable) {
      const target = tableOf(alterTable[1]!, idents);
      // Tabela nascida neste lote não tem dado nem leitor: qualquer ajuste nela é aditivo.
      if (created.has(target)) return null;
      for (const action of topLevel(alterTable[2]!)) {
        const risk = alterAction(target, action, idents);
        if (risk) return risk;
      }
      return null;
    }
    if (new RegExp(`^alter type ${QNAME} add value\\b`, "i").test(text)) return null;
    if (/^alter \w+(?: \w+)? \S+ rename\b/i.test(text)) return "rename";
    return "unknown";
  };

  for (const migration of batch) {
    for (const statement of splitStatements(migration.sql)) {
      const risk = classify(statement);
      if (risk) findings.push({ migration: migration.name, statement: restore(statement), risk });
    }
  }
  return { automatic: findings.length === 0, findings };
}

export type FileChange = { status: string; path: string };

/**
 * A promoção só enxerga o diff `staging..alvo`, não o banco.
 *
 * Migração nova entra no lote e é classificada. Snapshot e journal de
 * `meta/` acompanham qualquer migração e não chegam ao banco por si. Arquivo
 * `.sql` já publicado que muda ou some, ou qualquer coisa fora de
 * `drizzle/postgres/`, pede revisão: o migrador não reaplica arquivo alterado,
 * e o histórico SQLite legado não é assunto de automação.
 */
export function reviewMigrationChanges(changes: readonly FileChange[], read: (path: string) => string): MigrationReview {
  const batch: MigrationSource[] = [];
  const findings: MigrationFinding[] = [];
  for (const { status, path } of [...changes].sort((a, b) => a.path.localeCompare(b.path))) {
    if (path.startsWith("drizzle/postgres/meta/")) continue;
    if (/^drizzle\/postgres\/[^/]+\.sql$/.test(path)) {
      if (status === "A") batch.push({ name: path, sql: read(path) });
      else findings.push({ migration: path, statement: `status ${status}`, risk: "history-rewritten" });
      continue;
    }
    findings.push({ migration: path, statement: `status ${status}`, risk: "outside-postgres" });
  }
  const review = reviewMigrations(batch);
  const all = [...findings, ...review.findings];
  return { automatic: all.length === 0, findings: all };
}

/** Uma linha por achado, com o arquivo, o risco e o comando. */
export function describeFindings(findings: readonly MigrationFinding[]): string {
  return findings.map((f) => `${f.migration}: ${RISK_LABEL[f.risk]} — ${f.statement}`).join("\n");
}

export type JournalEntry = { tag: string; when: number };

/**
 * O mesmo critério do migrador do drizzle (`pg-core/dialect.js`): aplica toda
 * entrada cujo `when` é maior que o `created_at` da última aplicada. Uma
 * migração destrutiva barrada continua pendente, e por isso o lote seguinte a
 * inclui — classificar só o diff do push a deixaria passar junto com a próxima
 * aditiva.
 */
export function pendingEntries(journal: readonly JournalEntry[], lastApplied: number | null): JournalEntry[] {
  return journal.filter((entry) => lastApplied === null || lastApplied < entry.when);
}
