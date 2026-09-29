/**
 * O alerta do vigia de cota: uma issue no GitHub (ADR 0030 decisão 7 — toda
 * ação automática é registrada, nunca silenciosa).
 *
 * Reaproveita o PAT do watchdog (`WATCHDOG_GITHUB_TOKEN`, o mesmo token que lê
 * a fila do Actions) em vez de pedir um terceiro segredo: o mesmo token com
 * escopo de repositório já cobre `issues:write`. O corpo da resposta nunca
 * entra em log — só `ok`/`status` (regra 16).
 */
import type { QuotaAlertPort } from "../ports.ts";
import { GITHUB_REPO_ENV, GITHUB_TOKEN_ENV } from "./quota-watch-metrics.ts";

const DEFAULT_REPO = "andreustimm/master-jobs";

export type QuotaWatchIssueOptions = {
  fetchImpl?: typeof fetch;
  token?: string | undefined;
  repo?: string | undefined;
  /** Rótulo para achar issues já abertas pelo vigia e não duplicar. */
  label?: string;
};

const LABEL = "vigia-de-cota";

export function quotaWatchIssue(options: QuotaWatchIssueOptions = {}): QuotaAlertPort {
  const token = () => options.token ?? process.env[GITHUB_TOKEN_ENV];
  const repo = () => options.repo ?? process.env[GITHUB_REPO_ENV] ?? DEFAULT_REPO;
  const label = options.label ?? LABEL;
  const send = options.fetchImpl ?? fetch;

  return {
    async open(input) {
      const credential = token();
      if (!credential) return { ok: false, reason: "sem token configurado" };
      try {
        const response = await send(`https://api.github.com/repos/${repo()}/issues`, {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${credential}`,
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify({ title: input.title, body: input.body, labels: [label] }),
        });
        return response.ok ? { ok: true } : { ok: false, reason: `status ${response.status}` };
      } catch {
        return { ok: false, reason: "erro de rede" };
      }
    },
  };
}
