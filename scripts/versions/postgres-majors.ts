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
 * depois da outra, e reprova na primeira falha; o CI escolhe major e fatia
 * (`parseMajorRunOptions`).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { forbiddenReach } from "../../tests/support/module-graph.ts";

/**
 * `latest`: a mais nova publicada (bancos descartáveis). `production`: a do
 * Supabase de produção. `local`: a da imagem `supabase/postgres` mais nova
 * publicada, a do Compose local — a Supabase pode publicar uma major depois
 * do PostgreSQL, e o banco local precisa das extensões da distribuição dela.
 */
export type PostgresMajors = { latest: string; local: string; production: string };

const MAJOR = /^\d+$/;
const KEYS = ["latest", "local", "production"] as const;

/**
 * Lê e valida o arquivo. A ordem production ≤ local ≤ latest vale sempre: a
 * produção roda numa major da Supabase, que não passa da mais nova dela, que
 * não passa da mais nova do PostgreSQL. Fora dela é erro de edição.
 */
export function parsePostgresMajors(text: string): PostgresMajors {
  const parsed = JSON.parse(text) as Partial<Record<keyof PostgresMajors, unknown>>;
  for (const key of KEYS) {
    const value = parsed[key];
    if (typeof value !== "string" || !MAJOR.test(value)) throw new Error(`config/postgres-majors.json: \`${key}\` precisa ser uma major (ex.: "17")`);
  }
  const majors = { latest: parsed.latest as string, local: parsed.local as string, production: parsed.production as string };
  if (!(Number(majors.production) <= Number(majors.local) && Number(majors.local) <= Number(majors.latest))) {
    throw new Error(
      `config/postgres-majors.json: a ordem é production ≤ local ≤ latest, não ${majors.production} / ${majors.local} / ${majors.latest}`,
    );
  }
  return majors;
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

/** O comando de uma major: o Vitest só sobre os testes de banco, inteiros ou numa fatia. */
export function postgresMajorRunArgs(tests: readonly string[], shard: string | null = null): string[] {
  if (tests.length === 0) throw new Error("nenhum teste de PostgreSQL encontrado em tests/");
  return ["exec", "vitest", "run", ...(shard === null ? [] : [`--shard=${shard}`]), ...tests];
}

export type MajorRunOptions = { majors: string[]; shard: string | null };

/**
 * Sem argumento, todas as majors declaradas, a suíte inteira em cada (uso
 * local). O CI divide em matriz: `--major=production|latest` escolhe pela
 * chave do arquivo — o workflow nunca escreve o número — e `--shard=i/n`
 * passa a fatia ao Vitest.
 */
export function parseMajorRunOptions(argv: readonly string[], majors: PostgresMajors): MajorRunOptions {
  const options: MajorRunOptions = { majors: testedPostgresMajors(majors), shard: null };
  for (const arg of argv) {
    const key = /^--major=(.*)$/.exec(arg)?.[1];
    const slice = /^--shard=(.*)$/.exec(arg)?.[1];
    if (key !== undefined) {
      if (key !== "production" && key !== "latest") throw new Error(`--major aceita production ou latest, não "${key}"`);
      options.majors = [majors[key]];
    } else if (slice !== undefined) {
      const [index, total] = slice.split("/").map(Number);
      if (!/^[1-9]\d*\/[1-9]\d*$/.test(slice) || index! > total!) throw new Error(`--shard espera i/n com 1 ≤ i ≤ n, não "${slice}"`);
      options.shard = slice;
    } else {
      throw new Error(`argumento desconhecido: ${arg}`);
    }
  }
  return options;
}

if (import.meta.main) {
  const options = parseMajorRunOptions(process.argv.slice(2), readPostgresMajors());
  const tests = postgresDependentTests();
  const args = postgresMajorRunArgs(tests, options.shard);
  const scope = options.shard === null ? "" : `, fatia ${options.shard}`;
  for (const major of options.majors) {
    console.log(`\n== PostgreSQL ${major}: ${tests.length} arquivos de teste${scope} ==`);
    const started = Date.now();
    const run = spawnSync("pnpm", args, {
      stdio: "inherit",
      env: { ...process.env, JHO_TEST_POSTGRES_MAJOR: major },
    });
    console.log(`== PostgreSQL ${major}: ${Math.round((Date.now() - started) / 1000)} s ==`);
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
