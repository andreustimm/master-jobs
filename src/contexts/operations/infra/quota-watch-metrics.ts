/**
 * Coleta a amostra do vigia de cota: deployments da Vercel, fila do GitHub
 * Actions e o status do componente "Actions" do githubstatus.com. Cada
 * chamada é isolada — uma falhando não impede a outra, e a métrica que
 * falhou vira `null` (regra 8 adaptada, F3-02), nunca um erro que derruba a
 * checagem inteira.
 *
 * Os nomes das variáveis de ambiente são o que este módulo conhece; o valor
 * nunca aparece em log nem em erro (regra 16). Cada chamada tem um teto de
 * 10 s (`AbortSignal.timeout`): uma API de terceiro lenta não pode prender a
 * checagem inteira.
 *
 * Premissa assumida (documentada em `docs/operations.md`): um projeto Vercel
 * e um repositório GitHub monitorados — o mesmo par que `varredura.sql` e
 * `github-dispatch.ts` já assumem. Múltiplos projetos/times exigiriam somar
 * mais de uma amostra, fora do escopo desta entrega.
 */
import { firstNonEmpty } from "../../../core/sources/http.ts";
import type { QuotaSample } from "../domain/quota-watch.ts";
import type { QuotaMetricsPort } from "../ports.ts";

const VERCEL_TOKEN_ENV = "WATCHDOG_VERCEL_TOKEN";
const VERCEL_PROJECT_ENV = "WATCHDOG_VERCEL_PROJECT_ID";
/** Só times: token de conta pessoal não usa `teamId` (mesmo par que a Fase 4 vai assumir). */
const VERCEL_TEAM_ENV = "WATCHDOG_VERCEL_TEAM_ID";
const GITHUB_TOKEN_ENV = "WATCHDOG_GITHUB_TOKEN";
const GITHUB_REPO_ENV = "WATCHDOG_GITHUB_REPO";
const DEFAULT_REPO = "andreustimm/master-jobs";
const GITHUB_COMPONENTS_URL = "https://www.githubstatus.com/api/v2/components.json";
/** Nome exato do componente na página pública — confirmado em githubstatus.com. */
const ACTIONS_COMPONENT_NAME = "Actions";

const ONE_DAY_MS = 24 * 3_600_000;
const TIMEOUT_MS = 10_000;

export type QuotaWatchMetricsOptions = {
  /** Injetável para o teste não falar com a rede. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  vercelToken?: string | undefined;
  vercelProjectId?: string | undefined;
  vercelTeamId?: string | undefined;
  githubToken?: string | undefined;
  githubRepo?: string | undefined;
};

const timeout = () => AbortSignal.timeout(TIMEOUT_MS);

async function vercelDeploys24h(
  send: typeof fetch,
  now: number,
  token: string | undefined,
  projectId: string | undefined,
  teamId: string | undefined,
): Promise<number | null> {
  if (!token || !projectId) return null;
  try {
    const since = now - ONE_DAY_MS;
    const url = new URL("https://api.vercel.com/v6/deployments");
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("since", String(since));
    url.searchParams.set("limit", "100");
    if (teamId) url.searchParams.set("teamId", teamId);
    const response = await send(url.toString(), { headers: { authorization: `Bearer ${token}` }, signal: timeout() });
    if (!response.ok) return null;
    const body = (await response.json()) as { deployments?: unknown[] };
    return Array.isArray(body.deployments) ? body.deployments.length : null;
  } catch {
    return null;
  }
}

/** `run_started_at` é quando o runner pegou o run; runs ainda `queued` não têm. `created_at` sempre existe. */
function waitStartOf(run: { created_at?: string; run_started_at?: string }): string | undefined {
  return firstNonEmpty(run.run_started_at, run.created_at) ?? undefined;
}

async function actionsQueueMaxWaitS(
  send: typeof fetch,
  now: number,
  token: string | undefined,
  repo: string,
): Promise<number | null> {
  if (!token) return null;
  try {
    const url = `https://api.github.com/repos/${repo}/actions/runs?status=queued&per_page=100`;
    const response = await send(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: timeout(),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { workflow_runs?: Array<{ created_at?: string; run_started_at?: string }> };
    const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
    if (runs.length === 0) return 0;
    const waits = runs
      .map((run) => {
        const startedAt = waitStartOf(run);
        return startedAt ? now - Date.parse(startedAt) : null;
      })
      .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
    if (waits.length === 0) return null;
    return Math.round(Math.max(...waits) / 1000);
  } catch {
    return null;
  }
}

/**
 * M2 — status por COMPONENTE, não o indicador agregado da página (um
 * incidente em Pages ou Codespaces não pode acender o vigia do Actions).
 * `components.json` traz `status` textual (`operational`, `degraded_performance`,
 * `partial_outage`, `major_outage`, `under_maintenance`), mapeado para o
 * mesmo vocabulário de `status.json` usado pelo domínio.
 */
function mapComponentStatus(status: string | undefined): QuotaSample["actionsStatus"] {
  switch (status) {
    case "operational":
    case "under_maintenance":
      return "none";
    case "degraded_performance":
      return "minor";
    case "partial_outage":
      return "major";
    case "major_outage":
      return "critical";
    default:
      return null;
  }
}

async function githubActionsStatus(send: typeof fetch): Promise<QuotaSample["actionsStatus"]> {
  try {
    const response = await send(GITHUB_COMPONENTS_URL, { signal: timeout() });
    if (!response.ok) return null;
    const body = (await response.json()) as { components?: Array<{ name?: string; status?: string }> };
    const actions = (body.components ?? []).find((component) => component.name === ACTIONS_COMPONENT_NAME);
    return actions ? mapComponentStatus(actions.status) : null;
  } catch {
    return null;
  }
}

/** Implementação de verdade: três chamadas de rede, isoladas entre si. */
export function quotaWatchMetrics(options: QuotaWatchMetricsOptions = {}): QuotaMetricsPort {
  const send = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const vercelToken = () => firstNonEmpty(options.vercelToken, process.env[VERCEL_TOKEN_ENV]);
  const vercelProjectId = () => firstNonEmpty(options.vercelProjectId, process.env[VERCEL_PROJECT_ENV]);
  const vercelTeamId = () => firstNonEmpty(options.vercelTeamId, process.env[VERCEL_TEAM_ENV]);
  const githubToken = () => firstNonEmpty(options.githubToken, process.env[GITHUB_TOKEN_ENV]);
  const githubRepo = () => firstNonEmpty(options.githubRepo, process.env[GITHUB_REPO_ENV]) ?? DEFAULT_REPO;

  return {
    async sample(): Promise<QuotaSample> {
      const at = now();
      const [vercel, actionsQueue, actionsStatus] = await Promise.all([
        vercelDeploys24h(send, at, vercelToken() ?? undefined, vercelProjectId() ?? undefined, vercelTeamId() ?? undefined),
        actionsQueueMaxWaitS(send, at, githubToken() ?? undefined, githubRepo()),
        githubActionsStatus(send),
      ]);
      return { vercelDeploys24h: vercel, actionsQueueMaxWaitS: actionsQueue, actionsStatus };
    },
  };
}

export { VERCEL_TOKEN_ENV, VERCEL_PROJECT_ENV, VERCEL_TEAM_ENV, GITHUB_TOKEN_ENV, GITHUB_REPO_ENV };
