/**
 * `ON CONFLICT` não fecha a janela inteira, e esta é a segunda tentativa.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` promete resultado atômico para UMA
 * sessão, não imunidade a corrida: a inserção especulativa escreve no índice
 * único antes de descobrir o conflito, e duas sessões que chegam exatamente
 * ali se cruzam — o PostgreSQL devolve `23505` em vez de converter para
 * UPDATE. Medido aqui com três execuções simultâneas do seed de fixtures sob
 * carga: o upsert em `job_fingerprint_idx` falhou em cerca de uma execução a
 * cada duas da suíte completa, e nunca isolado. Deploy simultâneo em dois
 * ambientes é o mesmo cenário, com o mesmo desfecho.
 *
 * A retentativa é segura porque só cobre escrita idempotente: na segunda
 * passada a linha conflitante já está commitada, o conflito é enxergado, e o
 * comando vira o UPDATE que ele já pretendia ser. Qualquer outro erro sobe na
 * hora — inclusive `23505` que persistiu, porque aí não é corrida, é dado.
 */

/** `unique_violation`. */
const DUPLICATE_KEY = "23505";

function isDuplicateKey(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (code === DUPLICATE_KEY) return true;
  // O drizzle embrulha o erro do driver e guarda o original em `cause`.
  return isDuplicateKey(cause);
}

/**
 * Executa uma escrita idempotente, reexecutando enquanto o banco disser que a
 * chave já existe. Só use com comando que possa rodar duas vezes sem efeito
 * extra — upsert, `DO NOTHING`, e nada além disso.
 */
export async function withDuplicateKeyRetry<T>(write: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      if (attempt >= attempts || !isDuplicateKey(error)) throw error;
    }
  }
}
