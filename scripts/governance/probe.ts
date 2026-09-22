import { performance } from "node:perf_hooks";
import { ROUTES, type Probe } from "./model.ts";

export const PRODUCTION = "https://jobs.mastertimm.com.br";
/** Só GETs públicos, sem sessão e sem persistir corpo, cabeçalhos ou query strings. */
export async function probe(now: Date, scheduled: boolean, request: typeof fetch = fetch): Promise<Probe> {
  const checks: Probe["checks"] = [];
  for (const route of ROUTES) {
    const start = performance.now();
    let status = 0;
    let good = false;
    try {
      const response = await request(`${PRODUCTION}${route}`, {
        redirect: "manual", signal: AbortSignal.timeout(10_000),
        headers: { "user-agent": "master-jobs-governance/1.0" },
      });
      status = response.status;
      if (route === "/login") {
        const text = await response.text();
        good = status === 200 && text.includes('data-testid="route-login"') && /data-app-version="[0-9]+\.[0-9]+\.[0-9]+"/.test(text);
      } else if (route === "/jobs") {
        const target = new URL(response.headers.get("location") ?? "", PRODUCTION);
        good = status === 307 && target.origin === PRODUCTION && target.pathname === "/login";
        await response.body?.cancel();
      } else {
        good = status === 404;
        await response.body?.cancel();
      }
    } catch {
      good = false;
    }
    checks.push({ route, status, good, elapsedMs: Math.round(performance.now() - start) });
  }
  return { at: now.toISOString(), scheduled, checks };
}
