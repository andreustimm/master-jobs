/**
 * De onde sai a URL do banco, e por que há mais de um nome possível.
 *
 * A integração do Supabase com a Vercel cadastra `POSTGRES_URL`,
 * `POSTGRES_URL_NON_POOLING` e companhia, e as mantém — rotação de senha
 * acontece do lado do provedor e chega sozinha. Exigir que alguém copie
 * aquele valor para uma `DATABASE_URL` genérica cria duas fontes da verdade
 * que divergem no dia da rotação, e o sintoma aparece como "produção fora do
 * ar" numa madrugada.
 *
 * Então o nome com prefixo é aceito de primeira classe. O que não muda é a
 * ordem ser DECLARADA e a origem ser dizível: quando a conexão falha, a
 * mensagem diz por qual variável a URL entrou, e nunca o valor dela.
 *
 *   runtime    DATABASE_URL → POSTGRES_URL → POSTGRES_URL_NON_POOLING
 *   migration  DATABASE_MIGRATION_URL → POSTGRES_URL_NON_POOLING → POSTGRES_URL
 *
 * A diferença entre as duas listas não é enfeite: DDL não deve atravessar o
 * pooler em modo transação, e o runtime serverless quer justamente o pooler.
 * `DATABASE_URL` continua vencendo as duas, porque é ela que o ambiente local,
 * o Docker e o CI configuram explicitamente.
 */

export type DatabaseRole = "runtime" | "migration";

const SOURCES: Record<DatabaseRole, readonly string[]> = {
  runtime: ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"],
  migration: ["DATABASE_MIGRATION_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL"],
};

/**
 * Parâmetros que pedem outra política de TLS.
 *
 * Eles são RECUSADOS, não ignorados. A política é do cliente — verificação de
 * cadeia ligada, CA declarada — e apagar `sslmode=disable` em silêncio
 * deixaria quem escreveu convencido de que desligou a verificação. Os demais
 * parâmetros (`pgbouncer`, limites de pool, o que o painel anexar amanhã) são
 * descartados: eles pertencem à configuração do cliente, que já é explícita.
 */
const TLS_PARAMETERS = ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert"];

export type ResolvedDatabaseUrl = {
  /** URL já sem query string, pronta para o driver. */
  url: string;
  /** Nome da variável de onde ela veio — para erro e diagnóstico. */
  source: string;
};

export function normalizeConnectionUrl(raw: string, source: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${source} não é uma URL PostgreSQL válida (valor omitido)`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${source} não é uma URL PostgreSQL válida (valor omitido)`);
  }
  const tls = TLS_PARAMETERS.filter((name) => parsed.searchParams.has(name));
  if (tls.length > 0) {
    throw new Error(
      `${source} traz ${tls.join(", ")} na URL: a política de TLS é do cliente e não pode ser mudada pela string de conexão — remova o parâmetro`,
    );
  }
  parsed.search = "";
  return parsed.toString();
}

/**
 * Primeira variável preenchida da lista do papel, normalizada.
 *
 * Vazia conta como ausente: variável criada e deixada em branco é o engano
 * mais comum de painel, e tratá-la como presente daria um erro de URL inválida
 * em vez de "ninguém configurou".
 */
export function resolveDatabaseUrl(
  role: DatabaseRole,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedDatabaseUrl {
  const names = SOURCES[role];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return { url: normalizeConnectionUrl(value, name), source: name };
  }
  throw new Error(
    `Nenhuma URL de banco configurada para ${role}: defina ${names.join(" ou ")}`,
  );
}

/** Os nomes aceitos, na ordem — para mensagem e documentação. */
export function databaseUrlSources(role: DatabaseRole): readonly string[] {
  return SOURCES[role];
}
