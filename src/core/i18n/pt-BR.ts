import { accountPtBR } from "./account.pt-BR.ts";
import { adminPtBR } from "./admin.pt-BR.ts";
import { candidatePtBR } from "./candidate.pt-BR.ts";
import { cockpitPtBR } from "./cockpit.pt-BR.ts";
import { emailPtBR } from "./email.pt-BR.ts";
import { filtersPtBR } from "./filters.pt-BR.ts";
import { jobDetailPtBR } from "./job-detail.pt-BR.ts";
import { jobsPtBR } from "./jobs.pt-BR.ts";
import { operationsPtBR } from "./operations.pt-BR.ts";
import { pipelinePtBR } from "./pipeline.pt-BR.ts";
import { publicProfilePtBR } from "./public-profile.pt-BR.ts";
import { recruiterPtBR } from "./recruiter.pt-BR.ts";
import { recruiterAccessPtBR } from "./recruiter-access.pt-BR.ts";
import { scoringPtBR } from "./scoring.pt-BR.ts";
import { searchesPtBR } from "./searches.pt-BR.ts";
import { shellPtBR } from "./shell.pt-BR.ts";
import type { Translated } from "./shape.ts";

/**
 * Português — o dicionário de referência.
 *
 * Este arquivo define o CONTRATO: o tipo `Dictionary` sai dele, então toda
 * chave criada aqui vira obrigatória nos demais idiomas, e faltar uma passa a
 * ser erro de compilação em vez de texto em branco descoberto por um usuário.
 *
 * Convenção de chave: `área.elemento`, sem abreviação. `nav.jobs`, não `n.j`.
 * A chave é lida em revisão de código muito mais vezes do que é digitada.
 *
 * O texto mora em fragmentos por área, `<área>.pt-BR.ts` e o par
 * `<área>.en.ts`; este arquivo só os junta. Chave ou seção nova entra no
 * fragmento da área, e dois PRs só colidem se mexerem na mesma área. Área nova
 * é um par de arquivos e uma linha de import e de espalhamento aqui e em
 * `en.ts` (`tests/i18n-fragments.test.ts` reprova o fragmento que ficou de fora
 * e a seção que dois fragmentos definem).
 */
export const ptBR = {
  ...accountPtBR,
  ...adminPtBR,
  ...candidatePtBR,
  ...cockpitPtBR,
  ...emailPtBR,
  ...filtersPtBR,
  ...jobDetailPtBR,
  ...jobsPtBR,
  ...operationsPtBR,
  ...pipelinePtBR,
  ...publicProfilePtBR,
  ...recruiterPtBR,
  ...recruiterAccessPtBR,
  ...scoringPtBR,
  ...searchesPtBR,
  ...shellPtBR,
} as const;

/**
 * O formato que todo idioma precisa satisfazer.
 *
 * Derivado do português em vez de escrito à mão: um contrato mantido em
 * paralelo com a implementação sai de sincronia, e aqui ele não tem como.
 */
export type Dictionary = Translated<typeof ptBR>;
