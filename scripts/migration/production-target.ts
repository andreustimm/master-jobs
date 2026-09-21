export const PRODUCTION_PROJECT_REF = "bujawvnxwtmneiggizje";
/** A região do banco está no nome do host; `tests/function-region.test.ts` a cruza com `vercel.json`. */
export const PRODUCTION_POOLER_HOST = "aws-0-sa-east-1.pooler.supabase.com";

/** One-off migration scope: never accept a different project or TLS override. */
export function assertProductionTarget(value: string | undefined): string {
  let url: URL;
  try { url = new URL(value ?? ""); }
  catch { throw new Error("DATABASE_MIGRATION_URL inválida (valor omitido)"); }
  const direct = url.hostname === `db.${PRODUCTION_PROJECT_REF}.supabase.co` && url.username === "postgres";
  const pooler = url.hostname === PRODUCTION_POOLER_HOST && url.username === `postgres.${PRODUCTION_PROJECT_REF}`;
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.pathname !== "/postgres" || !url.password ||
      !["", "5432"].includes(url.port) || url.search || url.hash || !(direct || pooler)) {
    throw new Error("Destino de migração não corresponde ao master-jobs autorizado");
  }
  return url.toString();
}
