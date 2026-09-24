/**
 * Estados de uma execução de trabalho longo e a regra de vencimento do lease.
 *
 * Puro: o instante chega como argumento. Uma regra só de vencimento para toda
 * fila com lease (execução de fonte, análise de vaga): duas regras divergiriam
 * sobre quando um processador morto deixa de prender o trabalho.
 *
 * Aqui também moram o que a tabela `source_run` guarda (#223, tarefa 02):
 * escopo, chave de idempotência, transições, composição do pai e redação do
 * erro. A infra só aplica o que estas funções decidem.
 */
import { redactSecrets } from "../../../core/observability.ts";

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted";

export const RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "interrupted",
] as const satisfies readonly RunStatus[];

/** Os estados que ocupam a chave de idempotência (índice único parcial). */
export const ACTIVE_RUN_STATUSES = ["queued", "running"] as const satisfies readonly RunStatus[];

/**
 * `running` sem batimento além do lease: o processador morreu ou perdeu a
 * conexão, e a linha precisa sair do estado ativo para não prender o trabalho
 * para sempre. Estado terminal nunca vence — nem `queued`, que ainda não tem
 * dono. Batimento ilegível conta como vencido: sem prova de vida, não há vida.
 */
export function isStale(run: { status: RunStatus; heartbeatAt: string }, now: string, leaseMs: number): boolean {
  if (run.status !== "running") return false;
  const beat = Date.parse(run.heartbeatAt);
  const at = Date.parse(now);
  if (Number.isNaN(beat)) return true;
  return at - beat > leaseMs;
}

export function isTerminal(status: RunStatus): boolean {
  return status !== "queued" && status !== "running";
}

/* ---------------------------------- escopo ---------------------------------- */

export type RunScope =
  /** Uma fonte. `parentId` presente = filha de uma execução "todas". */
  | { kind: "source"; sourceId: string; parentId?: number }
  | { kind: "all" }
  | { kind: "verify"; sourceId: string | null };

/** O que a fonte precisa ser para aceitar uma execução. */
export type RunnableSource = { id: string; enabled: boolean; retiredAt: string | null; revision: number };

export type RunRefusal = "source_not_found" | "source_disabled" | "source_retired";

/**
 * Fonte desabilitada ou aposentada recusa ANTES de criar execução: uma linha
 * `queued` que nunca vai rodar seria pior que a recusa, porque a tela a
 * mostraria como pendente para sempre.
 */
export function refuseRun(source: RunnableSource | null): RunRefusal | null {
  if (source === null) return "source_not_found";
  if (source.retiredAt !== null) return "source_retired";
  if (!source.enabled) return "source_disabled";
  return null;
}

/* ------------------------------- idempotência ------------------------------- */

/** FNV-1a de 64 bits: curto, estável e puro — a chave vai para um índice. */
function fingerprint(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * A revisão de um escopo com várias fontes: o conjunto de `(fonte, revisão)`,
 * não só a maior revisão — editar uma fonte de revisão menor que a de outra
 * também muda o pedido, e a chave precisa mudar junto. A spec pedia "a maior
 * revisão"; o conjunto é estritamente mais fiel e continua estável.
 */
export function catalogRevision(sources: readonly { id: string; revision: number }[]): string {
  const parts = sources.map((source) => `${source.id}@${source.revision}`).sort();
  return fingerprint(parts.join("\n"));
}

/**
 * Dois pedidos equivalentes, ativos ao mesmo tempo, são a mesma execução.
 *
 * Escopo de uma fonte usa a revisão dela; "todas" e verificação sem fonte usam
 * `catalogRevision()`. A filha de "todas" carrega o pai na chave: ela nunca
 * colide com um "Buscar agora" da mesma fonte, que é outro pedido.
 */
export function runKey(scope: RunScope, revision: number | string): string {
  switch (scope.kind) {
    case "source":
      return scope.parentId === undefined
        ? `source:${scope.sourceId}@${revision}`
        : `child:${scope.parentId}:${scope.sourceId}@${revision}`;
    case "all":
      return `all@${revision}`;
    case "verify":
      return `verify:${scope.sourceId ?? "*"}@${revision}`;
  }
}

/* --------------------------------- transições -------------------------------- */

export type RunEvent =
  | { type: "start" }
  | { type: "succeed" }
  | { type: "partial" }
  | { type: "fail" }
  | { type: "cancel" }
  | { type: "interrupt" };

/**
 * A transição, ou `null` quando recusada. Estado terminal não muda nunca: um
 * resultado atrasado não sobrescreve o que já foi decidido, e uma nova
 * tentativa é outra linha (`retry_of`), não esta reaberta.
 */
export function nextRunStatus(current: RunStatus, event: RunEvent): RunStatus | null {
  if (isTerminal(current)) return null;
  switch (event.type) {
    case "start":
      return current === "queued" ? "running" : null;
    case "succeed":
      return current === "running" ? "succeeded" : null;
    case "partial":
      return current === "running" ? "partial" : null;
    case "fail":
      // Falha pode vir antes de começar: o executor recusou o despacho.
      return "failed";
    case "cancel":
      return "cancelled";
    case "interrupt":
      return current === "running" ? "interrupted" : null;
  }
}

/**
 * O estado do pai a partir das filhas. Uma filha que falhou não esconde as
 * outras: o pai fica `partial` e cada filha mostra o seu. Enquanto houver
 * filha ativa, o pai continua `running`.
 */
export function composeParentStatus(children: readonly RunStatus[]): RunStatus {
  if (children.length === 0) return "succeeded";
  if (children.some((status) => !isTerminal(status))) return "running";
  const ok = children.filter((status) => status === "succeeded").length;
  if (ok === children.length) return "succeeded";
  if (ok === 0 && children.every((status) => status === "failed")) return "failed";
  return "partial";
}

/**
 * Uma execução `queued` que ninguém vai rodar sozinho: o despacho não saiu
 * (sem credencial, rede) ou saiu e sumiu (o GitHub cancela o pendente mais
 * velho de um grupo de concorrência). Ela segura a chave de idempotência, e o
 * pedido equivalente seguinte se junta a ela — então esse pedido a despacha de
 * novo, em vez de criar outra ou de responder "pedido" sem nada rodar.
 * Despachar duas vezes é inofensivo: só um executor ganha `queued → running`.
 */
export const REDISPATCH_AFTER_MS = 30 * 60_000;

export function shouldRedispatch(
  run: { status: string; errorCode: string | null; queuedAt: string },
  now: string,
): boolean {
  if (run.status !== "queued") return false;
  if (run.errorCode === "no_token" || run.errorCode === "dispatch_failed") return true;
  const queued = Date.parse(run.queuedAt);
  return Number.isNaN(queued) || Date.parse(now) - queued > REDISPATCH_AFTER_MS;
}

/** Quem pode tentar de novo: o que terminou sem sucesso. */
export function isRetryable(status: RunStatus): boolean {
  return status === "failed" || status === "partial" || status === "interrupted" || status === "cancelled";
}

/* ---------------------------------- contagens --------------------------------- */

export type RunCounts = {
  fetched: number | null;
  inserted: number | null;
  updated: number | null;
  unchanged: number | null;
  closed: number | null;
  alive: number | null;
  inconclusive: number | null;
};

export const UNKNOWN_COUNTS: RunCounts = {
  fetched: null,
  inserted: null,
  updated: null,
  unchanged: null,
  closed: null,
  alive: null,
  inconclusive: null,
};

/**
 * Soma das filhas para o pai. Uma contagem só é conhecida no pai quando é
 * conhecida em TODA filha: somar só as conhecidas mostraria um número menor
 * que o real como se fosse o total. Desconhecido não vira zero (US-009.EC-2).
 */
export function sumCounts(children: readonly RunCounts[]): RunCounts {
  const total: RunCounts = { ...UNKNOWN_COUNTS };
  if (children.length === 0) return total;
  for (const key of Object.keys(total) as (keyof RunCounts)[]) {
    let sum = 0;
    let known = true;
    for (const child of children) {
      const value = child[key];
      if (value === null) {
        known = false;
        break;
      }
      sum += value;
    }
    total[key] = known ? sum : null;
  }
  return total;
}

/* ---------------------------------- redação ---------------------------------- */

export const ERROR_DETAIL_MAX = 500;
export const EVIDENCE_MAX = 280;

const URL_WITH_QUERY = /\b(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi;
const EMAIL = /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi;
// Candidato a telefone: dígitos com separadores comuns. Só vira telefone com
// dez dígitos ou mais — data (`2026-09-23`), porta e código HTTP ficam.
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{6,}\d/g;
const PHONE_MIN_DIGITS = 10;

/**
 * Texto de erro ou de evidência que pode ser gravado: URL sem query string
 * nem fragmento, sem e-mail, sem telefone, sem credencial reconhecível e no
 * máximo `max` caracteres. A query sai inteira porque é onde token e termo de
 * busca costumam morar.
 */
export function redactDetail(text: string, max: number): string {
  const cleaned = redactSecrets(
    text
      .replace(URL_WITH_QUERY, "$1")
      .replace(EMAIL, "[redigido]")
      .replace(PHONE_CANDIDATE, (match) =>
        match.replace(/\D/g, "").length >= PHONE_MIN_DIGITS ? "[redigido]" : match,
      ),
  )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

/* -------------------------------- concorrência -------------------------------- */

/**
 * Reserva síncrona de vagas de execução (G13): conferir e ocupar acontecem no
 * mesmo tique, antes de qualquer `await`, então N chamadas simultâneas nunca
 * passam do teto. Quem não conseguiu slot fica enfileirado com o motivo.
 */
export function createRunLimiter(max: number): { tryAcquire(): boolean; release(): void; inUse(): number } {
  let used = 0;
  return {
    tryAcquire() {
      if (used >= max) return false;
      used++;
      return true;
    },
    release() {
      if (used > 0) used--;
    },
    inUse: () => used,
  };
}
