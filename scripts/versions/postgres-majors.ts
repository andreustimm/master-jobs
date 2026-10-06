/**
 * Majors do PostgreSQL que o CI prova, lidas de `config/postgres-majors.json`.
 *
 * A produção é o Supabase gerenciado (`production`); a política de versões (issue #468) põe
 * os bancos descartáveis na mais nova. Testar só a mais nova deixaria a major
 * que guarda o dado de verdade sem prova nenhuma, então as duas são declaradas
 * num arquivo só e os testes de banco e o ensaio rodam em cada uma.
 *
 * Executado direto (`pnpm test:postgres-majors`), roda todo teste que usa
 * PostgreSQL real (`postgresDependentTests`) em cada major declarada, uma
 * depois da outra, e reprova na primeira falha.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { forbiddenReach } from "../../tests/support/module-graph.ts";

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

/** Os helpers que entregam um PostgreSQL real a um teste. */
export const POSTGRES_TEST_HELPERS: readonly string[] = ["tests/support/db.ts", "tests/support/postgres-global.ts"];

/**
 * Todo teste que usa PostgreSQL real, derivado do código e não de uma lista:
 * o arquivo de teste que alcança um dos `POSTGRES_TEST_HELPERS` por import de
 * valor (direto ou por outro helper de `tests/`), ou que lê
 * `JHO_TEST_POSTGRES_URL`. Uma lista escrita à mão deixava de fora o teste
 * novo — e era o acesso ao banco do dia a dia (candidatura, sessão, sugestão)
 * que ficava sem prova na major da produção. Caminhos relativos à raiz, em
 * ordem, prontos para virar filtro do Vitest.
 */
export function postgresDependentTests(root: string = process.cwd()): string[] {
  const inRoot = (file: string) => relative(root, resolve(root, file));
  const helpers = new Set(POSTGRES_TEST_HELPERS);
  const source = {
    read: (file: string) => readFileSync(resolve(root, file), "utf8"),
    // Só o grafo de `tests/`: o que entra em `src/` não sobe banco sozinho.
    resolve: (from: string, specifier: string) => {
      if (!specifier.startsWith(".")) return null;
      const target = inRoot(join(dirname(from), specifier));
      return target.startsWith("tests/") && existsSync(resolve(root, target)) ? target : null;
    },
  };
  const reaches = (file: string) =>
    forbiddenReach(file, (_specifier, resolved) => (resolved !== null && helpers.has(resolved) ? resolved : null), source) !== null;
  return readdirSync(resolve(root, "tests"), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => join("tests", name))
    .filter((file) => source.read(file).includes("JHO_TEST_POSTGRES_URL") || reaches(file))
    .sort();
}

/** O comando de uma major: o Vitest só sobre os testes de banco. */
export function postgresMajorRunArgs(tests: readonly string[]): string[] {
  if (tests.length === 0) throw new Error("nenhum teste de PostgreSQL encontrado em tests/");
  return ["exec", "vitest", "run", ...tests];
}

if (import.meta.main) {
  const args = postgresMajorRunArgs(postgresDependentTests());
  for (const major of testedPostgresMajors(readPostgresMajors())) {
    console.log(`\n== PostgreSQL ${major}: ${args.length - 3} arquivos de teste ==`);
    const started = Date.now();
    const run = spawnSync("pnpm", args, {
      stdio: "inherit",
      env: { ...process.env, JHO_TEST_POSTGRES_MAJOR: major },
    });
    console.log(`== PostgreSQL ${major}: ${Math.round((Date.now() - started) / 1000)} s ==`);
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
