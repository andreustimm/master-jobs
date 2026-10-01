## Técnico

### Corrigido

- `analyseGap` (`src/core/candidate.ts`) deixa de montar os termos com o `profile.yaml` da instalação para qualquer candidato. Termos e vagas passam a vir da mesma trilha principal do candidato, pelo perfil efetivo que o scorer usa (`trackScoringProfiles`): as `keywords` do alvo da principal e as notas dessa trilha (`scoreTrackFilter`). O perfil de matching gravado não entra, porque a fila o deriva do currículo (dono incluído) e as `keywords` dele já estão no CV, o que esvaziaria "faltante". O dono continua com o vocabulário do `profile.yaml` enquanto a principal dele vier dele; editar ou promover a principal muda termos e vagas juntos; principal pendente (sem perfil próprio) devolve relatório vazio. Não muda o scorer nem `SCORER_VERSION`. Testes de banco com dono e convidada em `tests/cov-core-candidate-gap.test.ts` e área E2E `candidate-gap` (#427).

## pt-BR

### Corrigido

- A análise de lacunas de vocabulário na Área do candidato compara o seu currículo com os termos da sua busca principal, e não mais com os do dono do sistema nem com as competências que o próprio currículo já cita. Editar ou trocar a busca principal muda a comparação. Se você ainda não tem um perfil de busca, a seção mostra que não há vagas para comparar.

## en

### Fixed

- The vocabulary gap analysis in the Candidate area now compares your CV with the terms of your primary search, no longer with the system owner's or with the skills your CV already lists. Editing or switching your primary search changes the comparison. If you do not have a search profile yet, the section says there are no jobs to compare.
