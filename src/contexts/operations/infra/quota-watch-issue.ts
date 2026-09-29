/**
 * O alerta do vigia de cota: uma issue no GitHub (ADR 0030 decisão 7 — toda
 * checagem que merece atenção é registrada, nunca silenciosa). O vigia nunca
 * aplica mudança nenhuma sozinho (corte de escopo, `docs/operations.md`);
 * isto só abre ou comenta uma issue com a recomendação.
 *
 * Reaproveita o PAT do watchdog (`WATCHDOG_GITHUB_TOKEN`, o mesmo token que lê
 * a fila do Actions) em vez de pedir um terceiro segredo. Escopo mínimo
 * exigido: `actions:read` (ler runs) e `issues:write` (abrir/comentar) — sem
 * `actions:write` nem `variables:write`, porque nada aqui escreve variável de
 * repositório. O corpo da resposta nunca entra em log — só `ok`/`status`
 * (regra 16). Cada chamada tem um teto de 10 s (`AbortSignal.timeout`): uma
 * API de terceiro lenta não pode prender a checagem inteira.
 */
import { firstNonEmpty } from "../../../core/sources/http.ts";
import type { QuotaAlertPort } from "../ports.ts";
import { GITHUB_REPO_ENV, GITHUB_TOKEN_ENV } from "./quota-watch-metrics.ts";

const DEFAULT_REPO = "andreustimm/master-jobs";
const TIMEOUT_MS = 10_000;
const LABEL = "vigia-de-cota";

export type QuotaWatchIssueOptions = {
  fetchImpl?: typeof fetch;
  token?: string | undefined;
  repo?: string | undefined;
  /** Rótulo aplicado à issue aberta pelo vigia. */
  label?: string;
};

export function quotaWatchIssue(options: QuotaWatchIssueOptions = {}): QuotaAlertPort {
  const token = () => firstNonEmpty(options.token, process.env[GITHUB_TOKEN_ENV]);
  const repo = () => firstNonEmpty(options.repo, process.env[GITHUB_REPO_ENV]) ?? DEFAULT_REPO;
  const label = options.label ?? LABEL;
  const send = options.fetchImpl ?? fetch;
  const headers = (credential: string) => ({
    accept: "application/vnd.github+json",
    authorization: `Bearer ${credential}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  });

  return {
    async open(input) {
      const credential = token();
      if (!credential) return { ok: false, reason: "sem token configurado" };
      try {
        const response = await send(`https://api.github.com/repos/${repo()}/issues`, {
          method: "POST",
          headers: headers(credential),
          body: JSON.stringify({ title: input.title, body: input.body, labels: [label] }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return { ok: false, reason: `status ${response.status}` };
        const body = (await response.json()) as { number?: number };
        return { ok: true, number: typeof body.number === "number" ? body.number : undefined };
      } catch {
        return { ok: false, reason: "erro de rede" };
      }
    },

    async comment(input) {
      const credential = token();
      if (!credential) return { ok: false, reason: "sem token configurado" };
      try {
        const response = await send(`https://api.github.com/repos/${repo()}/issues/${input.issueNumber}/comments`, {
          method: "POST",
          headers: headers(credential),
          body: JSON.stringify({ body: input.body }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return response.ok ? { ok: true } : { ok: false, reason: `status ${response.status}` };
      } catch {
        return { ok: false, reason: "erro de rede" };
      }
    },
  };
}
