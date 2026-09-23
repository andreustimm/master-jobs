/**
 * "Cron por segredo": a autorização das rotas que o agendador chama sem sessão.
 *
 * Quem chama (`pg_cron` + `pg_net` no Supabase, ADR 0025) não traz cookie, então
 * a sessão não serve. O segredo `CRON_SECRET` vem em `authorization: Bearer …`,
 * e esta é a única decisão sobre ele — toda rota de `/api/cron/` chama a mesma
 * função, para que uma rota nova não reinvente a comparação e erre.
 *
 * Pura: recebe o cabeçalho e o segredo esperado, não lê `process.env`.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuthorization =
  | { ok: true }
  /** Sem segredo configurado a rota fica FECHADA: erro de configuração não vira porta aberta. */
  | { ok: false; status: 503; code: "cron_secret_missing" }
  | { ok: false; status: 401; code: "cron_unauthorized" };

/**
 * Compara em tempo constante e sem vazar o tamanho.
 *
 * `===` sobre segredo devolve mais cedo no primeiro caractere diferente, e o
 * tempo de resposta entrega o prefixo a quem chamar em laço — e esta rota
 * atende quem quiser. Os dois lados passam por SHA-256 antes do
 * `timingSafeEqual`, que exige buffers do mesmo tamanho: comparar o tamanho
 * antes seria, ele mesmo, o vazamento.
 */
function sameSecret(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function authorizeCronRequest(authorization: string | null, expectedSecret: string | undefined): CronAuthorization {
  // Segredo em branco é segredo ausente: `CRON_SECRET=" "` aceitaria `Bearer  `.
  if (!expectedSecret?.trim()) return { ok: false, status: 503, code: "cron_secret_missing" };
  // Só `Bearer <segredo>`: aceitar o valor cru ampliaria a superfície sem motivo.
  return sameSecret(authorization ?? "", `Bearer ${expectedSecret}`)
    ? { ok: true }
    : { ok: false, status: 401, code: "cron_unauthorized" };
}
