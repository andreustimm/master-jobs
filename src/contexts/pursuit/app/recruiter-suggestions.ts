/**
 * Casos de uso das sugestões de vaga (#465, ADR-003, ADR-015, ADR-016).
 *
 * Orquestra; não decide nem grava. A regra é de
 * `domain/recruiter-suggestion.ts`; a transação com trava, limite e histórico
 * é do store. Aqui fica a ordem: validar a nota, gravar, e só DEPOIS do
 * commit avisar o candidato — no máximo um e-mail por recrutador e candidato
 * por hora. Falha de envio vira `auth_event(email_send_failed)` e devolve o
 * lote à fila da varredura; a sugestão continua valendo (US-018.EC-11).
 *
 * Nenhuma função recebe sessão: o candidato e o recrutador chegam já tirados
 * dela pela fachada (`index.ts`), que confere a política.
 */
import { DEFAULT_LOCALE, isLocale, type LocaleId } from "../../../core/i18n/index.ts";
import type { Mailer } from "../../auth/index.ts";
import { suggestionsDigestEmail } from "../../auth/index.ts";
import { validateNote, type SuggestError } from "../domain/recruiter-suggestion.ts";
import type {
  CandidateSuggestionRow,
  DigestBatch,
  PageParam,
  RecruiterSuggestionRow,
  RecruiterSuggestionStore,
} from "../infra/drizzle-recruiter-suggestions.ts";

export type SuggestionDeps = {
  store: RecruiterSuggestionStore;
  mailer(): Mailer;
  /** Registro para o operador quando o aviso não sai; só o tipo da mensagem. */
  recordFailure(userId: number | null, detail: string): Promise<void>;
  now(): number;
  /** Origem pública do link para `/suggestions` (G17). Nula: o aviso conta como falha. */
  origin: string | null;
};

export type SuggestResult =
  | { ok: true; kind: "create" | "join" }
  | { ok: false; error: SuggestError; retryAt?: string };

export type DecideResult = { ok: true } | { ok: false; error: "not_found" | "already_decided" };

function localeOf(value: string | null): LocaleId {
  return isLocale(value ?? undefined) ? (value as LocaleId) : DEFAULT_LOCALE;
}

function iso(deps: Pick<SuggestionDeps, "now">): string {
  return new Date(deps.now()).toISOString();
}

/**
 * Manda um lote já reservado. Sem link, sem destinatário, erro do provedor ou
 * exceção do adapter dão no mesmo: registro e o lote volta a ficar sem aviso.
 */
async function deliver(deps: SuggestionDeps, batch: DigestBatch): Promise<boolean> {
  let delivered = false;
  if (deps.origin !== null && batch.to !== null) {
    const mail = suggestionsDigestEmail({
      locale: localeOf(batch.locale),
      recruiterName: batch.recruiterName,
      items: batch.items,
      url: `${deps.origin}/suggestions`,
    });
    try {
      delivered = (await deps.mailer().send({ to: batch.to, subject: mail.subject, text: mail.text })).ok;
    } catch {
      delivered = false;
    }
  }
  if (!delivered) {
    await deps.recordFailure(batch.recruiterUserId, "suggestions");
    await deps.store.releaseDigest(batch.byIds, batch.stamp);
  }
  return delivered;
}

/** Avisa agora, se não houve aviso deste recrutador a este candidato na última hora. */
async function notify(deps: SuggestionDeps, recruiterUserId: number, candidateId: number): Promise<boolean> {
  const batch = await deps.store.claimDigest({ recruiterUserId, candidateId, nowIso: iso(deps) });
  return batch === null ? false : deliver(deps, batch);
}

/**
 * Sugere uma vaga do acervo (US-018). A nota passa pela validação antes de
 * qualquer escrita; o resto das recusas é do store, sob a trava do candidato.
 */
export async function suggestJob(
  input: { candidateId: number; jobId: number; recruiterUserId: number; recruiterEmail: string; note: string },
  deps: SuggestionDeps,
): Promise<SuggestResult> {
  const note = validateNote(input.note);
  if (!note.ok) return { ok: false, error: note.error };
  const result = await deps.store.suggest({
    candidateId: input.candidateId,
    jobId: input.jobId,
    recruiterUserId: input.recruiterUserId,
    recruiterEmail: input.recruiterEmail,
    note: note.value,
    nowIso: iso(deps),
  });
  if (!result.ok) return result;
  await notify(deps, input.recruiterUserId, input.candidateId);
  return { ok: true, kind: result.kind };
}

/** Aceita ou recusa, no escopo do candidato que a fachada tirou da sessão (US-021, US-022). */
export function decideSuggestion(
  input: { suggestionId: number; candidateId: number; actorUserId: number; decision: "accept" | "decline" },
  deps: Pick<SuggestionDeps, "store" | "now">,
): Promise<DecideResult> {
  return deps.store.decide({ ...input, nowIso: iso(deps) });
}

/**
 * O passo de avisos da varredura horária (ADR-016, passo 3): cada par com
 * sugestão sem aviso cujo último aviso tem uma hora ou mais recebe um e-mail
 * com tudo o que acumulou. Rodar de novo na mesma hora não acha nada.
 */
export async function sendDueDigests(deps: SuggestionDeps): Promise<{ digests: number }> {
  let digests = 0;
  for (const pair of await deps.store.pairsAwaitingDigest()) {
    if (await notify(deps, pair.recruiterUserId, pair.candidateId)) digests += 1;
  }
  return { digests };
}

export type CandidateSuggestionView = {
  rows: (Omit<CandidateSuggestionRow, "recruiters"> & {
    recruiters: { name: string; note: string | null; at: string; accessEnded: boolean }[];
  })[];
  page: number;
  pages: number;
  total: number;
};

/**
 * `/suggestions`: as sugestões do candidato, com quem sugeriu e se o acesso
 * daquele recrutador já acabou (US-020.EC-2) — decidir continua possível.
 */
export async function candidateSuggestionsView(
  input: { candidateId: number; page: PageParam; activeGrantIds: readonly number[] },
  deps: Pick<SuggestionDeps, "store">,
): Promise<CandidateSuggestionView> {
  const list = await deps.store.candidateList(input.candidateId, input.page);
  const active = new Set(input.activeGrantIds);
  return {
    ...list,
    rows: list.rows.map((row) => ({
      ...row,
      recruiters: row.recruiters.map(({ grantId, ...author }) => ({
        ...author,
        accessEnded: grantId === null || !active.has(grantId),
      })),
    })),
  };
}

export type RecruiterSuggestionView = { rows: RecruiterSuggestionRow[]; page: number; pages: number; total: number };

/** As sugestões deste recrutador na concessão vigente; sem concessão, nenhuma (US-017.AC-3). */
export async function recruiterSuggestionsView(
  input: { recruiterUserId: number; candidateId: number; grantId: number | null; page: PageParam },
  deps: Pick<SuggestionDeps, "store">,
): Promise<RecruiterSuggestionView> {
  if (input.grantId === null) return { rows: [], page: 1, pages: 1, total: 0 };
  return deps.store.recruiterList({ ...input, grantId: input.grantId });
}
