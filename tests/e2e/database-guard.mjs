/**
 * Onde o setup do e2e pode escrever.
 *
 * `setup.mjs` força senha, cria contas, grava currículo e muda visibilidade.
 * Rodado contra um banco que não é de teste, ele já fez isto: uma conta com
 * e-mail real, semeada com `E2E_EMAIL`, ficou ligada ao candidato do dono, foi
 * copiada para produção no corte para o Supabase e passou a abrir `/candidate`
 * com os dados dele.
 *
 * Lista de permissão, não de proibição: só loopback passa, e todo o resto —
 * Supabase, Turso, um host novo — recusa por omissão.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

// Todas as variáveis que `src/core/db/config.ts` consulta, runtime e migração.
// Conferir só `DATABASE_*` deixava `runMigrations` cair em
// `POSTGRES_URL_NON_POOLING` — a de produção, quando o `.env` a carrega.
const DATABASE_VARIABLES = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
];

/**
 * Motivo da recusa, ou `null` quando o ambiente é seguro para o e2e.
 *
 * Vale para `setup.mjs`, `ui.mjs` e `a11y.mjs`: o navegador também escreve
 * (conta, vaga, visibilidade), então o alvo HTTP passa pela mesma lista de
 * permissão que o banco (#435).
 *
 * Lacuna registrada (#435): banco no loopback com qualquer nome ainda passa.
 * Restringir a `jho_test_*`, como `setup-manual.ts`, impediria rodar
 * `test:e2e:external` contra o ambiente local de desenvolvimento, e é decisão
 * do dono.
 */
export function isolationRefusal(env) {
  for (const name of DATABASE_VARIABLES) {
    const value = env[name];
    if (value === undefined || value === "") {
      if (name === "DATABASE_URL") return "DATABASE_URL ausente";
      continue;
    }
    let host;
    try {
      host = new URL(value).hostname;
    } catch {
      return `${name} inválida`;
    }
    if (!LOOPBACK.has(host)) return `${name} aponta para ${host}, fora do loopback`;
  }
  // Vazia conta como ausente, como nas variáveis de banco acima.
  const testDatabase = env.JHO_TEST_DATABASE_URL;
  if (testDatabase !== undefined && testDatabase !== "" && testDatabase !== env.DATABASE_URL) {
    return "JHO_TEST_DATABASE_URL difere de DATABASE_URL";
  }
  // Ausente, `ui.mjs` e `a11y.mjs` usam http://127.0.0.1:3000. Vazia não cai no
  // padrão (eles leem com `??`), então é recusada como inválida.
  if (env.E2E_BASE !== undefined) {
    let host;
    try {
      host = new URL(env.E2E_BASE).hostname;
    } catch {
      return "E2E_BASE inválida";
    }
    if (!LOOPBACK.has(host)) return `E2E_BASE aponta para ${host}, fora do loopback`;
  }
  const email = env.E2E_EMAIL;
  if (email !== undefined && !/@local\.test$/i.test(email.trim())) {
    return "E2E_EMAIL precisa ser um endereço @local.test, nunca o de uma pessoa";
  }
  return null;
}

const NOT_COPIED = new Set([".git", ".next", "data", "node_modules"]);

/**
 * O que `run-isolated.mjs` copia do checkout para o build descartável.
 *
 * `.env*` fica de fora inteiro, exceto o molde `.env.example`. A lista antiga
 * nomeava `.env` e `.env.local` e deixava passar `.env.production` — a cópia
 * local das variáveis de produção. O `next build` o carrega, e o E2E rodado
 * num checkout que o tinha subiu com o `DATABASE_CA_CERT` de produção e
 * respondeu 500 já no `/login`. O servidor do harness nunca deve enxergar
 * configuração de ambiente real, nem a que não chega a conectar.
 */
export function copiedToHarness(relativePath) {
  if (!relativePath) return true;
  const top = relativePath.split(/[\\/]/)[0];
  if (NOT_COPIED.has(top)) return false;
  return !(top.startsWith(".env") && top !== ".env.example");
}
