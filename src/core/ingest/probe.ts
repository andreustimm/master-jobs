/**
 * Perguntar a um anúncio se ele ainda existe — e saber o que a resposta prova.
 *
 * Medido no acervo real: 5 de 26 links do Jobgether devolvem 404 enquanto a API
 * da fonte ainda os lista como abertos. ~19%, alinhado com a taxa de 18–27% de
 * "ghost jobs" que o benchmark de concorrentes encontrou. Um quadro onde um em
 * cada cinco links está morto é um quadro em que se para de confiar — e o custo
 * não é o clique perdido, é passar a duvidar também do ranking.
 *
 * A disciplina inteira está em não confundir "não consegui ver" com "não
 * existe":
 *
 *   404, 410                    → sumiu. Pode fechar.
 *   401, 403, 429               → o site está barrando robô. NÃO é prova de
 *                                 nada. O Himalayas faz isso em toda
 *                                 requisição; fechar num 403 apagaria vagas
 *                                 vivas.
 *   5xx, timeout, erro de rede  → não prova nada. Tenta outro dia.
 *
 * > **Invariante:** só 404 e 410 fecham um anúncio. Qualquer outra coisa deixa
 * > como está. Um fechamento errado é irrecuperável do ponto de vista de quem
 * > usa, porque a vaga some do quadro sem aviso.
 *
 * Separado de `verify.ts` porque agora há dois caminhos até aqui — o lote e a
 * fila sob demanda — e a regra de classificação precisa ser a mesma nos dois.
 * Duplicada, ela divergiria, e a divergência apareceria como vaga viva sumindo.
 */

import { safeRemoteFetch, type LookupHost } from "../remote-url.ts";

export type ProbeVerdict = "alive" | "gone" | "inconclusive";

/** Códigos que provam ausência. Deliberadamente curto. */
const GONE = new Set([404, 410]);

/**
 * Classifica um código HTTP (ou `null`, para falha de rede).
 *
 * Função pura, e é de propósito: é a única regra do sistema capaz de esconder
 * uma vaga boa por engano, então precisa ser testável sem rede.
 */
export function classify(status: number | null): ProbeVerdict {
  if (status === null) return "inconclusive";
  if (GONE.has(status)) return "gone";
  if (status >= 200 && status < 400) return "alive";
  return "inconclusive";
}

export type ProbeResult = { verdict: ProbeVerdict; status: number | null };

export async function probe(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; lookupHost?: LookupHost } = {},
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  const headers = { "user-agent": process.env.JHO_USER_AGENT ?? "job-hunt-os/0.1" };

  try {
    // HEAD primeiro: mais barato para os dois lados. Alguns quadros recusam,
    // e aí a recusa do método não diz nada sobre a vaga — tenta GET.
    const head = await safeRemoteFetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers,
    }, {
      fetchImpl: opts.fetchImpl,
      lookupHost: opts.lookupHost,
    });
    if (head.status !== 405 && head.status !== 501) {
      return { verdict: classify(head.status), status: head.status };
    }

    const get = await safeRemoteFetch(url, {
      method: "GET",
      signal: controller.signal,
      headers,
    }, {
      fetchImpl: opts.fetchImpl,
      lookupHost: opts.lookupHost,
    });
    return { verdict: classify(get.status), status: get.status };
  } catch {
    return { verdict: "inconclusive", status: null };
  } finally {
    clearTimeout(timer);
  }
}
