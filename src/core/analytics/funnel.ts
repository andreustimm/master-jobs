/**
 * Funnel analysis — what actually converts.
 *
 * The question this product ultimately wants answered: which of the seven
 * scoring components predicts a reply? That needs outcomes, and outcomes come
 * only from applying. Today the funnel holds a single application.
 *
 * So the design goal here is not to produce an answer. It is to **refuse to
 * fabricate one** while still being useful:
 *
 *   - Every rate is an interval, never a bare percentage.
 *   - Every breakdown states how far it is from being trustworthy.
 *   - A comparison between two groups is withheld entirely until both could
 *     plausibly differ — the alternative is the user acting on noise, which is
 *     worse than the user acting on nothing.
 *
 * Pure: takes outcomes, returns findings.
 */
import { sampleSizeFor, spearman, wilson, type Interval } from "./stats.ts";

/** One application, with the score it had when it was made. */
export type Outcome = {
  jobId: number;
  status: string;
  /** True once the employer did anything at all beyond receipt. */
  replied: boolean;
  fit: number | null;
  cluster: string | null;
  sourceKind: string | null;
  channel: string | null;
  components: Record<string, number>;
};

/** Statuses that prove a human on the other side engaged. */
const REPLIED_STATUSES = new Set(["screening", "interviewing", "offer", "rejected"]);

export function hasReplied(status: string): boolean {
  // `rejected` counts: a rejection is a reply. Excluding it would measure
  // "good outcomes" while claiming to measure "response rate", and would make
  // the number rise as the process got worse at surfacing rejections.
  return REPLIED_STATUSES.has(status);
}

export type GroupRate = {
  group: string;
  applied: number;
  replied: number;
  rate: Interval;
};

export type ComponentSignal = {
  key: string;
  /** Rank correlation between the component and a reply. Null when n < 3. */
  rho: number | null;
};

export type FunnelAnalysis = {
  applied: number;
  replied: number;
  overall: Interval;
  byCluster: GroupRate[];
  bySource: GroupRate[];
  byChannel: GroupRate[];
  componentSignal: ComponentSignal[];
  /** How many more applications are needed before any of this is readable. */
  needed: number;
  /** Present whenever the sample cannot support the conclusions. */
  power: string | null;
  /** Ready to act on? Deliberately conservative. */
  trustworthy: boolean;
};

/** Below this, a breakdown is noise dressed as insight. */
const MIN_FOR_GROUPS = 30;

/** Below this, not even the overall rate is worth printing as a point estimate. */
const MIN_FOR_OVERALL = 10;

function groupBy(outcomes: Outcome[], key: (o: Outcome) => string | null): GroupRate[] {
  const buckets = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    const k = key(o);
    if (!k) continue;
    const list = buckets.get(k) ?? [];
    list.push(o);
    buckets.set(k, list);
  }
  return [...buckets.entries()]
    .map(([group, list]) => {
      const replied = list.filter((o) => o.replied).length;
      return { group, applied: list.length, replied, rate: wilson(replied, list.length) };
    })
    .sort((a, b) => b.applied - a.applied);
}

export function analyzeFunnel(outcomes: Outcome[]): FunnelAnalysis {
  const applied = outcomes.length;
  const replied = outcomes.filter((o) => o.replied).length;
  const overall = wilson(replied, applied);

  const enough = applied >= MIN_FOR_GROUPS;

  // Component signal needs both variation in the outcome and enough points.
  // With every application in one state, correlation is undefined, not zero.
  const keys = new Set<string>();
  for (const o of outcomes) for (const k of Object.keys(o.components)) keys.add(k);

  const componentSignal: ComponentSignal[] = enough
    ? [...keys]
        .map((key) => ({
          key,
          rho: spearman(
            outcomes.map((o) => o.components[key] ?? 0),
            outcomes.map((o) => (o.replied ? 1 : 0)),
          ),
        }))
        .sort((a, b) => Math.abs(b.rho ?? 0) - Math.abs(a.rho ?? 0))
    : [];

  // Target: know the rate to within ±10 points. Enough to tell a 10% channel
  // from a 30% one, which is the decision the user actually makes.
  const needed = Math.max(0, sampleSizeFor(0.1) - applied);

  let power: string | null = null;
  if (applied === 0) {
    power = "Nenhuma candidatura registrada. Sem funil, não há o que medir — use `jho track`.";
  } else if (applied < MIN_FOR_OVERALL) {
    power =
      `${applied} candidatura(s). O intervalo abaixo é quase toda a faixa 0–100%: ` +
      `a taxa observada não distingue um sistema bom de um ruim. ` +
      `Faltam ~${needed} para medir com ±10 pontos.`;
  } else if (!enough) {
    power =
      `${applied} candidaturas — suficiente para uma taxa geral grosseira, ` +
      `insuficiente para comparar grupos. Recortes por cluster, fonte e canal ficam ocultos ` +
      `até ${MIN_FOR_GROUPS}, porque comparar grupos de 3 é ler ruído.`;
  }

  return {
    applied,
    replied,
    overall,
    byCluster: enough ? groupBy(outcomes, (o) => o.cluster) : [],
    bySource: enough ? groupBy(outcomes, (o) => o.sourceKind) : [],
    byChannel: enough ? groupBy(outcomes, (o) => o.channel) : [],
    componentSignal,
    needed,
    power,
    trustworthy: enough,
  };
}
