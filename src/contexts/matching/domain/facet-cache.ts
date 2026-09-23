/**
 * Cache das facetas da tela Vagas — as regras, sem relógio nem banco.
 *
 * Duas decisões moram aqui porque são as que podem vazar dado ou servir dado
 * velho, e por isso precisam ser testáveis exaustivamente:
 *
 * - **A chave.** Ela é a serialização canônica de TUDO que a consulta recebe,
 *   mais a pessoa e a versão do scorer. Nada é escolhido à mão: um campo novo
 *   na consulta entra na chave sem ninguém lembrar dele. Servir as facetas de
 *   um candidato a outro seria vazar contagens do funil alheio.
 * - **Validade e tamanho.** Entrada vence por idade (o sync e o score rodam
 *   fora do processo e não conseguem avisar) e o mapa tem teto de entradas,
 *   porque a função serverless tem memória limitada e vive por horas.
 */

/**
 * Serialização estável: objetos com as chaves em ordem, `undefined` omitido
 * (o mesmo que ausente para `boardFacets`), listas na ordem recebida.
 *
 * A ordem das listas é preservada de propósito. Ordená-las aumentaria o
 * acerto em `sources=a,b` × `sources=b,a`, mas exigiria saber quais listas são
 * conjuntos — e errar isso para uma lista ordenada serviria a resposta errada.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/**
 * A chave de uma leitura de facetas.
 *
 * `candidateId` vem da sessão, nunca da URL. `null` é o acervo sem escopo de
 * candidato (recrutador, administrador), que é outra resposta e outra entrada.
 */
export function facetCacheKey(candidateId: number | null, query: object, scorerVersion: string): string {
  return canonicalJson({ candidate: candidateId, query, scorer: scorerVersion });
}

export type TtlLruOptions = {
  /** Idade máxima de uma entrada, em milissegundos. */
  ttlMs: number;
  /** Teto de entradas; a menos usada recentemente sai primeiro. */
  maxEntries: number;
};

type Entry<V> = { value: V; storedAt: number };

export type TtlLru<V> = {
  /** O valor, se existe e ainda vale em `now`; conta como uso recente. */
  get(key: string, now: number): V | undefined;
  set(key: string, value: V, now: number): void;
  /** Remove as entradas cujo valor satisfaz o predicado. */
  deleteWhere(predicate: (value: V) => boolean): void;
  clear(): void;
  readonly size: number;
};

/**
 * Mapa com validade e teto, apoiado na ordem de inserção do `Map`: reinserir
 * a chave a leva para o fim, então a primeira chave é sempre a menos usada.
 *
 * O relógio é argumento, não dependência: quem chama decide que horas são, e
 * o teste atravessa a validade sem esperar.
 */
export function createTtlLru<V>(options: TtlLruOptions): TtlLru<V> {
  if (!(options.ttlMs > 0) || !Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
    throw new RangeError("ttlMs precisa ser positivo e maxEntries, inteiro positivo");
  }
  const entries = new Map<string, Entry<V>>();
  return {
    get(key, now) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      // Relógio que volta (ajuste de NTP) também invalida: uma idade negativa
      // não prova que a entrada é recente.
      const age = now - entry.storedAt;
      entries.delete(key);
      if (age >= options.ttlMs || age < 0) return undefined;
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, now) {
      entries.delete(key);
      entries.set(key, { value, storedAt: now });
      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
      }
    },
    deleteWhere(predicate) {
      for (const [key, entry] of entries) if (predicate(entry.value)) entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
