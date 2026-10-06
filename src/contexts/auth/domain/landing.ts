/**
 * Para onde a pessoa vai depois de entrar (#464, ADR-012).
 *
 * Puro. Duas regras:
 *
 * 1. **`next` só aceita caminho relativo do próprio site.** Um `next` absoluto
 *    — ou que o navegador lê como absoluto — transforma o login num
 *    redirecionador aberto: o link "entre no Master Jobs" sai do nosso domínio,
 *    a pessoa entra de verdade, e cai numa página de quem atacou que imita a
 *    nossa. `//evil.test` e `/\evil.test` são absolutos para o navegador, apesar
 *    de começarem com barra; por isso a checagem não é só "começa com /".
 * 2. **Sem `next` válido, cada papel vai para a sua tela**, a mesma regra do
 *    login por senha (`app/login/actions.ts`): candidato no cockpit, o resto em
 *    Vagas — mandar um recrutador para `/` era o que o fazia cair em 403.
 */

/** Maior `next` aceito. Caminho do produto não chega perto; maior é lixo ou ataque. */
const MAX_NEXT_LENGTH = 2048;

/** Base fictícia só para o parser resolver o relativo e mostrar se ele escapa. */
const PROBE_ORIGIN = "http://next.invalid";

/**
 * O `next` como caminho relativo seguro, ou `null`.
 *
 * Devolve o caminho normalizado pelo parser de URL (o mesmo algoritmo que o
 * navegador usa), não o texto recebido: o que é conferido é o que é seguido.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_NEXT_LENGTH) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  // Barra invertida vira barra no parser de URL especial; `/\host` é `//host`.
  // Caractere de controle (tab, quebra de linha) o parser descarta em silêncio,
  // e `/\t/evil.test` viraria `//evil.test`.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Destino depois do login: o `next` seguro, ou a tela do papel.
 *
 * Se o papel pode ver o `next`, quem decide é a própria página, que chama
 * `requirePage` (regra 15): aqui só se garante que o destino é deste site.
 */
export function landingFor(roles: readonly string[], next: string | null | undefined): string {
  const safe = safeNext(next);
  if (safe !== null) return safe;
  return roles.includes("candidate") ? "/" : "/jobs";
}
