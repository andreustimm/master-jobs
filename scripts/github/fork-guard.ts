/**
 * Guarda de fork do runner self-hosted (Fase 2 da contingência de CI/deploy,
 * issue #367; techspec F2-03/F2-04, ADR 0030 decisão 4) — DEFESA EM
 * PROFUNDIDADE, NÃO a barreira real (revisão L2 da PR #376, C1).
 *
 * O repositório é público e `.github/workflows/ci.yml` pode rodar num runner
 * próprio quando `vars.CI_RUNS_ON` aponta para ele. Esta comparação está
 * embutida na própria expressão `runs-on:` de cada job em `ci.yml` — nunca
 * num job de guarda separado que rodaria DEPOIS de outros já terem começado.
 *
 * **Por que isto NÃO impede sozinho uma PR de fork de rodar no runner
 * próprio:** num evento `pull_request`, o GitHub executa a versão de
 * `ci.yml` que está na `head` da PRÓPRIA PR. Uma PR de fork pode editar o
 * arquivo e substituir a expressão inteira por `runs-on: [self-hosted, ...]`
 * literal — nenhuma checagem DENTRO do workflow impede isso, porque é o
 * próprio workflow que está sendo reescrito. A barreira real é externa ao
 * arquivo: a política de aprovação de workflow de colaborador externo
 * (`fork-pr-contributor-approval` do repositório) precisa estar em
 * `all_external_contributors`, não no padrão `first_time_contributors` (que
 * dispensa aprovação para quem já teve uma contribuição aceita antes) — é
 * pré-requisito do dono, documentado em
 * `docs/engineering/deploy.md#runner-self-hosted-opt-in-ci_runs_on`, nunca
 * mudado por um agente.
 *
 * Esta função continua útil como segunda camada: cobre o caso em que a
 * aprovação humana já liberou o run (ex.: colaborador de confiança), mas a
 * PR ainda assim resolveria para o runner próprio por engano ou por vir de
 * uma branch que não é deste repositório. Extraída para ser testável sem o
 * motor de expressões do GitHub Actions (`tests/ci-runner-selection.test.ts`,
 * F2-03); o mesmo teste (F2-04) confere, por parse de YAML, que a expressão
 * literal em cada `runs-on:` usa exatamente esta comparação — as duas fontes
 * não podem divergir.
 */

/** O subconjunto do payload do evento do GitHub Actions que a decisão usa. */
export type WorkflowEvent = {
  /** `github.event_name` */
  eventName: string;
  /** `github.event.pull_request.head.repo.full_name`, ausente fora de PR */
  pullRequestHeadRepoFullName?: string;
  /** `github.repository` */
  repository: string;
};

/**
 * `true` quando o evento é uma PR cuja `head` pertence a um repositório
 * diferente do próprio — a mesma comparação da expressão em `ci.yml`:
 * `github.event_name == 'pull_request' && head.repo.full_name != github.repository`.
 * Push (mesmo de branch de tarefa) e PR do próprio repositório respondem
 * `false`.
 */
export function isForkPullRequest(event: WorkflowEvent): boolean {
  if (event.eventName !== "pull_request") return false;
  return event.pullRequestHeadRepoFullName !== event.repository;
}
