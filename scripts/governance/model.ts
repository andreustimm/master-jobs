import { z } from "zod";

export const POLICY = {
  windowDays: 30,
  intervalMinutes: 10,
  // Igual ao minuto do cron em governanca.yml (:07, :17, …). Com a grade em :00,
  // um atraso de ~3 min do agendador empurrava a execução para o slot seguinte
  // e dois runs caíam juntos, perdendo cobertura sem nenhuma falha real.
  slotOffsetMinutes: 7,
  minimumCoverage: 0.95,
  availabilityTarget: 0.995,
  latencyTarget: 0.95,
  latencyMs: 3_000,
  minimumLatencySamples: 100,
} as const;
export const ROUTES = ["/login", "/jobs", "/p/slug-que-nao-existe"] as const;
const instant = z.iso.datetime();
const id = z.number().int().positive();
const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/), at: instant });
export const checkSchema = z.object({
  route: z.enum(ROUTES), status: z.number().int().min(0).max(599),
  elapsedMs: z.number().finite().nonnegative().max(60_000), good: z.boolean(),
}).refine(c => !c.good || c.status === ({ "/login": 200, "/jobs": 307, "/p/slug-que-nao-existe": 404 }[c.route]), "Status incompatível com sonda boa");
export const probeSchema = z.object({ at: instant, scheduled: z.boolean(), checks: z.array(checkSchema).length(3) })
  .refine(p => new Set(p.checks.map(c => c.route)).size === 3, "Rotas duplicadas");
export const deliverySchema = z.object({
  collectedAt: instant,
  deployments: z.array(z.object({ id, sha: commitSchema.shape.sha, at: instant, commits: z.array(commitSchema).nullable() })),
});
export const historySchema = z.object({
  schemaVersion: z.literal(1), startedAt: instant,
  probes: z.array(probeSchema).max(20_000), delivery: deliverySchema.nullable(),
});
export const ledgerSchema = z.object({
  schemaVersion: z.literal(1), recordingStartedAt: instant.nullable(),
  changes: z.array(z.object({ deploymentId: id, rework: z.boolean(), assessedAt: instant, evidence: z.url() })),
  incidents: z.array(z.object({
    id: z.string().min(1), severity: z.enum(["SEV1", "SEV2", "SEV3"]),
    startedAt: instant, detectedAt: instant, acknowledgedAt: instant.nullable(), restoredAt: instant.nullable(),
    cause: z.enum(["change", "other", "unknown"]), causedByDeploymentId: id.nullable(), evidence: z.url(),
  })),
}).superRefine((ledger, ctx) => {
  if (new Set(ledger.changes.map(c => c.deploymentId)).size !== ledger.changes.length)
    ctx.addIssue({ code: "custom", message: "Deployment avaliado mais de uma vez" });
  if (new Set(ledger.incidents.map(i => i.id)).size !== ledger.incidents.length)
    ctx.addIssue({ code: "custom", message: "Incidente duplicado" });
  for (const i of ledger.incidents) {
    if ((i.cause === "change") !== (i.causedByDeploymentId !== null))
      ctx.addIssue({ code: "custom", message: "Causa e deployment de incidente divergentes" });
    if (Date.parse(i.detectedAt) < Date.parse(i.startedAt) ||
      (i.acknowledgedAt && Date.parse(i.acknowledgedAt) < Date.parse(i.detectedAt)) ||
      (i.restoredAt && Date.parse(i.restoredAt) < Date.parse(i.startedAt)))
      ctx.addIssue({ code: "custom", message: "Cronologia de incidente inválida" });
  }
});
export type Probe = z.infer<typeof probeSchema>;
export type History = z.infer<typeof historySchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type Ledger = z.infer<typeof ledgerSchema>;
const DAY = 86_400_000;
const SLOT = POLICY.intervalMinutes * 60_000;
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
export function percentile95(values: number[]): number | null {
  return values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]! : null;
}
export function summarize(history: History, ledger: Ledger, now: Date) {
  const end = now.getTime();
  const since = end - POLICY.windowDays * DAY;
  // Um slot não ganha peso extra com retries. Havendo resultados conflitantes,
  // a falha prevalece; repetir à mão nunca apaga uma indisponibilidade.
  const slots = new Map<number, Probe>();
  for (const p of history.probes) {
    const time = Date.parse(p.at);
    if (!p.scheduled || time <= since || time > end) continue;
    const slot = Math.floor((time - POLICY.slotOffsetMinutes * 60_000) / SLOT);
    const old = slots.get(slot);
    if (!old) slots.set(slot, p);
    else slots.set(slot, { ...old, checks: old.checks.map(prior => {
      const current = p.checks.find(c => c.route === prior.route)!;
      return { ...(prior.good ? current : prior), good: prior.good && current.good,
        elapsedMs: Math.max(prior.elapsedMs, current.elapsedMs) };
    }) });
  }
  const probes = [...slots.values()];
  const total = probes.length;
  const good = probes.filter(p => p.checks.every(c => c.good)).length;
  const expected = POLICY.windowDays * DAY / SLOT;
  const coverage = Math.min(1, total / expected);
  const complete = Date.parse(history.startedAt) <= since && coverage >= POLICY.minimumCoverage;
  const ratio = total ? good / total : null;
  const bad = total - good;
  const allowedBad = total * (1 - POLICY.availabilityTarget);
  const latencies = probes.map(p => p.checks.find(c => c.route === "/login")!);
  const fast = latencies.filter(c => c.good && c.elapsedMs <= POLICY.latencyMs).length;
  const status = (value: number | null, target: number, enough = complete) =>
    value === null ? "sem dados" : !enough ? "dados insuficientes" : value >= target ? "dentro da meta" : "fora da meta";
  const deliveryFresh = history.delivery !== null && Date.parse(history.delivery.collectedAt) <= end && end - Date.parse(history.delivery.collectedAt) <= DAY;
  const deployments = (history.delivery?.deployments ?? []).filter(d => Date.parse(d.at) > since && Date.parse(d.at) <= end);
  const commits = new Map<string, number>();
  for (const d of [...deployments].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    for (const c of d.commits ?? []) {
      if (!commits.has(c.sha)) commits.set(c.sha, Date.parse(d.at) - Date.parse(c.at));
    }
  }
  const leadTimeComplete = deliveryFresh && deployments.every(d => d.commits !== null) && [...commits.values()].every(ms => ms >= 0);
  const assessed = new Map(ledger.changes.filter(c => Date.parse(c.assessedAt) <= end).map(c => [c.deploymentId, c]));
  const incidentCoverage = ledger.recordingStartedAt !== null && Date.parse(ledger.recordingStartedAt) <= since;
  const reliabilityComplete = deliveryFresh && incidentCoverage
    && deployments.every(d => assessed.has(d.id) && Date.parse(assessed.get(d.id)!.assessedAt) >= Date.parse(d.at))
    && !ledger.incidents.some(i => i.cause === "unknown" && Date.parse(i.startedAt) <= end && (!i.restoredAt || Date.parse(i.restoredAt) > since));
  const failed = new Set(ledger.incidents.filter(i => Date.parse(i.startedAt) <= end && i.causedByDeploymentId !== null).map(i => i.causedByDeploymentId));
  const failures = deployments.filter(d => failed.has(d.id)).length;
  const changeIncidents = ledger.incidents.filter(i => i.causedByDeploymentId !== null && Date.parse(i.startedAt) <= end
    && (!i.restoredAt || Date.parse(i.restoredAt) > since));
  const recovered = changeIncidents.filter(i => i.restoredAt !== null && Date.parse(i.restoredAt) <= end);
  return {
    generatedAt: now.toISOString(), since: new Date(since).toISOString(), policy: POLICY,
    availability: { status: status(ratio, POLICY.availabilityTarget), good, total, expected, coverage, ratio,
      budgetRemainingPercent: allowedBad ? 100 * (allowedBad - bad) / allowedBad : null },
    publicLatency: { status: status(total ? fast / total : null, POLICY.latencyTarget, complete && total >= POLICY.minimumLatencySamples),
      fast, total, ratio: total ? fast / total : null, p95Ms: percentile95(latencies.map(c => c.elapsedMs)) },
    authenticatedLatency: { status: "sem dados", reason: "Depende da instrumentação completa das jornadas; log apenas de pedidos lentos é uma amostra enviesada." },
    delivery: {
      collectedAt: history.delivery?.collectedAt ?? null,
      status: deliveryFresh ? "dados atuais" : "sem dados atuais", deployments: deployments.length,
      deploymentsPerDay: deliveryFresh ? deployments.length / POLICY.windowDays : null,
      leadTimeMedianHours: leadTimeComplete ? median([...commits.values()].map(ms => ms / 3_600_000)) : null,
      measuredCommits: commits.size,
      changeFailureRate: reliabilityComplete && deployments.length ? failures / deployments.length : null,
      deploymentReworkRate: reliabilityComplete && deployments.length ? deployments.filter(d => assessed.get(d.id)!.rework).length / deployments.length : null,
      failedDeploymentRecoveryMedianHours: reliabilityComplete && recovered.length && recovered.length === changeIncidents.length
        ? median(recovered.map(i => (Date.parse(i.restoredAt!) - Date.parse(i.startedAt)) / 3_600_000)) : null,
      openChangeIncidents: changeIncidents.length - recovered.length,
      assessedDeployments: deployments.filter(d => assessed.has(d.id)).length,
      incidentCoverage,
    },
  };
}
export type Report = ReturnType<typeof summarize>;
export function renderMarkdown(r: Report) {
  const percent = (n: number | null) => n === null ? "sem dados" : `${(n * 100).toFixed(2)}%`;
  const number = (n: number | null, unit: string) => n === null ? "sem dados" : `${n.toFixed(2)} ${unit}`;
  return `# Governança do Master Jobs\n\nJanela: ${r.since} → ${r.generatedAt}. Ambiente: produção.\n\n` +
    `| Indicador | Medida | Estado / cobertura |\n|---|---:|---|\n` +
    `| Disponibilidade pública observada | ${percent(r.availability.ratio)} | ${r.availability.status}; ${r.availability.total}/${r.availability.expected} slots (${percent(r.availability.coverage)}) |\n` +
    `| Orçamento de erros restante | ${number(r.availability.budgetRemainingPercent, "%")} | Apenas slots observados; valor negativo significa orçamento excedido |\n` +
    `| Login em até ${POLICY.latencyMs} ms | ${percent(r.publicLatency.ratio)} | ${r.publicLatency.status}; p95 ${number(r.publicLatency.p95Ms, "ms")} |\n` +
    `| Latência das jornadas autenticadas | sem dados | Instrumentação pendente; não inferir do login |\n` +
    `| Frequência de deployments | ${number(r.delivery.deploymentsPerDay, "/dia")} | ${r.delivery.deployments} em 30 dias; ${r.delivery.status}; coleta ${r.delivery.collectedAt ?? "ausente"} |\n` +
    `| Lead time de mudanças, mediana | ${number(r.delivery.leadTimeMedianHours, "h")} | ${r.delivery.measuredCommits} commits |\n` +
    `| Taxa de falha de mudanças | ${percent(r.delivery.changeFailureRate)} | ${r.delivery.assessedDeployments}/${r.delivery.deployments} deployments avaliados; cobertura de incidentes: ${r.delivery.incidentCoverage ? "completa" : "incompleta"} |\n` +
    `| Recuperação de deploy com falha, mediana | ${number(r.delivery.failedDeploymentRecoveryMedianHours, "h")} | ${r.delivery.openChangeIncidents} incidentes de mudança abertos |\n` +
    `| Taxa de deployments de retrabalho | ${percent(r.delivery.deploymentReworkRate)} | Classificação explícita; prefixo fix não decide |\n\n` +
    `Metas internas, sem SLA contratual. Sondas públicas não cobrem navegação autenticada nem períodos sem coleta.\n`;
}
