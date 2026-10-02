import { DEFAULT_VERIFY_MIN_FIT } from "../../../src/core/ingest/availability.ts";
import type { TranslationKey } from "../../../src/core/i18n/index.ts";

/**
 * Chave do dicionário para a completude de uma execução. Captura e verificação
 * guardam o mesmo campo, mas dizem coisas diferentes: a captura descreve a
 * listagem da fonte (e, por isso, se pode fechar vaga por ausência); a
 * verificação só fecha com 404 ou 410 (G26), então "parcial" ali é a conferência
 * que parou antes de checar tudo o que devia — pelo `limit` do operador
 * (`checked < due`) ou pelo orçamento de requisições (`budgetExhausted`) —, sem
 * falar de ausência.
 *
 * A verificação tem dois universos: a de UMA plataforma (`sourceId` preenchido)
 * olha todas as vagas abertas dela com link público (`minFit: 0`); a global
 * (`sourceId` nulo) vale o piso padrão de fit, então "completa" quer dizer só as
 * elegíveis. Por isso são textos diferentes. Só o texto muda: o que é gravado em
 * `source_run.completeness` continua o mesmo.
 */
export function completenessKey(scopeKind: string, sourceId: string | null, completeness: string | null): TranslationKey {
  if (scopeKind === "verify") {
    const global = sourceId === null;
    if (completeness === "complete") return global ? "runs.verifyAllComplete" : "runs.verifyComplete";
    if (completeness === "partial") return global ? "runs.verifyAllPartial" : "runs.verifyPartial";
    return "platforms.snapshotUnknown";
  }
  if (completeness === "complete") return "platforms.snapshotComplete";
  if (completeness === "partial") return "platforms.snapshotPartial";
  return "platforms.snapshotUnknown";
}

/** O que a frase da completude precisa da linha de `source_run`. */
export type CompletenessRun = {
  scopeKind: string;
  sourceId: string | null;
  completeness: string | null;
  fetched: number | null;
  dueTotal: number | null;
};

/** Chave e valores para `t(key, values)`. */
export type CompletenessCopy = { key: TranslationKey; values: Record<string, number> };

const COUNTED = {
  "runs.verifyComplete": "runs.verifyCompleteCount",
  "runs.verifyPartial": "runs.verifyPartialCount",
  "runs.verifyAllComplete": "runs.verifyAllCompleteCount",
  "runs.verifyAllPartial": "runs.verifyAllPartialCount",
} as const satisfies Partial<Record<TranslationKey, TranslationKey>>;

/**
 * A frase da completude com o "N de M" quando a linha sabe os dois números
 * (#447): `fetched` é quantas vagas a verificação checou e `dueTotal` quantas
 * estavam vencidas antes do `limit`. Execução gravada antes da coluna existir
 * tem `dueTotal` nulo e mantém a frase sem número — desconhecido não vira zero
 * (US-009.EC-2). O piso da global vem de `DEFAULT_VERIFY_MIN_FIT`, o mesmo que
 * `verifyJobs` usa.
 */
export function completenessCopy(run: CompletenessRun): CompletenessCopy {
  const key = completenessKey(run.scopeKind, run.sourceId, run.completeness);
  const values = { minFit: DEFAULT_VERIFY_MIN_FIT };
  if (!(key in COUNTED) || run.fetched === null || run.dueTotal === null) return { key, values };
  return {
    key: COUNTED[key as keyof typeof COUNTED],
    values: { ...values, checked: run.fetched, due: run.dueTotal },
  };
}
