/**
 * As regras puras da sugestão de vaga do recrutador (#465, ADR-003, ADR-015).
 *
 * Sugestão é proposta, não candidatura: nada aqui decide escrever em
 * `application`. O aceite é que leva a vaga ao funil, e só quando ela ainda
 * não está lá — a candidatura que já existe fica como está (US-021.EC-2).
 *
 * Sem banco, rede nem relógio: o instante chega como argumento, e a contagem
 * do limite chega já decidida (`cap`), porque contar é do store, sob a trava
 * do candidato (ADR-017).
 */

/** Nota do recrutador, em caracteres (o CHECK do banco usa `char_length`). */
export const NOTE_MAX = 500;
/** Sugestões de um recrutador a um candidato numa janela de 24 h (ADR-006). */
export const SUGGESTION_DAILY_CAP = 20;
export const SUGGESTION_CAP_WINDOW_MS = 24 * 3_600_000;
/** No máximo um e-mail de sugestões por recrutador e candidato por hora (US-020.EC-5). */
export const DIGEST_INTERVAL_MS = 3_600_000;
/** Itens por página das listas de sugestão (TechSpec, "Constants"). */
export const SUGGESTIONS_PAGE_SIZE = 20;

export type SuggestionStatus = "pending" | "accepted" | "declined";

export type SuggestError =
  | "note_too_long"
  | "job_closed"
  | "already_suggested"
  | "already_decided_by_candidate"
  | "cap_reached"
  | "not_found";

/**
 * A nota como vai ser gravada: aparada, vazia vira `null`. Marcação e link
 * ficam como foram digitados — a tela os mostra como texto (US-018.EC-2).
 */
export function validateNote(raw: string): { ok: true; value: string | null } | { ok: false; error: "note_too_long" } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  // Por ponto de código, como `char_length` no PostgreSQL: um emoji conta um.
  if ([...trimmed].length > NOTE_MAX) return { ok: false, error: "note_too_long" };
  return { ok: true, value: trimmed };
}

export type SuggestDecision =
  | { kind: "create" }
  | { kind: "join"; suggestionId: number }
  | { kind: "refuse"; error: SuggestError; retryAt?: string };

/**
 * Criar, juntar-se à pendente de outro recrutador ou recusar.
 *
 * A ordem das recusas é a do que a pessoa pode fazer a respeito: vaga
 * encerrada não tem conserto, e por isso vence o limite (UT-057). `mine` é o
 * estado da sugestão mais recente DESTE recrutador para o par candidato e vaga
 * — pendente é repetição; decidida é decisão do candidato, que outra sugestão
 * do mesmo recrutador não reabre (US-022.EC-3).
 */
export function decideSuggest(input: {
  job: { closedAt: string | null; archivedAt: string | null };
  mine: SuggestionStatus | null;
  pendingSuggestionId: number | null;
  cap: { ok: true } | { ok: false; retryAt: string };
}): SuggestDecision {
  if (input.job.closedAt !== null || input.job.archivedAt !== null) return { kind: "refuse", error: "job_closed" };
  if (input.mine === "pending") return { kind: "refuse", error: "already_suggested" };
  if (input.mine === "accepted" || input.mine === "declined") {
    return { kind: "refuse", error: "already_decided_by_candidate" };
  }
  if (!input.cap.ok) return { kind: "refuse", error: "cap_reached", retryAt: input.cap.retryAt };
  if (input.pendingSuggestionId !== null) return { kind: "join", suggestionId: input.pendingSuggestionId };
  return { kind: "create" };
}

/**
 * O que o aceite faz (ADR-015). `applicationExists` é "a vaga já está no funil
 * do candidato": aí a sugestão só é marcada aceita, e a candidatura dele fica
 * com o status e o canal que tinha.
 */
export function decideAccept(input: {
  status: SuggestionStatus;
  applicationExists: boolean;
}): "insert_backlog" | "mark_only" | "already_decided" {
  if (input.status !== "pending") return "already_decided";
  return input.applicationExists ? "mark_only" : "insert_backlog";
}

/** Já passou uma hora do último aviso deste recrutador a este candidato? Sem aviso nenhum, sim. */
export function digestDue(lastSentAt: string | null, now: number): boolean {
  if (lastSentAt === null) return true;
  const last = Date.parse(lastSentAt);
  return Number.isNaN(last) || now - last >= DIGEST_INTERVAL_MS;
}
