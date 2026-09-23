## Técnico

### Alterado

- Changelog por fragmentos (#263): cada PR adiciona `changelog.d/<slug>.md`
  com os blocos `## Técnico`, `## pt-BR` e `## en`, em vez de editar o
  `## [Unreleased]` dos três arquivos. A promoção junta os fragmentos
  (`mergeChangelogFragments`, ordem pelo nome) antes do carimbo e os apaga no
  commit de release; `verifyReleaseChild` reconstrói R a partir dos fragmentos
  de A e recusa filho que mantenha ou reescreva um deles. `check:release-ready`
  e o hook `commit-msg` aceitam fragmento como nota releaseável e reprovam
  fragmento malformado mesmo em leva sem bump. O `Unreleased` escrito à mão
  continua aceito durante a transição.
- `promover-para-staging.yml` roda às 15:00 e 21:00 UTC (`schedule`) e por
  `workflow_dispatch` com `target-sha`, em vez de a cada `workflow_run` do CI de
  `dev`. O agendado promove a ponta de `dev` somente com CI de push verde, sem
  aprovação de migração, e termina sem escrita nem consulta quando `staging` já
  a contém; a publicação usa a entrada fixada na preparação.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
