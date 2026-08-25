/**
 * Fila de repontuação, acionada por evento.
 *
 * ## O evento
 *
 * Salvar um currículo muda o que o ranking deveria dizer: é dele que sai o
 * perfil de matching, e do perfil sai a nota de cada vaga. Recalcular dentro do
 * pedido não cabe — são milhares de gravações, e quem acabou de colar o CV
 * ficaria olhando um formulário travado por minutos.
 *
 * `saveDocument` enfileira e devolve. A tela responde na hora, o trabalho
 * acontece depois, e o estado da fila é consultável.
 *
 * ## Por que tabela e não broker
 *
 * ADR 0009, a mesma decisão de `verify_task` e `scrape_task`: um processo, um
 * banco, e a fila inspecionável por `select`. Redis aqui seria uma peça de
 * infraestrutura a mais para coordenar um trabalhador só.
 *
 * ## A reivindicação é atômica
 *
 * `UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING` numa instrução. Dois
 * trabalhadores lendo antes de escrever pegariam a mesma tarefa e pontuariam o
 * mesmo candidato duas vezes — desperdício silencioso, porque o resultado é
 * idêntico e nada acusa.
 *
 * Claim pendurado volta a ser elegível depois de `MINUTOS_CLAIM_MORTO`: um
 * processo morto no meio não pode travar o candidato para sempre.
 */
import { eq, sql } from "drizzle-orm";
import { clock } from "../clock.ts";
import { getDb } from "../db/client.ts";
import { scoreTask } from "../db/schema.ts";
import { scoreAll } from "./apply.ts";
import { ensureMatchingProfile } from "../../contexts/matching/index.ts";

/**
 * Depois disto, uma tarefa reivindicada e não concluída volta para a fila.
 *
 * Dez minutos porque uma repontuação completa do acervo contra um banco remoto
 * leva minutos — um teto curto faria a fila reprocessar o que ainda está sendo
 * processado, e dois trabalhadores gravariam por cima um do outro.
 */
export const MINUTOS_CLAIM_MORTO = 10;

/** Quantas vezes tentar antes de desistir e marcar a falha. */
export const TENTATIVAS_MAX = 3;

export type OrigemScore = "cv" | "perfil" | "periodic";

function emMinutos(delta: number): string {
  return new Date(clock().now() + delta * 60_000).toISOString();
}

/**
 * Enfileira a repontuação de um candidato.
 *
 * Idempotente por candidato: salvar o currículo três vezes em dois minutos —
 * corrigir um erro, colar de novo, ajustar uma linha — produziria três
 * repontuações completas do acervo para chegar ao mesmo lugar. O índice único
 * transforma isso numa só, e a maior prioridade vence.
 */
export async function enqueueScore(
  candidateId: number,
  opts: { origin?: OrigemScore; priority?: number } = {},
): Promise<void> {
  const origin = opts.origin ?? "cv";
  // Pedido de gente esperando resultado entra acima da varredura periódica.
  const priority = opts.priority ?? (origin === "periodic" ? 0 : 10);
  const agora = clock().iso();

  await getDb()
    .insert(scoreTask)
    .values({ candidateId, origin, priority, status: "pending", updatedAt: agora })
    .onConflictDoUpdate({
      target: scoreTask.candidateId,
      set: {
        status: "pending",
        origin,
        // `max` para o pedido do usuário não ser rebaixado por uma varredura
        // que chegue depois dele e antes do trabalhador.
        priority: sql`max(${scoreTask.priority}, ${priority})`,
        attempts: 0,
        lastError: null,
        claimedAt: null,
        claimedBy: null,
        updatedAt: agora,
      },
    });
}

export type TarefaReivindicada = { id: number; candidateId: number; attempts: number };

export async function claimScore(worker: string): Promise<TarefaReivindicada | null> {
  const agora = clock().iso();
  const morto = emMinutos(-MINUTOS_CLAIM_MORTO);

  const linhas = await getDb()
    .update(scoreTask)
    .set({ status: "scoring", claimedAt: agora, claimedBy: worker, updatedAt: agora })
    .where(
      sql`${scoreTask.id} = (
        select id from score_task
        where status = 'pending'
           or (status = 'scoring' and claimed_at < ${morto})
        order by priority desc, id asc
        limit 1
      )`,
    )
    .returning({
      id: scoreTask.id,
      candidateId: scoreTask.candidateId,
      attempts: scoreTask.attempts,
    });

  return linhas[0] ?? null;
}

export type ResultadoFila = {
  processadas: number;
  pontuadas: number;
  falhas: number;
};

/**
 * Consome a fila.
 *
 * Um candidato por vez, de propósito: cada um percorre o acervo inteiro, e dois
 * em paralelo dobrariam a memória e a banda para terminar no mesmo tempo.
 */
export async function runScoreQueue(
  opts: { max?: number; worker?: string } = {},
): Promise<ResultadoFila> {
  const worker = opts.worker ?? "local";
  const teto = opts.max ?? Number.POSITIVE_INFINITY;
  const db = getDb();
  const resultado: ResultadoFila = { processadas: 0, pontuadas: 0, falhas: 0 };

  while (resultado.processadas < teto) {
    const tarefa = await claimScore(worker);
    if (!tarefa) break;

    try {
      // Deriva o perfil antes de pontuar: é para isso que o evento existe —
      // currículo novo, perfil novo, nota nova.
      const perfil = await ensureMatchingProfile(tarefa.candidateId);

      // Sem perfil próprio não se pontua. Pontuar com o padrão da instalação
      // daria a essa pessoa o ranking de outra, com a aparência de ser dela.
      if (perfil.estado !== "ja-tinha" && perfil.estado !== "derivado") {
        await db
          .update(scoreTask)
          .set({ status: "done", scored: 0, lastError: perfil.estado, updatedAt: clock().iso() })
          .where(eq(scoreTask.id, tarefa.id));
        resultado.processadas++;
        continue;
      }

      const r = await scoreAll(tarefa.candidateId, { all: true });
      await db
        .update(scoreTask)
        .set({ status: "done", scored: r.scored, lastError: null, updatedAt: clock().iso() })
        .where(eq(scoreTask.id, tarefa.id));

      resultado.processadas++;
      resultado.pontuadas += r.scored;
    } catch (erro) {
      const tentativas = tarefa.attempts + 1;
      // Esgotadas as tentativas, para de tentar: um currículo que quebra o
      // extrator quebraria de novo, e a fila giraria nele para sempre enquanto
      // os outros candidatos esperam.
      const status = tentativas >= TENTATIVAS_MAX ? "failed" : "pending";
      await db
        .update(scoreTask)
        .set({
          status,
          attempts: tentativas,
          lastError: erro instanceof Error ? erro.message.slice(0, 500) : String(erro),
          claimedAt: null,
          claimedBy: null,
          updatedAt: clock().iso(),
        })
        .where(eq(scoreTask.id, tarefa.id));

      resultado.processadas++;
      resultado.falhas++;
    }
  }

  return resultado;
}

/** O que a tela mostra sem precisar do trabalhador. */
export async function scoreQueueStatus(candidateId?: number): Promise<Record<string, number>> {
  const linhas = await getDb()
    .select({ status: scoreTask.status, n: sql<number>`count(*)` })
    .from(scoreTask)
    .where(candidateId === undefined ? undefined : eq(scoreTask.candidateId, candidateId))
    .groupBy(scoreTask.status);

  return Object.fromEntries(linhas.map((l) => [l.status, Number(l.n)]));
}

export type ScoreQueueSnapshot = {
  pending: number;
  scoring: number;
  done: number;
  failed: number;
  scored: number | null;
  lastError: string | null;
};

export type ScoreQueueDisplay = {
  state: "idle" | "pending" | "scoring" | "done" | "failed";
  scored: number | null;
};

/** Leitura privada de uma única fila, filtrada antes de qualquer dado sair do banco. */
export async function candidateScoreQueueStatus(
  candidateId: number,
): Promise<ScoreQueueSnapshot | null> {
  const [row] = await getDb()
    .select({
      status: scoreTask.status,
      scored: scoreTask.scored,
      lastError: scoreTask.lastError,
    })
    .from(scoreTask)
    .where(eq(scoreTask.candidateId, candidateId))
    .limit(1);

  if (!row) return null;

  return {
    pending: row.status === "pending" ? 1 : 0,
    scoring: row.status === "scoring" ? 1 : 0,
    done: row.status === "done" ? 1 : 0,
    failed: row.status === "failed" ? 1 : 0,
    scored: row.scored,
    lastError: row.lastError,
  };
}

/** Reduz o snapshot ao que a interface pode mostrar; erros internos não atravessam. */
export function scoreQueueDisplay(snapshot: ScoreQueueSnapshot | null): ScoreQueueDisplay {
  if (!snapshot) return { state: "idle", scored: null };
  if (snapshot.failed > 0) return { state: "failed", scored: snapshot.scored };
  if (snapshot.scoring > 0) return { state: "scoring", scored: snapshot.scored };
  if (snapshot.pending > 0) return { state: "pending", scored: snapshot.scored };
  if (snapshot.done > 0) return { state: "done", scored: snapshot.scored };
  return { state: "idle", scored: null };
}
