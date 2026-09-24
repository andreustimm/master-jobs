/**
 * Fila de reconferência: "esta vaga ainda existe?".
 *
 * Vaga não é permanente. O link expira, a empresa fecha a posição, o quadro
 * remove o anúncio — e nada disso chega até aqui sozinho: a sincronização só
 * sabe o que a fonte ainda lista, e várias fontes continuam listando anúncios
 * mortos. Medido no acervo: ~19% dos links de uma das fontes devolvem 404
 * enquanto a API os dá como abertos.
 *
 * Dois caminhos alimentam a MESMA fila, de propósito:
 *
 *   - **o botão**, quando a pessoa está olhando a vaga e quer saber agora;
 *   - **a varredura periódica**, que enfileira as mais antigas sem conferência.
 *
 * Uma fila só porque o trabalho é idêntico e a diferença é apenas prioridade.
 * Duas filas significariam duas implementações de backoff, dois lugares para
 * um claim vazar, e a chance de as duas discordarem sobre o que um 403 prova.
 *
 * Tabela, não Redis — ADR 0009, mesma decisão de `scrape/queue.ts`. O claim é
 * um `UPDATE ... RETURNING` único cujo WHERE reconfere o status, então dois
 * workers concorrentes nunca pegam a mesma tarefa.
 */
import { and, desc, eq, isNull, like, lt, or, sql } from "drizzle-orm";
import { clock } from "../clock.ts";
import { getDb } from "../db/client.ts";
import { job, verifyTask, type VerifyStatus } from "../db/schema.ts";
import { bestPrimaryFitByJob } from "../../contexts/matching/index.ts";
import { publicApplyUrl } from "../job-url.ts";
import type { LookupHost } from "../remote-url.ts";
import type { ReopenDecision } from "./lifecycle.ts";
import { probe, type ProbeVerdict } from "./probe.ts";
import { applyVerdict } from "./verdict.ts";
import type { RequestBudget } from "./request-budget.ts";
import { drizzleRequestBudget } from "./request-budget-store.ts";

export const MAX_ATTEMPTS = 3;

/** Backoff em minutos por tentativa. Longo o bastante para passar um bloqueio. */
const BACKOFF_MINUTES = [2, 15, 60];

/** Claim mais velho que isto foi abandonado por um worker morto. */
const STALE_CLAIM_MINUTES = 10;

/** Prioridade de quem pediu na tela: sempre acima da varredura. */
export const USER_PRIORITY = 1000;

function isoIn(minutes: number, now = clock().now()): string {
  return new Date(now + minutes * 60_000).toISOString();
}

export type ClaimedCheck = { id: number; jobId: number; url: string; attempts: number };

/**
 * Enfileira uma vaga para reconferência.
 *
 * Idempotente por construção: o índice único em `job_id` faz o terceiro clique
 * no botão atualizar a tarefa que já existe em vez de criar uma terceira. Sem
 * isso, um duplo clique viraria trabalho duplicado contra o site de terceiro —
 * exatamente o tipo de coisa que faz um quadro tomar bloqueio.
 *
 * Uma tarefa já concluída volta para `pending`: reconferir é justamente uma
 * operação que se repete.
 */
export async function enqueueVerify(
  jobId: number,
  opts: { origin?: "user" | "periodic"; priority?: number } = {},
): Promise<{ queued: boolean; reason?: "not-found" | "closed" | "unsupported-url" }> {
  const db = getDb();
  const rows = await db
    .select({
      url: job.url,
      applyUrl: job.applyUrl,
      closedAt: job.closedAt,
    })
    .from(job)
    .where(eq(job.id, jobId))
    .limit(1);

  const found = rows[0];
  if (!found) return { queued: false, reason: "not-found" };
  const url = publicApplyUrl(found);
  if (!url) {
    return { queued: false, reason: "unsupported-url" };
  }

  const origin = opts.origin ?? "user";
  const priority = opts.priority ?? (origin === "user" ? USER_PRIORITY : 0);
  const nowIso = clock().iso();

  await db
    .insert(verifyTask)
    .values({ jobId, url, origin, priority, status: "pending" })
    .onConflictDoUpdate({
      target: verifyTask.jobId,
      set: {
        status: "pending",
        url,
        origin,
        priority,
        attempts: 0,
        lastError: null,
        claimedAt: null,
        claimedBy: null,
        runAfter: null,
        updatedAt: nowIso,
      },
    });

  return { queued: true };
}

/**
 * Enfileira o que está há mais tempo sem conferência.
 *
 * Ordena por "nunca conferida" primeiro e depois pela conferência mais antiga.
 * O lote de `verify.ts` ordenava por fit, e o efeito era reconferir as mesmas
 * 200 melhores toda execução enquanto a cauda nunca era olhada. Guardar
 * `checked_at` é o que torna a varredura progressiva em vez de circular.
 */
export async function enqueueStale(opts: StaleOptions = {}): Promise<number> {
  const rows = await staleCandidates(opts);
  for (const row of rows) await enqueueVerify(row.id, { origin: "periodic", priority: 0 });
  return rows.length;
}

type StaleOptions = { minFit?: number; limit?: number; olderThanDays?: number; unseenDays?: number };

/**
 * A consulta da varredura, sem executar — exportada para o teste ler o plano.
 *
 * A melhor nota entra por junção com um agregado calculado uma vez
 * (`bestPrimaryFitByJob`), nunca por subconsulta por vaga.
 *
 * Abaixo do corte de nota, entra só a vaga que a fonte deixou de listar há
 * `unseenDays` (#291). Uma fonte de janela parcial não fecha por ausência
 * (`decideAbsenceClosure`), então a vaga que saiu da janela só fecha por
 * 404/410 aqui — e, sem esta segunda metade, a de nota baixa ficava aberta
 * para sempre. A que a fonte ainda lista não precisa de sondagem: a listagem
 * já é a prova de vida. Ela vem depois das acima do corte, e o volume é
 * limitado pelo orçamento diário da reconferência.
 */
export function staleCandidates(opts: StaleOptions = {}) {
  const minFit = opts.minFit ?? 55;
  const now = clock().now();
  const cutoff = new Date(now - (opts.olderThanDays ?? 7) * 86_400_000).toISOString();
  const unseenBefore = new Date(now - (opts.unseenDays ?? 3) * 86_400_000).toISOString();

  // Vaga sem nota vale 0, como antes: com `minFit` 0 ela ainda entra.
  const best = bestPrimaryFitByJob();
  const fit = sql`coalesce(${best.fit}, 0)`;
  return getDb()
    .with(best)
    .select({ id: job.id })
    .from(job)
    .leftJoin(best, eq(best.jobId, job.id))
    .where(
      and(
        isNull(job.closedAt),
        or(
          like(job.applyUrl, "http://%"),
          like(job.applyUrl, "https://%"),
          like(job.url, "http://%"),
          like(job.url, "https://%"),
        ),
        or(sql`${fit} >= ${minFit}`, lt(job.lastSeenAt, unseenBefore)),
        or(isNull(job.checkedAt), lt(job.checkedAt, cutoff)),
      ),
    )
    // Acima do corte primeiro; dentro de cada faixa, nunca conferida antes e
    // depois a conferência mais antiga.
    .orderBy(sql`${fit} < ${minFit}`, sql`${job.checkedAt} is not null`, job.checkedAt, desc(fit))
    .limit(opts.limit ?? 200);
}

export async function claimCheck(worker: string): Promise<ClaimedCheck | null> {
  const db = getDb();
  const nowIso = clock().iso();
  const staleBefore = isoIn(-STALE_CLAIM_MINUTES);

  const rows = await db
    .update(verifyTask)
    .set({ status: "checking", claimedAt: nowIso, claimedBy: worker, updatedAt: nowIso })
    .where(
      sql`${verifyTask.id} = (
        select id from production.verify_task
        where (
          status = 'pending'
          or (status = 'checking' and claimed_at < ${staleBefore})
        )
        and (run_after is null or run_after <= ${nowIso})
        order by priority desc, id asc
        limit 1 for update skip locked
      )`,
    )
    .returning({
      id: verifyTask.id,
      jobId: verifyTask.jobId,
      url: verifyTask.url,
      attempts: verifyTask.attempts,
    });

  return rows[0] ?? null;
}

/**
 * Grava o veredito.
 *
 * `gone` fecha a vaga; nada mais fecha — ver o invariante em `probe.ts`. E
 * `alive` **reabre**: uma vaga fechada por engano, ou que a empresa republicou,
 * volta ao quadro sozinha na próxima conferência. Sem isso, um único 404
 * transitório sumiria com a vaga para sempre.
 */
export async function recordVerdict(
  taskId: number,
  jobId: number,
  verdict: ProbeVerdict,
  status: number | null,
): Promise<ReopenDecision> {
  const db = getDb();
  const nowIso = clock().iso();

  // Evento e estado da vaga, juntos, pelo mesmo caminho do lote (`verdict.ts`).
  // Concluir a tarefa é só da fila, e fica fora da transação do veredito: uma
  // tarefa que não concluiu volta pelo claim vencido, e o evento repetido é
  // inofensivo.
  const { reopen } = await applyVerdict({ jobId, verdict, httpCode: status, checkedAt: nowIso });
  await db
    .update(verifyTask)
    .set({
      status: "done",
      claimedAt: null,
      claimedBy: null,
      lastError: null,
      updatedAt: nowIso,
    })
    .where(eq(verifyTask.id, taskId));

  return reopen;
}

export async function failCheck(taskId: number, error: string): Promise<void> {
  const db = getDb();
  const [current] = await db
    .select({ attempts: verifyTask.attempts })
    .from(verifyTask)
    .where(eq(verifyTask.id, taskId))
    .limit(1);

  const attempts = (current?.attempts ?? 0) + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;

  await db
    .update(verifyTask)
    .set({
      status: exhausted ? "failed" : "pending",
      attempts,
      lastError: error.slice(0, 500),
      claimedAt: null,
      claimedBy: null,
      runAfter: exhausted ? null : isoIn(BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]!),
      updatedAt: clock().iso(),
    })
    .where(eq(verifyTask.id, taskId));
}

export async function verifyStats(): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ status: verifyTask.status, n: sql<number>`count(*)` })
    .from(verifyTask)
    .groupBy(verifyTask.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

/** O que a interface mostra ao lado do botão. */
export async function pendingFor(jobId: number): Promise<VerifyStatus | null> {
  const db = getDb();
  const rows = await db
    .select({ status: verifyTask.status })
    .from(verifyTask)
    .where(eq(verifyTask.jobId, jobId))
    .limit(1);
  return (rows[0]?.status as VerifyStatus) ?? null;
}

export type RunResult = {
  checked: number;
  gone: number;
  alive: number;
  inconclusive: number;
  /** Presente quando a rodada parou porque o orçamento do dia acabou. */
  budgetExhausted?: true;
};

/**
 * Consome a fila até esvaziar.
 *
 * `delayMs` entre sondagens não é excesso de zelo: são sites de terceiros, e a
 * diferença entre um cliente educado e um bloqueio de IP é exatamente esta
 * pausa. `fetchImpl` é injetável para o teste não tocar a rede.
 */
export async function runVerifyQueue(
  opts: {
    worker?: string;
    max?: number;
    delayMs?: number;
    /**
     * Teto de tempo da rodada. Antes de reivindicar a próxima, supõe que ela
     * demora tanto quanto a mais lenta até aqui: começar uma sondagem que não
     * cabe na função da Vercel deixaria a tarefa `checking` até o claim vencer.
     */
    budgetMs?: number;
    fetchImpl?: typeof fetch;
    lookupHost?: LookupHost;
    /** O orçamento diário compartilhado; o padrão é o do banco (#291). */
    budget?: RequestBudget;
    onProgress?: (done: number, verdict: ProbeVerdict, url: string) => void;
  } = {},
): Promise<RunResult> {
  const budget = opts.budget ?? drizzleRequestBudget();
  const worker = opts.worker ?? `verify-${process.pid}`;
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  const result: RunResult = { checked: 0, gone: 0, alive: 0, inconclusive: 0 };
  const started = clock().now();
  let slowest = 0;
  let attempted = 0;

  while (result.checked < max) {
    if (opts.budgetMs !== undefined && attempted > 0 && clock().now() - started + slowest > opts.budgetMs) break;
    // A unidade do orçamento sai antes do claim: com o dia esgotado, a tarefa
    // fica `pending` para amanhã em vez de ser reivindicada e devolvida.
    // Um instante só para reservar e devolver: a devolução depois da virada
    // do dia UTC cairia no contador do dia seguinte.
    const reservedAt = clock().now();
    if (!(await budget.take("reconferencia", reservedAt))) {
      result.budgetExhausted = true;
      break;
    }
    const task = await claimCheck(worker);
    if (!task) {
      await budget.giveBack("reconferencia", reservedAt);
      break;
    }
    const began = clock().now();
    attempted++;

    try {
      // Com teto, a sondagem não passa do que resta: uma que começou aos 19 s
      // com o timeout padrão de 15 s terminaria depois do limite da função.
      // Esgotado vira timeout, e timeout é inconclusivo — não fecha nada.
      const left = opts.budgetMs === undefined ? undefined : Math.max(1_000, opts.budgetMs - (began - started));
      const { verdict, status } = await probe(task.url, {
        fetchImpl: opts.fetchImpl,
        lookupHost: opts.lookupHost,
        timeoutMs: left === undefined ? undefined : Math.min(15_000, left),
      });
      await recordVerdict(task.id, task.jobId, verdict, status);
      result.checked++;
      result[verdict]++;
      opts.onProgress?.(result.checked, verdict, task.url);
    } catch (error) {
      await failCheck(task.id, error instanceof Error ? error.message : String(error));
    }

    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    // A pausa entra na medida: é tempo que a próxima também vai gastar.
    slowest = Math.max(slowest, clock().now() - began);
  }

  return result;
}
