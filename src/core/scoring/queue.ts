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
import { and, eq, sql } from "drizzle-orm";
import { clock } from "../clock.ts";
import { getDb } from "../db/client.ts";
import { scoreTask } from "../db/schema.ts";
import { scoreAll } from "./apply.ts";
import { ensureMatchingProfile, type ResultadoPerfil } from "../../contexts/matching/index.ts";

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
        priority: sql`greatest(${scoreTask.priority}, ${priority})`,
        attempts: 0,
        lastError: null,
        // Pedido novo conta do zero: o total das fatias é deste pedido.
        scored: null,
        claimedAt: null,
        claimedBy: null,
        updatedAt: agora,
      },
    });
}

export type TarefaReivindicada = {
  id: number;
  candidateId: number;
  attempts: number;
  /** Notas já gravadas por fatias anteriores do mesmo pedido. */
  scored: number | null;
};

/**
 * A tarefa ainda é a que este trabalhador reivindicou.
 *
 * Editar uma trilha enquanto a repontuação roda re-enfileira o candidato: a
 * linha volta a `pending` com o alvo novo. Gravar `done` por cima, só pelo id,
 * apagaria esse pedido e deixaria a trilha editada com as notas antigas.
 */
function emExecucao(id: number) {
  return and(eq(scoreTask.id, id), eq(scoreTask.status, "scoring"));
}

/** Conclui a tarefa reivindicada — a menos que um pedido novo a tenha re-enfileirado. */
export async function finishScoreTask(id: number, scored: number, lastError: string | null): Promise<void> {
  await getDb()
    .update(scoreTask)
    .set({ status: "done", scored, lastError, updatedAt: clock().iso() })
    .where(emExecucao(id));
}

export async function claimScore(worker: string): Promise<TarefaReivindicada | null> {
  const agora = clock().iso();
  const morto = emMinutos(-MINUTOS_CLAIM_MORTO);

  const linhas = await getDb()
    .update(scoreTask)
    .set({ status: "scoring", claimedAt: agora, claimedBy: worker, updatedAt: agora })
    .where(
      sql`${scoreTask.id} = (
        select id from production.score_task
        where status = 'pending'
           or (status = 'scoring' and claimed_at < ${morto})
        order by priority desc, id asc
        limit 1 for update skip locked
      )`,
    )
    .returning({
      id: scoreTask.id,
      candidateId: scoreTask.candidateId,
      attempts: scoreTask.attempts,
      scored: scoreTask.scored,
    });

  return linhas[0] ?? null;
}

/**
 * Devolve à fila a tarefa que o prazo interrompeu, sem gastar tentativa.
 *
 * Não é falha: as notas já gravadas ficam, e quem pegar a tarefa depois
 * recomeça pelo que ainda está desatualizado. Contar como tentativa marcaria
 * `failed` o candidato cujo acervo só não cabe em uma execução.
 */
async function releaseScoreTask(id: number, scored: number): Promise<void> {
  await getDb()
    .update(scoreTask)
    .set({ status: "pending", scored, claimedAt: null, claimedBy: null, updatedAt: clock().iso() })
    .where(emExecucao(id));
}

export type ResultadoFila = {
  processadas: number;
  pontuadas: number;
  falhas: number;
  /** Tarefas que o prazo interrompeu e voltaram à fila com parte das notas gravadas. */
  adiadas: number;
  /** Parou pelo prazo, e não por fila vazia nem por `max`: ainda pode haver trabalho. */
  interrompida: boolean;
};

/**
 * Consome a fila.
 *
 * Um candidato por vez, de propósito: cada um percorre o acervo inteiro, e dois
 * em paralelo dobrariam a memória e a banda para terminar no mesmo tempo.
 *
 * Com `budgetMs`, cabe numa função serverless: não reivindica tarefa nova
 * depois do prazo, e a pontuação em andamento para entre dois lotes e volta à
 * fila (`releaseScoreTask`). Sem ele, drena até esvaziar — a varredura e a CLI.
 */
export async function runScoreQueue(
  opts: { max?: number; worker?: string; budgetMs?: number } = {},
): Promise<ResultadoFila> {
  const worker = opts.worker ?? "local";
  const teto = opts.max ?? Number.POSITIVE_INFINITY;
  const prazo = opts.budgetMs === undefined ? undefined : clock().now() + opts.budgetMs;
  const db = getDb();
  const resultado: ResultadoFila = {
    processadas: 0,
    pontuadas: 0,
    falhas: 0,
    adiadas: 0,
    interrompida: false,
  };

  while (resultado.processadas < teto) {
    // A primeira tarefa é reivindicada sempre: a fatia chamada tarde demais
    // ainda avança um lote, em vez de sair sem ter feito nada.
    if (prazo !== undefined && resultado.processadas > 0 && clock().now() >= prazo) {
      resultado.interrompida = true;
      break;
    }
    const tarefa = await claimScore(worker);
    if (!tarefa) break;

    try {
      // Deriva o perfil antes de pontuar: é para isso que o evento existe —
      // currículo novo, perfil novo, nota nova.
      const perfil = await ensureMatchingProfile(tarefa.candidateId);

      // Sem perfil próprio não se pontua. Pontuar com o padrão da instalação
      // daria a essa pessoa o ranking de outra, com a aparência de ser dela.
      if (perfil.estado !== "ja-tinha" && perfil.estado !== "derivado") {
        await finishScoreTask(tarefa.id, 0, perfil.estado);
        resultado.processadas++;
        continue;
      }

      // Incremental, não `all`: o hash do perfil efetivo é por trilha, então só
      // a trilha editada (ou todas, quando a pessoa mudou) aparece desatualizada
      // — editar uma trilha recalcula só ela (regra 28 do PRD).
      const r = await scoreAll(tarefa.candidateId, { deadline: prazo });
      // Somado às fatias anteriores: a tela diz quantas vagas o pedido pontuou,
      // e não só quantas a última execução alcançou.
      const acumulado = (tarefa.scored ?? 0) + r.scored;
      resultado.pontuadas += r.scored;

      if (!r.complete) {
        await releaseScoreTask(tarefa.id, acumulado);
        resultado.adiadas++;
        resultado.interrompida = true;
        break;
      }

      await finishScoreTask(tarefa.id, acumulado, null);
      resultado.processadas++;
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
        .where(emExecucao(tarefa.id));

      resultado.processadas++;
      resultado.falhas++;
    }
  }

  return resultado;
}

/**
 * Orçamento da fatia no `after()` de quem salvou o currículo.
 *
 * A função serverless morre em 30 s (`vercel.json`), e o prazo só é conferido
 * entre dois lotes — a fatia passa dele por até um lote e uma página de leitura.
 * No `after()` o relógio da função já correu durante a própria ação (ler um
 * PDF, gravar o documento), então 20 s deixa folga para as duas coisas. É o
 * mesmo orçamento da varredura fatiada (`SWEEP_BUDGET_MS`).
 */
export const SCORE_SLICE_MS = 20_000;

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

/**
 * Por que a derivação do perfil recusou, na chave que a tela traduz.
 *
 * Recusa não é falha: nada quebrou, e a saída está na mão de alguém — da
 * pessoa (currículo ausente ou sem skill reconhecida) ou da instalação
 * (catálogo vazio). Mostrar "falhou" sem dizer qual das duas deixava quem
 * colou um currículo curto sem trilha, sem nota e sem saber o que fazer.
 */
export type ScoreRefusal = "noCv" | "weakCv" | "emptyCatalog";

/** O código gravado em `lastError` por `runScoreQueue` → o motivo que a tela mostra. */
const REFUSALS: Readonly<Record<Exclude<ResultadoPerfil["estado"], "ja-tinha" | "derivado">, ScoreRefusal>> = {
  "sem-curriculo": "noCv",
  "curriculo-fraco": "weakCv",
  "catalogo-vazio": "emptyCatalog",
};

export type ScoreQueueDisplay =
  | { state: "idle" | "noCv" | "pending" | "scoring" | "done" | "failed"; scored: number | null }
  | { state: "refused"; scored: number | null; reason: ScoreRefusal };

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
export function scoreQueueDisplay(
  snapshot: ScoreQueueSnapshot | null,
  hasCv = true,
): ScoreQueueDisplay {
  if (!snapshot) return { state: hasCv ? "idle" : "noCv", scored: null };
  if (snapshot.failed > 0) return { state: "failed", scored: snapshot.scored };
  if (snapshot.done > 0 && snapshot.lastError) {
    // `Object.hasOwn`: um erro de verdade chamado "constructor" não vira recusa.
    const reason = Object.hasOwn(REFUSALS, snapshot.lastError)
      ? REFUSALS[snapshot.lastError as keyof typeof REFUSALS]
      : undefined;
    return reason
      ? { state: "refused", scored: snapshot.scored, reason }
      : { state: "failed", scored: snapshot.scored };
  }
  if (snapshot.scoring > 0) return { state: "scoring", scored: snapshot.scored };
  if (snapshot.pending > 0) return { state: "pending", scored: snapshot.scored };
  if (snapshot.done > 0) return { state: "done", scored: snapshot.scored };
  return { state: "idle", scored: null };
}
