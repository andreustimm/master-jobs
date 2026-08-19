/**
 * Prepara o ambiente do e2e.
 *
 * Cria uma conta dedicada, com senha conhecida. O e2e nunca deve depender da
 * credencial real de ninguém: uma senha de teste no repositório é um segredo
 * publicado, e apontar o teste para a conta do usuário significa que trocar a
 * própria senha quebra a suíte — foi exatamente o que aconteceu.
 *
 * Também limpa as tentativas falhas dessa conta. A suíte tenta entrar com
 * senha errada de propósito, e o limite de 8 em 15 minutos é real: depois de
 * algumas execuções ele bloquearia o teste com uma proteção que funcionou.
 */
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/core/db/client.ts";
import { authEvent } from "../../src/core/db/schema.ts";
import { seedOwner } from "../../src/contexts/auth/app/seed.ts";
import { runMigrations } from "../../src/core/db/migrate.ts";

const EMAIL = process.env.E2E_EMAIL ?? "e2e@local.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "conta-de-teste-e2e-42";

try {
  await runMigrations();

  // `force` porque a senha precisa ser conhecida a cada execução, e esta conta
  // existe só para o teste.
  await seedOwner({ email: EMAIL, password: PASSWORD, force: true });

  const cleared = await getDb()
    .delete(authEvent)
    .where(and(eq(authEvent.kind, "login_failed"), eq(authEvent.email, EMAIL)))
    .returning({ id: authEvent.id });

  console.log(`e2e: conta ${EMAIL} pronta · ${cleared.length} tentativa(s) limpa(s)`);
} finally {
  closeDb();
}
