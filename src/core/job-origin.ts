/**
 * De onde a vaga veio.
 *
 * **Derivado de `source.kind` na leitura, sempre.** A alternativa — uma coluna
 * `origin` em `job`, escrita no cadastro — consulta mais rápido e começa a
 * divergir na primeira reclassificação de fonte.
 *
 * Este projeto já pagou por esse erro: `application.cv_variant` guarda o nome
 * da variante numa string solta em vez de apontar para `candidate_document.id`,
 * e o resultado é um funil que afirma ter enviado um documento que não existe
 * mais. Vínculo que não é vínculo mente com cara de íntegro.
 */
import { MANUAL_SOURCE_KINDS } from "./sources/types.ts";

export type JobOrigin = "web" | "recruiter" | "manual";

/** A chave de tradução do rótulo. O texto mora no dicionário, como todo o resto. */
export const ORIGIN_LABEL = {
  web: "jobs.originWeb",
  recruiter: "jobs.originRecruiter",
  manual: "jobs.originManual",
} as const;

/**
 * `sourceId` tem o formato `<kind>:<handle>`.
 *
 * Tudo que não é manual veio da internet — as doze fontes buscáveis. Não
 * enumerá-las aqui é deliberado: fonte nova nasce classificada como `web` sem
 * ninguém precisar lembrar de acrescentá-la, que é o modo de errar quando a
 * lista é de permissão em vez de exclusão.
 */
export function jobOrigin(sourceId: string | null | undefined): JobOrigin {
  const kind = (sourceId ?? "").split(":")[0] ?? "";
  if (kind === "recruiter") return "recruiter";
  if ((MANUAL_SOURCE_KINDS as readonly string[]).includes(kind)) return "manual";
  return "web";
}
