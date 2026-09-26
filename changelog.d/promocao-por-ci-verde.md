## Técnico

### Alterado

- `promover-para-staging.yml` volta a disparar por `workflow_run` quando o CI de push em `dev` termina, com o `head_sha` daquele run como entrada A (decisão do dono, #347; revertendo o gatilho só agendado de #263). O `schedule` das 15:00 e 21:00 UTC fica como rede de segurança e o `workflow_dispatch` como retomada. Run `failure` também entra, para que um vermelho causado só por job de `NON_BLOCKING_CI_JOBS` promova; `requireSourceCI` volta a exigir que o run mais recente de A seja o do evento. `automaticSkip` (em `scripts/release/promotion.ts`) encerra sem CI, release nem escrita o evento automático cujo SHA `staging` já contém, o evento de CI cujo SHA deixou de ser a ponta de `dev` e o run vermelho com outro job bloqueante reprovado — o primeiro caso é o que encerra o ciclo do `chore(release)` empurrado com `RELEASE_PAT`.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
