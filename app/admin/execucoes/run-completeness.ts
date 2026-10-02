import type { TranslationKey } from "../../../src/core/i18n/index.ts";

/**
 * Chave do dicionário para a completude de uma execução. Captura e verificação
 * guardam o mesmo campo, mas dizem coisas diferentes: a captura descreve a
 * listagem da fonte (e, por isso, se pode fechar vaga por ausência); a
 * verificação só fecha com 404 ou 410 (G26), então "parcial" ali é a conferência
 * cortada pelo limite do operador, sem falar de ausência. Só o texto muda: o que
 * é gravado em `source_run.completeness` continua o mesmo.
 */
export function completenessKey(scopeKind: string, completeness: string | null): TranslationKey {
  if (scopeKind === "verify") {
    if (completeness === "complete") return "runs.verifyComplete";
    if (completeness === "partial") return "runs.verifyPartial";
    return "platforms.snapshotUnknown";
  }
  if (completeness === "complete") return "platforms.snapshotComplete";
  if (completeness === "partial") return "platforms.snapshotPartial";
  return "platforms.snapshotUnknown";
}
