/**
 * Disponibilidade de uma vaga a partir dos eventos de verificação (#223,
 * tarefa 04). Puro: os eventos e o instante chegam como argumento.
 *
 * O que a tela pode afirmar é só o que um evento prova. Sem evento, a vaga é
 * "desconhecida" — não "aberta" nem "fechada" (US-014.EC-2). Com o último
 * veredito conclusivo velho demais, é "vencida": a checagem existiu, mas não
 * diz nada sobre hoje (US-014.EC-1).
 */
import type { ProbeVerdict } from "./probe.ts";

/**
 * Por que a vaga está como está. Só `closed` (404/410) tem evidência hoje;
 * `filled`, `cancelled` e `paused` ficam reservados para o adapter que um dia
 * provar isso — e nenhum prova.
 */
export type StatusReason = "closed" | "filled" | "cancelled" | "paused" | "unknown";

export type Availability = "open" | "closed" | "stale" | "unknown";

export type CheckEvent = { checkedAt: string; id: number; verdict: ProbeVerdict };

/** Janela depois da qual a última checagem deixa de valer como estado atual. */
export const AVAILABILITY_STALE_MS = 14 * 86_400_000;

/**
 * O motivo que o veredito sustenta. `gone` só existe para 404/410 (`classify`
 * em `probe.ts`), então é o único que carrega `closed`; o resto — vivo,
 * bloqueio de robô, 5xx, rede — não prova motivo nenhum.
 */
export function reasonFor(verdict: ProbeVerdict): StatusReason {
  return verdict === "gone" ? "closed" : "unknown";
}

/**
 * O que a sonda viu, em uma linha, para o evento: código (ou "sem resposta",
 * quando a rede falhou) e a URL sondada. `redactDetail` limita e tira query
 * string na gravação.
 */
export function probeEvidence(url: string, httpCode: number | null): string {
  return `${httpCode === null ? "sem resposta" : `HTTP ${httpCode}`} em ${url}`;
}

/** Ordem total dos eventos: `checked_at`, e `id` no empate. */
export function compareEvents(a: CheckEvent, b: CheckEvent): number {
  if (a.checkedAt !== b.checkedAt) return a.checkedAt < b.checkedAt ? -1 : 1;
  return a.id - b.id;
}

/** O evento mais recente pela ordem de `compareEvents`, ou `null`. */
export function latestEvent<T extends CheckEvent>(events: readonly T[]): T | null {
  let latest: T | null = null;
  for (const event of events) if (latest === null || compareEvents(event, latest) > 0) latest = event;
  return latest;
}

/**
 * O estado atual. Decide o evento CONCLUSIVO mais recente: um inconclusivo
 * (403, 5xx, rede) não prova nada e não muda o que o anterior provou (G26).
 * A ordem é por `checked_at` e `id`, nunca pela ordem de chegada — um evento
 * mais antigo que chega depois não reabre nem fecha.
 */
export function currentAvailability(events: readonly CheckEvent[], now: string, staleMs: number): Availability {
  const decisive = latestEvent(events.filter((event) => event.verdict !== "inconclusive"));
  if (decisive === null) return "unknown";
  if (Date.parse(now) - Date.parse(decisive.checkedAt) > staleMs) return "stale";
  return decisive.verdict === "gone" ? "closed" : "open";
}

/**
 * O estado que a tela mostra, conciliado com a linha da vaga. O sync fecha
 * (ausência numa listagem completa) e reabre (a vaga voltou à listagem) sem
 * evento de verificação, e o selo "Encerrada" da mesma tela lê `closed_at`:
 * sem conciliar, a página afirmaria dois fatos opostos. `closed_at` preenchido
 * é encerrada, venha de onde vier; um 404 que o sync já desmentiu não prova
 * mais nada sobre hoje, então vira desconhecida — nem aberta nem fechada.
 */
export function reconcileAvailability(fromEvents: Availability, closedAt: string | null): Availability {
  if (closedAt !== null) return "closed";
  return fromEvents === "closed" ? "unknown" : fromEvents;
}

/**
 * O instante contra o qual um veredito novo se compara para decidir o estado.
 * Conclusivo compara com o último CONCLUSIVO — é o mesmo evento que
 * `currentAvailability` usa, e comparar com um inconclusivo mais novo deixaria
 * a tela e a linha da vaga discordando. Inconclusivo não fecha nem reabre, só
 * atualiza a última checagem; compara com o último de qualquer tipo.
 */
export function gateInstant(verdict: ProbeVerdict, newest: { any: string | null; conclusive: string | null }): string | null {
  return verdict === "inconclusive" ? newest.any : newest.conclusive;
}

/**
 * Se um evento com este instante pode mudar o estado da vaga: só quando não há
 * evento mais novo já gravado. O evento velho entra no histórico mesmo assim.
 */
export function decidesState(checkedAt: string, newestRecorded: string | null): boolean {
  return newestRecorded === null || checkedAt >= newestRecorded;
}
