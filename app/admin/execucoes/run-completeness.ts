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
