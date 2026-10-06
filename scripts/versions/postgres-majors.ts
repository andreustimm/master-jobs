/**
 * Majors do PostgreSQL que o CI prova, lidas de `config/postgres-majors.json`.
 *
 * A produção é Supabase Postgres 17; a política de versões (issue #468) põe
 * os bancos descartáveis na mais nova. Testar só a mais nova deixaria a major
 * que guarda o dado de verdade sem prova nenhuma, então as duas são declaradas
 * num arquivo só e os testes de banco e o ensaio rodam em cada uma.
 *
 * Executado direto (`pnpm test:postgres-majors`), roda o subconjunto de banco
 * em cada major declarada, uma depois da outra, e reprova na primeira falha.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type PostgresMajors = { latest: string; production: string };

const MAJOR = /^\d+$/;

export function parsePostgresMajors(text: string): PostgresMajors {
  const parsed = JSON.parse(text) as Partial<Record<keyof PostgresMajors, unknown>>;
  const latest = parsed.latest;
  const production = parsed.production;
  if (typeof latest !== "string" || !MAJOR.test(latest)) throw new Error("config/postgres-majors.json: `latest` precisa ser uma major (ex.: \"18\")");
  if (typeof production !== "string" || !MAJOR.test(production)) throw new Error("config/postgres-majors.json: `production` precisa ser uma major (ex.: \"17\")");
  return { latest, production };
}

export function readPostgresMajors(): PostgresMajors {
  return parsePostgresMajors(readFileSync(new URL("../../config/postgres-majors.json", import.meta.url), "utf8"));
}

/** Produção primeiro: é a que guarda dado, e a falha nela é a que mais importa ver. */
export function testedPostgresMajors(majors: PostgresMajors): string[] {
  return [...new Set([majors.production, majors.latest])];
}

/**
 * A imagem dos bancos descartáveis (testes e ensaio).
 *
 * `JHO_TEST_POSTGRES_MAJOR` escolhe uma das majors declaradas; ausente ou em
 * branco, vale a mais nova. Major fora da lista recusa, em vez de subir uma
 * imagem que nenhum documento diz que o projeto suporta.
 */
export function postgresTestImage(env: Readonly<{ [key: string]: string | undefined }>, majors: PostgresMajors): string {
  const requested = env.JHO_TEST_POSTGRES_MAJOR?.trim();
  if (!requested) return `postgres:${majors.latest}`;
  const allowed = testedPostgresMajors(majors);
  if (!allowed.includes(requested)) {
    throw new Error(`JHO_TEST_POSTGRES_MAJOR=${requested} fora de config/postgres-majors.json (${allowed.join(", ")})`);
  }
  return `postgres:${requested}`;
}

/** Major que o servidor de fato reporta em `server_version_num` (170006 → "17"). */
export function majorFromServerVersionNum(value: string | number): string {
  return String(Math.floor(Number(value) / 10000));
}

/**
 * Os testes de banco que a major da produção precisa passar: schema,
 * migração, upgrade, integridade e o ensaio de corte (`production-selection`,
 * que roda `scripts/migration/rehearse-production.ts`). Filtros de caminho do
 * Vitest, por substring.
 */
export const POSTGRES_MAJOR_SUITE: readonly string[] = [
  "tests/postgres-",
  "upgrade",
  "migration",
  "tests/db-",
  "tests/cov-db-",
  "tests/fk-on-delete",
  "tests/production-selection",
  "tests/quota-watch-sql-function",
  "tests/facet-read-indexes",
];

if (import.meta.main) {
  for (const major of testedPostgresMajors(readPostgresMajors())) {
    console.log(`\n== PostgreSQL ${major} ==`);
    const run = spawnSync("pnpm", ["exec", "vitest", "run", ...POSTGRES_MAJOR_SUITE], {
      stdio: "inherit",
      env: { ...process.env, JHO_TEST_POSTGRES_MAJOR: major },
    });
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
