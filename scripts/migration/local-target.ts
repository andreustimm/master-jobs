/**
 * Local-only guard for the sanitized production fixture importer.
 *
 * A loopback host is required so a copy/paste of the command cannot write to
 * Supabase by accident. Query parameters are rejected by connectDatabase too;
 * rejecting them here keeps the command's target contract explicit.
 */
export function assertLocalTarget(value: string | undefined): string {
  let url: URL;
  try { url = new URL(value ?? ""); }
  catch { throw new Error("DATABASE_MIGRATION_URL inválida (valor omitido)"); }
  const localHost = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!localHost || !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.pathname === "/" || !url.pathname || !url.password || url.search || url.hash) {
    throw new Error("Importação local exige PostgreSQL em loopback, com banco e senha");
  }
  return url.toString();
}
