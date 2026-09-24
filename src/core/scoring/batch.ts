/**
 * A passada de pontuação em lotes: por onde começar, quando parar, onde retomar.
 *
 * Função pura — sem banco, sem relógio. `apply.ts` lê o cursor gravado, pede a
 * decisão aqui e grava o que ela devolve; o teste exercita cada regra sem
 * PostgreSQL (#288).
 *
 * ## A passada
 *
 * Uma passada percorre as vagas abertas da MAIS RECENTE para a mais antiga —
 * `coalesce(posted_at, first_seen_at)` decrescente, id decrescente no empate —
 * em lotes de {@link SCORE_BATCH}. Depois de cada lote o cursor (a chave da
 * última vaga lida) é gravado, e a chamada seguinte retoma do ponto certo em
 * vez de recomeçar do topo. É o que deixa uma função de 30 s pontuar um acervo
 * de milhares de vagas em várias chamadas, e o que faz as cem mais recentes
 * aparecerem com nota primeiro.
 *
 * Só as vagas sem nota ou com nota desatualizada entram no lote (o filtro de
 * staleness continua em `apply.ts`); o cursor existe porque a vaga fora do alvo
 * de uma trilha aceita nunca ganha linha e voltaria em todo lote.
 */

/** Vagas por lote: um comando de gravação, e a unidade de trabalho da fila. */
export const SCORE_BATCH = 100;

/** Onde a passada está: a chave de recência e o id da última vaga lida. */
export type BatchPosition = { key: string; jobId: number };

/** O que `score_cursor` guarda para uma trilha. */
export type StoredCursor = {
  profileHash: string;
  scorerVersion: string;
  /** `null` = a próxima passada começa do topo. */
  position: BatchPosition | null;
  lastCompletedAt: string | null;
};

/**
 * De onde a próxima leitura parte. `null` é o topo: a vaga mais recente.
 *
 * Recomeça do topo quando não há cursor, quando o chamador pede (`--all`), e
 * quando o perfil efetivo ou a versão do scorer mudou desde que o cursor foi
 * gravado. O último caso é o que importa: quem salva o currículo muda o hash,
 * e retomar do meio de uma passada antiga faria as vagas mais recentes
 * esperarem pelo fim do acervo — o contrário do que a pessoa vê primeiro.
 */
export function startPosition(
  stored: StoredCursor | null,
  current: { profileHash: string; scorerVersion: string },
  opts: { restart?: boolean } = {},
): BatchPosition | null {
  if (opts.restart || !stored) return null;
  if (stored.profileHash !== current.profileHash || stored.scorerVersion !== current.scorerVersion) return null;
  return stored.position;
}

/**
 * O cursor depois de um lote.
 *
 * Lote incompleto é o fim da passada: o cursor volta ao topo e a passada fica
 * registrada como completa. Lote cheio avança para a última vaga lida — mesmo
 * que nada tenha sido gravado, porque avançar é o que impede o laço.
 */
export function afterBatch(
  read: readonly BatchPosition[],
  batchSize: number,
  nowIso: string,
): { position: BatchPosition | null; completedAt: string | null } {
  if (read.length < batchSize) return { position: null, completedAt: nowIso };
  const last = read[read.length - 1]!;
  return { position: { key: last.key, jobId: last.jobId }, completedAt: null };
}

/**
 * Começar mais um lote cabe no prazo?
 *
 * O primeiro lote de uma chamada sempre começa — chamada que não avança nunca
 * termina a fila. Depois dele, supõe-se que o próximo leva tanto quanto o mais
 * lento até aqui: lote começado não é interrompido, e é assim que a chamada
 * nunca passa do prazo por mais que o erro dessa estimativa.
 */
export function mayStartBatch(
  state: { batchesDone: number; now: number; slowestMs: number },
  deadline: number | undefined,
): boolean {
  if (deadline === undefined || state.batchesDone === 0) return true;
  return state.now + state.slowestMs <= deadline;
}

/** As duas filas da pontuação periódica (#288). */
export type ScoreQueueKind = "sem-nota" | "manutencao";

/**
 * Em que fila o candidato está.
 *
 * "Sem nota" é quem ainda não completou nenhuma passada na trilha principal —
 * acabou de entrar, ainda não tem trilha, ou tem só parte das notas. Fica nessa
 * fila, de dez em dez minutos, até a primeira passada terminar; daí em diante
 * vai para a manutenção de hora em hora. Mudar o currículo depois NÃO devolve
 * ninguém a "sem nota": quem já tem notas é atendido pela fila de repontuação
 * (`score_task`) e pela manutenção.
 */
export function scoreQueueOf(primaryLastCompletedAt: string | null): ScoreQueueKind {
  return primaryLastCompletedAt === null ? "sem-nota" : "manutencao";
}
