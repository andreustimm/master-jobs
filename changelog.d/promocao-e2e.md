## Técnico

### Corrigido

- Promoção: `requireSourceCI` (`scripts/release/promotion-ci.ts`) deixa de exigir a execução inteira do CI de push em `dev` verde. Avalia os jobs: `qualidade` e `schema-e-migracao` precisam ter passado, os demais bloqueantes não podem ter reprovado nem estar pendentes, e os da nova `NON_BLOCKING_CI_JOBS` (hoje só `e2e-navegador`) são ignorados; execução vermelha ou em andamento só autoriza quando a causa está num job da lista. `tests/support/ci-workflow.ts` reexporta a mesma lista, em vez de manter uma cópia (#303).
- PR `staging → main` do robô: o `workflow_dispatch` de `ci.yml` em `staging` não roda mais o `e2e-navegador`, e um passo novo em `promover-para-staging.yml` aprova pela API (`POST /actions/runs/{id}/approve`, `GITHUB_TOKEN` com `actions: write`) os runs de `pull_request` deste repositório parados em `action_required` no SHA da cabeça. Melhor esforço: sem permissão, só deixa aviso, e fechar/reabrir continua como recurso manual (#303).
- E2E: a instabilidade de `task-04 transição suave para o perfil público` (e, em cascata, `E2E-013`) era corrida do teste. O redirect do `/login/callback` às vezes vira navegação de documento, o alerta chega no HTML antes da hidratação e o `router.push` seguinte, disparado antes de o Next criar a fila de ações, morria sem erro. O cenário agora espera a fibra do React na tela e empurra com `pushOn`, que falha quando o roteador não existe (#303).

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
