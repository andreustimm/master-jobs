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

/** Motivo da recusa, ou `null` quando o ambiente é seguro para o setup. */
export function isolationRefusal(env) {
  for (const name of ["DATABASE_URL", "DATABASE_MIGRATION_URL"]) {
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
  const email = env.E2E_EMAIL;
  if (email !== undefined && !/@local\.test$/i.test(email.trim())) {
    return "E2E_EMAIL precisa ser um endereço @local.test, nunca o de uma pessoa";
  }
  return null;
}
