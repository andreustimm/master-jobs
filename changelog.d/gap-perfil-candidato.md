## Técnico

### Corrigido

- `analyseGap` (`src/core/candidate.ts`) deixa de montar os termos com o `profile.yaml` da instalação para qualquer candidato e passa a usar `personProfile(candidateId)`: o perfil de matching gravado do candidato; o dono sem perfil gravado continua usando o `profile.yaml`, que é dele; quem não tem perfil próprio e não é o dono recebe um relatório sem vagas e sem termos (a mesma regra que impede pontuá-lo). Não muda o scorer nem `SCORER_VERSION`. Teste de banco com duas contas em `tests/cov-core-candidate-gap.test.ts` (#427).

## pt-BR

### Corrigido

- A análise de lacunas de vocabulário na Área do candidato compara o seu currículo com os termos da sua própria busca, e não mais com os do dono do sistema. Se você ainda não tem um perfil de busca, a seção mostra que não há vagas para comparar.

## en

### Fixed

- The vocabulary gap analysis in the Candidate area now compares your CV with the terms of your own search, no longer with the system owner's. If you do not have a search profile yet, the section says there are no jobs to compare.
