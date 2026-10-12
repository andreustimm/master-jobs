/**
 * A fachada da área do recrutador e das sugestões de vaga (#465, task_04).
 *
 * Cada função recebe a SESSÃO e confere a política de novo, como segunda
 * barreira além da guarda da página ou da action (regra 15): estas funções
 * podem ser chamadas de outro lugar amanhã. O id do candidato que o
 * recrutador manda é seletor dentro de `linkedCandidateIds` — a política
 * decide com ele, e o resto do escopo (concessão vigente, autor da sugestão)
 * vem da sessão.
 */
import { clock } from "../../core/clock.ts";
import { currentDocument, getCandidateById } from "../../core/candidate.ts";
import { getDb } from "../../core/db/client.ts";
import {
  pipelineCounts,
  recruiterCandidateSummaries,
  recruiterFunnelRows,
  type RecruiterCandidateSummary,
} from "../../core/db/repo.ts";
import {
  activeRecruiterGrantIds,
  authorize,
  candidateScope,
  configuredMailer,
  currentRecruiterGrantId,
  recordEmailSendFailure,
  recruiterGrantSummaries,
  resolvePublicOrigin,
  touchRecruiterAccess,
  type Session,
} from "../auth/index.ts";
import {
  candidateSuggestionsView,
  decideSuggestion,
  recruiterSuggestionsView,
  sendDueDigests,
  suggestJob,
  type CandidateSuggestionView,
  type DecideResult,
  type RecruiterSuggestionView,
  type SuggestionDeps,
  type SuggestResult,
} from "./app/recruiter-suggestions.ts";
import { RECRUITER_FUNNEL_PAGE_SIZE, RECRUITER_LIST_PAGE_SIZE, cvFileName, pageWithin } from "./domain/recruiter-view.ts";
import { drizzleRecruiterSuggestions } from "./infra/drizzle-recruiter-suggestions.ts";

/** Vagas por busca na tela de sugerir (TechSpec, `/recruiter/[id]/suggest`). */
const SUGGEST_SEARCH_LIMIT = 20;

function suggestionDeps(origin: string | null): SuggestionDeps {
  return {
    store: drizzleRecruiterSuggestions,
    mailer: () => configuredMailer(),
    recordFailure: recordEmailSendFailure,
    now: () => clock().now(),
    origin,
  };
}

function followed(candidateId: number) {
  return { kind: "candidate" as const, candidateId };
}

/* ------------------------------ Recrutador -------------------------------- */

export type RecruiterCandidateListView = {
  rows: (RecruiterCandidateSummary & { pending: number })[];
  total: number;
  page: number;
  pages: number;
};

/**
 * `/recruiter`: os candidatos com concessão vigente desta sessão, 25 por
 * página por nome, com desde, até e as sugestões dele ainda pendentes
 * (US-005, US-013).
 */
export async function recruiterCandidateList(session: Session, rawPage: string | string[] | undefined): Promise<RecruiterCandidateListView> {
  const grants = await recruiterGrantSummaries(session);
  const total = grants.length;
  const page = pageWithin(rawPage, total, RECRUITER_LIST_PAGE_SIZE);
  const rows = await recruiterCandidateSummaries(grants, { page, pageSize: RECRUITER_LIST_PAGE_SIZE });
  const pending = await drizzleRecruiterSuggestions.pendingByCandidate(
    session.userId,
    grants.map((grant) => grant.grantId),
  );
  return {
    rows: rows.map((row) => ({ ...row, pending: pending.get(row.candidateId) ?? 0 })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / RECRUITER_LIST_PAGE_SIZE)),
  };
}

export type RecruiterCandidateWorkspace = {
  name: string;
  headline: string | null;
  counts: Record<string, number>;
  total: number;
  funnel: { rows: Awaited<ReturnType<typeof recruiterFunnelRows>>; page: number; pages: number };
  suggestions: RecruiterSuggestionView;
};

/**
 * A página do candidato acompanhado (US-014, US-019): funil só de leitura,
 * paginado, e as sugestões DESTE recrutador na concessão vigente. Abrir grava
 * o último acesso que o candidato vê (no máximo uma vez por minuto).
 */
export async function recruiterCandidateWorkspace(
  session: Session,
  candidateId: number,
  query: { page: string | string[] | undefined; suggestionsPage: string | string[] | undefined },
): Promise<RecruiterCandidateWorkspace | null> {
  authorize(session, "candidate:read", followed(candidateId));
  const person = await getCandidateById(candidateId);
  if (!person) return null;
  await touchRecruiterAccess(session, candidateId);
  // Em série: o pool é pequeno, e a página já pode ter outra leitura em voo.
  const counts = await pipelineCounts(candidateId);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const page = pageWithin(query.page, total, RECRUITER_FUNNEL_PAGE_SIZE);
  const rows = await recruiterFunnelRows(candidateId, {
    limit: RECRUITER_FUNNEL_PAGE_SIZE,
    offset: (page - 1) * RECRUITER_FUNNEL_PAGE_SIZE,
  });
  const grantId = await currentRecruiterGrantId(getDb(), session.userId, candidateId);
  const suggestions = await recruiterSuggestionsView(
    { recruiterUserId: session.userId, candidateId, grantId, page: query.suggestionsPage },
    { store: drizzleRecruiterSuggestions },
  );
  return {
    name: person.name,
    headline: person.headline,
    counts,
    total,
    funnel: { rows, page, pages: Math.max(1, Math.ceil(total / RECRUITER_FUNNEL_PAGE_SIZE)) },
    suggestions,
  };
}

/** O nome do candidato acompanhado, para o título da aba (US-013.AC-2). */
export async function followedCandidateName(session: Session, candidateId: number): Promise<{ name: string; headline: string | null } | null> {
  authorize(session, "candidate:read", followed(candidateId));
  const person = await getCandidateById(candidateId);
  return person ? { name: person.name, headline: person.headline } : null;
}

export type RecruiterCv =
  | { state: "none" }
  | { state: "unavailable" }
  | { state: "ready"; content: string; fileName: string };

/**
 * O currículo atual do candidato, como ele enviou (US-015): só a versão
 * corrente, nunca a lista de versões. Abrir grava o último acesso.
 */
export async function recruiterCandidateCv(
  session: Session,
  candidateId: number,
): Promise<{ name: string; headline: string | null; cv: RecruiterCv } | null> {
  authorize(session, "candidate:read", followed(candidateId));
  const person = await getCandidateById(candidateId);
  if (!person) return null;
  await touchRecruiterAccess(session, candidateId);
  const document = await currentDocument(candidateId, "cv");
  const cv: RecruiterCv =
    document === null
      ? { state: "none" }
      : document.content.trim() === ""
        ? { state: "unavailable" }
        : { state: "ready", content: document.content, fileName: cvFileName(person.name) };
  return { name: person.name, headline: person.headline, cv };
}

/** Vagas abertas do acervo por título ou empresa, para o recrutador escolher. */
export function searchJobsToSuggest(session: Session, candidateId: number, query: string) {
  authorize(session, "suggestion:create", followed(candidateId));
  return drizzleRecruiterSuggestions.searchOpenJobs(query, SUGGEST_SEARCH_LIMIT);
}

/** Sugere uma vaga a um candidato acompanhado (US-018). `origin` monta o link do aviso (G17). */
export function suggestJobToCandidate(
  session: Session,
  input: { candidateId: number; jobId: number; note: string },
  origin: string | null,
): Promise<SuggestResult> {
  authorize(session, "suggestion:create", followed(input.candidateId));
  return suggestJob(
    { ...input, recruiterUserId: session.userId, recruiterEmail: session.email },
    suggestionDeps(origin),
  );
}

/* ------------------------------- Candidato -------------------------------- */

/** O candidato que esta sessão decide — o DELA, e só fora de empréstimo (G24). */
function ownDecisionScope(session: Session): number {
  const candidateId = candidateScope(session);
  authorize(session, "suggestion:decide", candidateId === null ? { kind: "global" } : followed(candidateId));
  return candidateId as number;
}

/** Aceita ou recusa uma sugestão do próprio candidato (US-021, US-022). */
export function decideRecruiterSuggestion(
  session: Session,
  suggestionId: number,
  decision: "accept" | "decline",
): Promise<DecideResult> {
  const candidateId = ownDecisionScope(session);
  return decideSuggestion(
    { suggestionId, candidateId, actorUserId: session.userId, decision },
    { store: drizzleRecruiterSuggestions, now: () => clock().now() },
  );
}

/** `/suggestions`: lê o candidato da sessão; a sessão emprestada também lê (US-020.EC-6). */
export async function candidateSuggestionsFor(session: Session, rawPage: string | string[] | undefined): Promise<CandidateSuggestionView> {
  const candidateId = candidateScope(session);
  authorize(session, "candidate:read", candidateId === null ? { kind: "global" } : followed(candidateId));
  return candidateSuggestionsView(
    { candidateId: candidateId as number, page: rawPage, activeGrantIds: await activeRecruiterGrantIds(candidateId as number) },
    { store: drizzleRecruiterSuggestions },
  );
}

/** Quantas sugestões esperam o candidato desta sessão; sem candidato, zero (US-020.AC-3). */
export async function pendingSuggestionCount(session: Session | null): Promise<number> {
  const candidateId = candidateScope(session);
  return candidateId === null ? 0 : drizzleRecruiterSuggestions.pendingCount(candidateId);
}

/* ------------------------------- Varredura -------------------------------- */

/**
 * O passo de avisos agrupados do trabalho horário `manutencao:recruiter-access`
 * (ADR-016). A origem dos links vem só do ambiente: a varredura não tem
 * requisição de onde ler um `Host`.
 */
export function sendSuggestionDigests(): Promise<{ digests: number }> {
  return sendDueDigests(suggestionDeps(resolvePublicOrigin(process.env, { host: null, proto: "https" })));
}
