/**
 * Coleta a amostra do vigia de cota: deployments da Vercel, fila do GitHub
 * Actions e o status público da plataforma. Cada chamada é isolada — uma
 * falhando não impede a outra, e a métrica que falhou vira `null` (regra 8
 * adaptada, F3-02), nunca um erro que derruba a checagem inteira.
 *
 * Os nomes das variáveis de ambiente são o que este módulo conhece; o valor
 * nunca aparece em log nem em erro (regra 16) — `describeError` só devolve o
 * status HTTP e a URL sem query string.
 */
import type { QuotaSample } from "../domain/quota-watch.ts";
import type { QuotaMetricsPort } from "../ports.ts";

const VERCEL_TOKEN_ENV = "WATCHDOG_VERCEL_TOKEN";
const VERCEL_PROJECT_ENV = "WATCHDOG_VERCEL_PROJECT_ID";
const VERCEL_TEAM_ENV = "WATCHDOG_VERCEL_TEAM_ID";
const GITHUB_TOKEN_ENV = "WATCHDOG_GITHUB_TOKEN";
const GITHUB_REPO_ENV = "WATCHDOG_GITHUB_REPO";
const DEFAULT_REPO = "andreustimm/master-jobs";
const GITHUB_STATUS_URL = "https://www.githubstatus.com/api/v2/status.json";

const ONE_DAY_MS = 24 * 3_600_000;

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
    const response = await send(url.toString(), { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const body = (await response.json()) as { deployments?: unknown[] };
    return Array.isArray(body.deployments) ? body.deployments.length : null;
  } catch {
    return null;
  }
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
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { workflow_runs?: Array<{ created_at?: string }> };
    const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
    if (runs.length === 0) return 0;
    const waits = runs
      .map((run) => (run.created_at ? now - Date.parse(run.created_at) : null))
      .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
    if (waits.length === 0) return null;
    return Math.round(Math.max(...waits) / 1000);
  } catch {
    return null;
  }
}

async function githubActionsStatus(send: typeof fetch): Promise<QuotaSample["actionsStatus"]> {
  try {
    const response = await send(GITHUB_STATUS_URL);
    if (!response.ok) return null;
    const body = (await response.json()) as { status?: { indicator?: string } };
    const indicator = body.status?.indicator;
    return indicator === "none" || indicator === "minor" || indicator === "major" || indicator === "critical"
      ? indicator
      : null;
  } catch {
    return null;
  }
}

/** Implementação de verdade: três chamadas de rede, isoladas entre si. */
export function quotaWatchMetrics(options: QuotaWatchMetricsOptions = {}): QuotaMetricsPort {
  const send = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const vercelToken = () => options.vercelToken ?? process.env[VERCEL_TOKEN_ENV];
  const vercelProjectId = () => options.vercelProjectId ?? process.env[VERCEL_PROJECT_ENV];
  const vercelTeamId = () => options.vercelTeamId ?? process.env[VERCEL_TEAM_ENV];
  const githubToken = () => options.githubToken ?? process.env[GITHUB_TOKEN_ENV];
  const githubRepo = () => options.githubRepo ?? process.env[GITHUB_REPO_ENV] ?? DEFAULT_REPO;

  return {
    async sample(): Promise<QuotaSample> {
      const at = now();
      const [vercel, actionsQueue, actionsStatus] = await Promise.all([
        vercelDeploys24h(send, at, vercelToken(), vercelProjectId(), vercelTeamId()),
        actionsQueueMaxWaitS(send, at, githubToken(), githubRepo()),
        githubActionsStatus(send),
      ]);
      return { vercelDeploys24h: vercel, actionsQueueMaxWaitS: actionsQueue, actionsStatus };
    },
  };
}

export { VERCEL_TOKEN_ENV, VERCEL_PROJECT_ENV, VERCEL_TEAM_ENV, GITHUB_TOKEN_ENV, GITHUB_REPO_ENV };
