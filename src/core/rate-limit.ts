/**
 * Janela deslizante em memória.
 *
 * **Em memória, e não em tabela.** A fila de raspagem mora em tabela porque a
 * tarefa precisa sobreviver a um reinício (ADR 0009). Um contador de requisição
 * é o oposto: perdê-lo no reinício é aceitável e até desejável — a janela
 * recomeça e ninguém fica bloqueado por causa de um deploy. Gravar em banco
 * acrescentaria uma escrita por leitura de página pública, que é exatamente o
 * custo que o limite existe para reduzir.
 *
 * Deslizante, e não fixa por intervalo: uma janela fixa deixa passar o dobro do
 * limite na virada — o fim de um intervalo e o começo do seguinte —, e é
 * justamente aí que um varredor bate.
 */
import { clock } from "./clock.ts";

export type RateLimitDecision = {
  allowed: boolean;
  /** Quantas ainda cabem na janela. Zero quando recusado. */
  remaining: number;
  /** Segundos até a requisição mais antiga sair da janela. */
  retryAfterSeconds: number;
};

export type RateLimiter = {
  check(key: string): RateLimitDecision;
  /** Só para teste: esvazia tudo. */
  reset(): void;
};

/**
 * Cria um limitador.
 *
 * `maxEntries` existe porque um processo longo atendendo muitos IPs cresceria
 * sem teto. Ao estourar, os baldes mais antigos são descartados — perder o
 * contador de quem parou de bater é inofensivo, e é sempre esse que envelhece
 * primeiro.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  maxEntries?: number;
}): RateLimiter {
  const { limit, windowMs, maxEntries = 10_000 } = options;
  // `Map` preserva ordem de inserção, e é o que torna o descarte do mais antigo
  // uma operação sem varredura.
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitDecision {
      const now = clock().now();
      const cutoff = now - windowMs;

      const previous = hits.get(key) ?? [];
      const live = previous.filter((at) => at > cutoff);

      if (live.length >= limit) {
        const oldest = live[0] ?? now;
        return {
          allowed: false,
          remaining: 0,
          // Arredonda para cima: devolver 0 mandaria o cliente tentar de novo
          // imediatamente, e ele seria recusado de novo.
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        };
      }

      live.push(now);
      // Reinsere para o balde ir para o fim da ordem: quem está batendo agora é
      // o último a ser descartado por pressão de memória.
      hits.delete(key);
      hits.set(key, live);

      while (hits.size > maxEntries) {
        const oldestKey = hits.keys().next().value;
        if (oldestKey === undefined) break;
        hits.delete(oldestKey);
      }

      return { allowed: true, remaining: limit - live.length, retryAfterSeconds: 0 };
    },

    reset() {
      hits.clear();
    },
  };
}

/**
 * O IP de quem pediu, a partir dos cabeçalhos.
 *
 * `x-forwarded-for` é falsificável por quem fala direto com o servidor, e por
 * isso só vale atrás de um proxy confiável. Sem cabeçalho — desenvolvimento, ou
 * acesso direto — todo mundo cai no mesmo balde: degradação conservadora, que
 * limita demais em vez de limitar de menos.
 *
 * O PRIMEIRO valor da lista é o cliente; os demais são a cadeia de proxies.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "sem-proxy";
}
