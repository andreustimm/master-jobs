/**
 * Guarda de fork do runner self-hosted (Fase 2 da contingência de CI/deploy,
 * issue #367; techspec F2-03/F2-04, ADR 0030 decisão 4).
 *
 * O repositório é público e `.github/workflows/ci.yml` pode rodar num runner
 * próprio quando `vars.CI_RUNS_ON` aponta para ele. Um `pull_request` de fork
 * nunca pode ser roteado para esse runner: o vetor conhecido é uma PR
 * maliciosa executando código (instalação, teste, build) na infraestrutura do
 * dono. A mitigação real está embutida na própria expressão `runs-on:` de
 * cada job em `ci.yml` — nunca num job de guarda separado que rodaria DEPOIS
 * de outros já terem começado — e esta função é a mesma decisão booleana,
 * extraída para ser testável sem o motor de expressões do GitHub Actions
 * (`tests/ci-runner-selection.test.ts`, F2-03). `tests/ci-runner-selection.test.ts`
 * (F2-04) também confere, por parse de YAML, que a expressão literal em cada
 * `runs-on:` usa exatamente esta comparação — as duas fontes não podem
 * divergir.
 *
 * A exigência de aprovação humana para workflow de fork ("Approve and run",
 * já ativa no repositório) continua como segunda barreira, independente
 * desta função.
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
